"""Sectioned coiled-tubing fatigue.

Python counterparts of the equations in frontend/src/lib/ctPhysics.js (Fatemi-Socie,
Dawson-Paslay, injector-skate scaling); the JS and the existing /api/fatigue/feed
Palmgren-Miner ledger are untouched. This module adds a Chaboche non-linear damage
accumulation and slices the string (0 ft reel end -> TD / BHA end) into
Top (0-33 %), Middle (33-67 %) and Bottom (67-100 %) sections.
"""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional

E_STEEL_PSI = 30e6
SECTIONS = (("top", 0.0, 1 / 3), ("middle", 1 / 3, 2 / 3), ("bottom", 2 / 3, 1.0))

DEFAULT_MATERIAL = {
    "k": 0.3, "tau_f_prime": 85000.0, "G": 11.5e6, "b": -0.09,
    "gamma_f_prime": 0.9, "c": -0.6,
}
DEFAULT_SKATE = {"cylinder_bore_in": 3.5, "n_cylinders": 4, "n_pads": 4, "pad_length_in": 6.0,
                 "recommended_max_psi": 1600.0}
# Chaboche damage-curve exponents. alpha=None derives it from the cycle life of each block
# (alpha -> 0 for short lives / high amplitude), which is what makes accumulation load-sequence dependent.
DEFAULT_CHABOCHE = {"alpha": None, "beta": 1.0}


def alpha_for_life(n_fail: float) -> float:
    if not math.isfinite(n_fail):
        return 0.95
    return min(0.95, max(0.05, 1 - 0.9 * (1 - min(1.0, math.log10(max(n_fail, 1.0)) / 6))))


def skate_penalty(skate_pressure_psi: float, od_in: float, wt_in: float, skate: Optional[dict] = None) -> Dict[str, float]:
    """P_skate penalty factor (>=1): K_t^2 * over-pressure factor, same model as injectorSkateMechanics."""
    sk = {**DEFAULT_SKATE, **(skate or {})}
    psi = max(0.0, float(skate_pressure_psi or 0.0))
    a_cyl = math.pi * (sk["cylinder_bore_in"] / 2) ** 2
    f_total = psi * a_cyl * sk["n_cylinders"]
    r = (od_in - wt_in) / 2
    i_len = wt_in ** 3 / 12
    k_ring = math.pi / 4 - 2 / math.pi
    f_eff = f_total / max(1.0, sk["n_pads"] * sk["pad_length_in"])
    delta = f_eff * r ** 3 * k_ring / (E_STEEL_PSI * i_len)
    ovality_pct = 2 * delta / od_in * 100
    k_t = min(3.0, 1 + 0.25 * max(0.0, ovality_pct))
    over = max(0.0, psi - sk["recommended_max_psi"]) / max(1.0, sk["recommended_max_psi"])
    factor = k_t ** 2 * (1 + 0.5 * over)
    return {"ovality_pct": ovality_pct, "K_t": k_t, "factor": max(1.0, factor)}


def fatemi_socie_cycles(delta_gamma_half: float, sigma_n_max: float, sigma_y: float, *, k: float,
                        tau_f_prime: float, G: float, b: float, gamma_f_prime: float, c: float) -> float:
    """Cycles to failure from (dg/2)(1 + k*sn/sy) = (tf'/G)(2N)^b + gf'(2N)^c. inf if negligible."""
    if sigma_y <= 0 or G <= 0 or delta_gamma_half < 0 or b >= 0 or c >= 0:
        raise ValueError("FATEMI_SOCIE_ERROR: Invalid material or loading parameters.")
    if delta_gamma_half == 0:
        return math.inf
    eff = delta_gamma_half * (1 + k * sigma_n_max / sigma_y)
    if eff <= 0 or not math.isfinite(eff):
        raise ValueError("FATEMI_SOCIE_ERROR: Effective strain must be positive and finite.")

    def strain(rev: float) -> float:
        return tau_f_prime / G * rev ** b + gamma_f_prime * rev ** c

    if strain(1.0) <= eff:
        return 0.5
    lo, hi = 1.0, 2.0
    while strain(hi) > eff and hi < 1e15:
        hi *= 2
    if strain(hi) > eff:
        return math.inf
    for _ in range(100):
        mid = (lo + hi) / 2
        if strain(mid) > eff:
            lo = mid
        else:
            hi = mid
        if hi - lo <= max(1e-9, hi * 1e-12):
            break
    return (lo + hi) / 4


