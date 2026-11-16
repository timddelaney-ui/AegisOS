"""Top/Middle/Bottom sectioned fatigue endpoint (Fatemi-Socie + Chaboche + skate penalty)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from physics import fatigue as phys


class SectionRequest(BaseModel):
    length_ft: float = Field(..., gt=0, le=100000, allow_inf_nan=False)
    stations: Optional[List[Dict[str, Any]]] = Field(None, max_length=5000)
    od_in: float = Field(2.0, gt=0, le=10, allow_inf_nan=False)
    wt_in: float = Field(0.156, gt=0, le=2, allow_inf_nan=False)
    smys_psi: float = Field(90000.0, gt=0, le=200000, allow_inf_nan=False)
    reel_radius_in: float = Field(72.0, gt=0, le=500, allow_inf_nan=False)
    cycles: float = Field(1.0, ge=0, le=1e6, allow_inf_nan=False)
    internal_psi: float = Field(0.0, ge=-30000, le=30000, allow_inf_nan=False)
    skate_pressure_psi: float = Field(0.0, ge=0, le=10000, allow_inf_nan=False)
    weight_lbf: Optional[float] = Field(None, ge=-1e7, le=1e7, allow_inf_nan=False)
    inclination_deg: Optional[float] = Field(None, ge=0, le=90, allow_inf_nan=False)
    radial_clearance_in: float = Field(1.0, gt=0, le=20, allow_inf_nan=False)


def compute(req: SectionRequest) -> Dict[str, Any]:
    try:
        for s in req.stations or []:
            float(s["md_ft"])
        out = phys.section_fatigue(
            req.stations, req.length_ft, od_in=req.od_in, wt_in=req.wt_in, smys_psi=req.smys_psi,
            reel_radius_in=req.reel_radius_in, cycles=req.cycles, internal_psi=req.internal_psi,
            skate_pressure_psi=req.skate_pressure_psi)
        if req.inclination_deg is not None or req.weight_lbf is not None:
            out["buckling"] = phys.buckling_thresholds(
                od_in=req.od_in, wt_in=req.wt_in,
                inclination_deg=req.inclination_deg if req.inclination_deg is not None else 90.0,
                weight_lbf=req.weight_lbf, radial_clearance_in=req.radial_clearance_in)
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(422, f"Invalid fatigue input: {e}")
    return out


def build_router(*, require_user) -> APIRouter:
    r = APIRouter()

    @r.post("/fatigue/sections")
    async def sections_post(body: SectionRequest, user: dict = Depends(require_user)):
        return compute(body)

    @r.get("/fatigue/sections")
    async def sections_get(
        length_ft: float = Query(..., gt=0, le=100000), od_in: float = Query(2.0, gt=0, le=10),
        wt_in: float = Query(0.156, gt=0, le=2), smys_psi: float = Query(90000.0, gt=0, le=200000),
        reel_radius_in: float = Query(72.0, gt=0, le=500), cycles: float = Query(1.0, ge=0, le=1e6),
        internal_psi: float = Query(0.0, ge=-30000, le=30000), skate_pressure_psi: float = Query(0.0, ge=0, le=10000),
        weight_lbf: Optional[float] = Query(None, ge=-1e7, le=1e7), inclination_deg: Optional[float] = Query(None, ge=0, le=90),
        user: dict = Depends(require_user),
    ):
        return compute(SectionRequest(
            length_ft=length_ft, od_in=od_in, wt_in=wt_in, smys_psi=smys_psi, reel_radius_in=reel_radius_in,
            cycles=cycles, internal_psi=internal_psi, skate_pressure_psi=skate_pressure_psi,
            weight_lbf=weight_lbf, inclination_deg=inclination_deg))

    return r
