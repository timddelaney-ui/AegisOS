import math

import pytest

from physics import fatigue as f


def test_sections_split_and_governing_depth():
    stations = [{"md_ft": d, "prior_damage_pct": p} for d, p in
                [(0, 10), (1000, 5), (5000, 30), (6000, 2), (9000, 8), (12000, 60)]]
    out = f.section_fatigue(stations, 12000, cycles=5)
    s = out["sections"]
    assert (s["top"]["stations"], s["middle"]["stations"], s["bottom"]["stations"]) == (2, 2, 2)
    assert s["top"]["governing_depth_ft"] == 0
    assert s["middle"]["governing_depth_ft"] == 5000
    assert s["bottom"]["governing_depth_ft"] == 12000
    assert out["governing_section"] == "bottom"
    assert all(s[n]["cycle_count"] == 5 for n in s)


def test_skate_penalty_increases_damage():
    base = f.section_fatigue(None, 3000, cycles=10)["sections"]["top"]["cumulative_damage_pct"]
    hi = f.section_fatigue(None, 3000, cycles=10, skate_pressure_psi=2500)
    assert hi["skate"]["factor"] > 1
    assert hi["sections"]["top"]["cumulative_damage_pct"] > base


def test_chaboche_nonlinear_and_bounded():
    # Load-sequence effect: high-then-low differs from low-then-high; linear Miner would not.
    a = f.chaboche_accumulate(f.chaboche_accumulate(0, 100, 1000, alpha=f.alpha_for_life(1000)), 100, 100000, alpha=f.alpha_for_life(1e5))
    b = f.chaboche_accumulate(f.chaboche_accumulate(0, 100, 100000, alpha=f.alpha_for_life(1e5)), 100, 1000, alpha=f.alpha_for_life(1000))
    assert a != pytest.approx(b)
    assert f.chaboche_accumulate(0.5, 1e9, 10) == 1.0
    assert f.chaboche_accumulate(0.2, 0, 10) == 0.2


def test_fatemi_socie_monotonic():
    m = f.DEFAULT_MATERIAL
    assert f.fatemi_socie_cycles(0.02, 0, 9e4, **m) < f.fatemi_socie_cycles(0.01, 0, 9e4, **m)
    assert f.fatemi_socie_cycles(0.01, 3e4, 9e4, **m) < f.fatemi_socie_cycles(0.01, 0, 9e4, **m)
    assert f.fatemi_socie_cycles(0, 0, 9e4, **m) == math.inf


def test_buckling_negative_weight_flag():
    t = f.buckling_thresholds(od_in=2.0, wt_in=0.156, inclination_deg=60, weight_lbf=-1000)
    assert t["negative_weight"] and t["buckling_mode"] == "none"
    assert t["f_crit_helical_lbf"] == pytest.approx(math.sqrt(2) * t["f_crit_sinusoidal_lbf"])
    assert f.buckling_thresholds(od_in=2.0, wt_in=0.156, inclination_deg=60, weight_lbf=-1e5)["buckling_mode"] == "helical"
    assert not f.buckling_thresholds(od_in=2.0, wt_in=0.156, inclination_deg=60, weight_lbf=500)["negative_weight"]
    assert f.buckling_thresholds(od_in=2.0, wt_in=0.156, inclination_deg=0, weight_lbf=-5)["status"] == "VERTICAL_UNCONSTRAINED"
    with pytest.raises(ValueError):
        f.buckling_thresholds(od_in=2.0, wt_in=0.156, inclination_deg=120)


def test_endpoint_get_and_post():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routes.fatigue import build_router

    async def user():
        return {"user_id": "u"}

    app = FastAPI()
    app.include_router(build_router(require_user=user), prefix="/api")
    c = TestClient(app)
    g = c.get("/api/fatigue/sections", params={"length_ft": 9000, "cycles": 3, "weight_lbf": -200, "inclination_deg": 45})
    assert g.status_code == 200 and set(g.json()["sections"]) == {"top", "middle", "bottom"}
    assert g.json()["buckling"]["negative_weight"] is True
    p = c.post("/api/fatigue/sections", json={"length_ft": 9000, "stations": [{"md_ft": 10}, {"md_ft": 8999}]})
    assert p.status_code == 200
    assert c.post("/api/fatigue/sections", json={"length_ft": 9000, "stations": [{"x": 1}]}).status_code == 422