def chaboche_accumulate(damage: float, cycles: float, n_fail: float, *, alpha: float = 0.5, beta: float = 1.0) -> float:
    """Chaboche non-linear damage update (0..1) for `cycles` at life `n_fail`.

    Constant-amplitude integration of the Chaboche rule gives [1-(1-D)^(beta+1)]^(1-alpha) = n/N_f.
    Stepping from the current state lets blocks with different lives interact (load-sequence effect).
    """
    if not 0 <= alpha < 1 or beta < 0:
        raise ValueError("CHABOCHE_ERROR: need 0 <= alpha < 1 and beta >= 0.")
    d = min(max(damage, 0.0), 1.0)
    if cycles <= 0 or math.isinf(n_fail):
        return d
    if d >= 1.0:
        return 1.0
    x = (1 - (1 - d) ** (beta + 1)) ** (1 - alpha) + cycles / max(n_fail, 1e-9)
    if x >= 1.0:
        return 1.0
    return 1 - (1 - x ** (1 / (1 - alpha))) ** (1 / (beta + 1))


def buckling_thresholds(*, od_in: float, wt_in: float, inclination_deg: float, weight_lbf: Optional[float] = None,
                        radial_clearance_in: float = 1.0, E: float = E_STEEL_PSI,
                        w_lb_per_in: Optional[float] = None) -> Dict[str, Any]:
    """Dawson-Paslay critical loads: Fs = 2*sqrt(E I w sin(th)/r), Fh = 2*sqrt(2)*sqrt(E I w sin(th)/r).

    Flags weight < 0 (negative hookload: pipe in compression / pushed by the injector) and, when the
    compressive magnitude exceeds a threshold, the resulting buckling mode.
    """
    if od_in <= 0 or wt_in <= 0 or wt_in * 2 >= od_in or radial_clearance_in <= 0 or not 0 <= inclination_deg <= 90:
        raise ValueError("BUCKLING_ERROR: Invalid or missing geometric/material parameters.")
    i_in4 = math.pi / 64 * (od_in ** 4 - (od_in - 2 * wt_in) ** 4)
    if w_lb_per_in is None:
        w_lb_per_in = 0.2836 * math.pi / 4 * (od_in ** 2 - (od_in - 2 * wt_in) ** 2)
    sin_t = math.sin(math.radians(inclination_deg))
    negative = weight_lbf is not None and weight_lbf < 0
    out: Dict[str, Any] = {"weight_lbf": weight_lbf, "negative_weight": bool(negative),
                           "inclination_deg": inclination_deg}
    base = None
    if sin_t <= 1e-4:
        out.update(f_crit_sinusoidal_lbf=math.inf, f_crit_helical_lbf=math.inf, status="VERTICAL_UNCONSTRAINED")
    else:
        base = math.sqrt(E * i_in4 * w_lb_per_in * sin_t / radial_clearance_in)
        out.update(f_crit_sinusoidal_lbf=2 * base, f_crit_helical_lbf=2 * math.sqrt(2) * base, status="NOMINAL")
    mode = "none"
    if negative:
        comp = abs(weight_lbf)
        if base is None:
            mode = "unconstrained_compression"
        elif comp >= out["f_crit_helical_lbf"]:
            mode = "helical"
        elif comp >= out["f_crit_sinusoidal_lbf"]:
            mode = "sinusoidal"
    out["buckling_mode"] = mode
    return out


def default_stations(length_ft: float, spacing_ft: float = 100.0) -> List[Dict[str, float]]:
    n = max(1, int(math.ceil(length_ft / spacing_ft)))
    return [{"md_ft": float(min(length_ft, i * spacing_ft))} for i in range(n)] + [{"md_ft": float(length_ft)}]


