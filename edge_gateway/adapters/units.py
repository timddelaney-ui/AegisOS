"""Unit normalisation to Aegis canonical units (ft, ft/min, bbl, psi, lbs, bbl/min)."""
from typing import Callable, Dict, Tuple

# unit alias -> (canonical unit, converter)
_LINEAR = {  # factor, canonical
    "m": (3.280839895, "ft"), "ft": (1.0, "ft"), "in": (1 / 12, "ft"),
    "m/min": (3.280839895, "ft/min"), "ft/min": (1.0, "ft/min"), "m/s": (196.850393701, "ft/min"),
    "ft/s": (60.0, "ft/min"),
    "m3": (6.289810770, "bbl"), "bbl": (1.0, "bbl"), "gal": (1 / 42, "bbl"), "l": (0.00628981077, "bbl"),
    "m3/min": (6.289810770, "bbl/min"), "bbl/min": (1.0, "bbl/min"), "gal/min": (1 / 42, "bbl/min"),
    "l/min": (0.00628981077, "bbl/min"), "m3/h": (6.289810770 / 60, "bbl/min"), "bbl/h": (1 / 60, "bbl/min"),
    "psi": (1.0, "psi"), "kpa": (0.145037738, "psi"), "mpa": (145.037738, "psi"), "bar": (14.5037738, "psi"),
    "lbs": (1.0, "lbs"), "lb": (1.0, "lbs"), "klbs": (1000.0, "lbs"), "kn": (224.808943, "lbs"),
    "daN": (2.24808943, "lbs"), "kg": (2.20462262, "lbs"),
}
_ALIASES = {"gpm": "gal/min", "bpm": "bbl/min", "us_gal": "gal", "liter": "l"}


def normalize(value: float, unit: str | None) -> Tuple[float, str | None]:
    """Convert ``value`` from ``unit`` to its canonical unit. Unknown/None unit passes through."""
    if not unit:
        return value, None
    key = unit.strip()
    key = _ALIASES.get(key.lower(), key)
    entry = _LINEAR.get(key) or _LINEAR.get(key.lower())
    if entry is None:
        raise ValueError(f"unsupported unit: {unit!r}")
    factor, canonical = entry
    return value * factor, canonical