def station_damage(st: Dict[str, Any], *, od_in: float, wt_in: float, smys_psi: float, reel_radius_in: float,
                   material: dict, skate_factor: float, chaboche: dict, default_cycles: float,
                   internal_psi: float) -> Dict[str, float]:
    od = float(st.get("od_in") or od_in)
    wt = float(st.get("wt_in") or wt_in)
    cycles = float(st.get("cycles", default_cycles) or 0)
    prior = float(st.get("prior_damage_pct", 0.0) or 0.0) / 100.0
    p_i = float(st.get("internal_psi", internal_psi) or 0.0)
    eps = od / 2 / max(reel_radius_in, 0.1)             # reel-wrap bending strain
    dgh = 1.5 * eps                                      # shear amplitude, nu_eff = 0.5
    sigma_n = max(0.0, p_i * od / (2 * wt))              # hoop stress on the critical plane
    nf = fatemi_socie_cycles(dgh, sigma_n, smys_psi, **material) / skate_factor
    alpha = chaboche.get("alpha")
    d = chaboche_accumulate(prior, cycles, nf, alpha=alpha_for_life(nf) if alpha is None else alpha,
                            beta=chaboche.get("beta", 1.0))
    return {"md_ft": float(st["md_ft"]), "cycles": cycles, "n_fail": nf, "damage_pct": d * 100.0}


def section_fatigue(stations: Optional[Iterable[Dict[str, Any]]], length_ft: float, *, od_in: float = 2.0,
                    wt_in: float = 0.156, smys_psi: float = 90000.0, reel_radius_in: float = 72.0,
                    cycles: float = 1.0, internal_psi: float = 0.0, skate_pressure_psi: float = 0.0,
                    material: Optional[dict] = None, chaboche: Optional[dict] = None,
                    skate: Optional[dict] = None) -> Dict[str, Any]:
    """Slice stations by md/length_ft into Top/Middle/Bottom; report damage %, cycles, governing depth."""
    if length_ft <= 0:
        raise ValueError("length_ft must be positive.")
    mat = {**DEFAULT_MATERIAL, **(material or {})}
    cha = {**DEFAULT_CHABOCHE, **(chaboche or {})}
    sk = skate_penalty(skate_pressure_psi, od_in, wt_in, skate)
    sts = sorted(({**s} for s in (stations or default_stations(length_ft))), key=lambda s: s["md_ft"])
    results = [station_damage(s, od_in=od_in, wt_in=wt_in, smys_psi=smys_psi, reel_radius_in=reel_radius_in,
                              material=mat, skate_factor=sk["factor"], chaboche=cha, default_cycles=cycles,
                              internal_psi=internal_psi) for s in sts]
    sections: Dict[str, Any] = {}
    for name, lo, hi in SECTIONS:
        last = name == "bottom"
        inside = [r for r in results
                  if lo * length_ft <= r["md_ft"] < hi * length_ft or (last and r["md_ft"] >= length_ft)]
        if not inside:
            sections[name] = {"start_ft": lo * length_ft, "end_ft": hi * length_ft, "stations": 0,
                              "cumulative_damage_pct": 0.0, "mean_damage_pct": 0.0, "cycle_count": 0.0,
                              "governing_depth_ft": None}
            continue
        worst = max(inside, key=lambda r: r["damage_pct"])
        sections[name] = {
            "start_ft": lo * length_ft, "end_ft": hi * length_ft, "stations": len(inside),
            "cumulative_damage_pct": worst["damage_pct"],
            "mean_damage_pct": sum(r["damage_pct"] for r in inside) / len(inside),
            "cycle_count": max(r["cycles"] for r in inside),
            "governing_depth_ft": worst["md_ft"],
        }
    govern = max((n for n in sections if sections[n]["governing_depth_ft"] is not None),
                 key=lambda n: sections[n]["cumulative_damage_pct"], default=None)
    return {"length_ft": length_ft, "sections": sections, "governing_section": govern,
            "skate": {**sk, "pressure_psi": skate_pressure_psi}}
