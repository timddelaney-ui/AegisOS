"""Plug records per survey/well + recorded test runs (Operator screen)."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from phase1_modules import require_crew, require_supervisor, role_of

PlugType = Literal["frac_plug", "bridge_plug", "ball_seat", "packer", "other"]


class PlugIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    plug_type: PlugType = "frac_plug"
    top_md_ft: float = Field(ge=0)
    bottom_md_ft: float = Field(ge=0)
    notes: Optional[str] = Field(default=None, max_length=500)


class PlugPass(BaseModel):
    plug_id: str
    name: str
    depth_ft: float
    elapsed_s: float


class PlugRunIn(BaseModel):
    mode: Literal["sim", "test", "live"] = "test"
    speed: float = 1
    start_md_ft: float
    end_md_ft: float
    duration_s: float
    passes: List[PlugPass] = []


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_router(require_user, db) -> APIRouter:
    r = APIRouter()

    async def _survey(survey_id: str, team_id: Optional[str]) -> dict:
        s = await db.surveys.find_one({"survey_id": survey_id, "team_id": team_id}, {"_id": 0, "stations": 1, "survey_id": 1})
        if not s:
            raise HTTPException(404, "Survey not found.")
        return s

    def _validate(body: PlugIn, survey: dict) -> None:
        if body.bottom_md_ft < body.top_md_ft:
            raise HTTPException(422, "Bottom MD must be at or below top MD.")
        td = max((st.get("md_ft", 0) for st in survey.get("stations") or []), default=0)
        if td and body.bottom_md_ft > td:
            raise HTTPException(422, f"Plug is below survey TD ({td:.0f} ft).")

    async def _unique_name(survey_id: str, team_id: Optional[str], name: str, exclude: Optional[str] = None) -> None:
        q = {"survey_id": survey_id, "team_id": team_id, "name": {"$regex": f"^{re.escape(name.strip())}$", "$options": "i"}}
        if exclude:
            q["plug_id"] = {"$ne": exclude}
        if await db.survey_plugs.find_one(q, {"_id": 1}):
            raise HTTPException(409, f"A plug named '{name.strip()}' already exists on this well.")

    async def _plug(plug_id: str, team_id: Optional[str]) -> dict:
        p = await db.survey_plugs.find_one({"plug_id": plug_id, "team_id": team_id}, {"_id": 0})
        if not p:
            raise HTTPException(404, "Plug not found.")
        return p

    @r.get("/surveys/{survey_id}/plugs")
    async def list_plugs(survey_id: str, user: dict = Depends(require_user)):
        await _survey(survey_id, user.get("team_id"))
        docs = await db.survey_plugs.find({"survey_id": survey_id, "team_id": user.get("team_id")}, {"_id": 0}).sort("top_md_ft", 1).to_list(500)
        return {"plugs": docs, "can_edit": role_of(user) in ("supervisor", "management")}

    @r.post("/surveys/{survey_id}/plugs")
    async def add_plug(survey_id: str, body: PlugIn, user: dict = Depends(require_user)):
        require_crew(user)
        survey = await _survey(survey_id, user.get("team_id"))
        _validate(body, survey)
        await _unique_name(survey_id, user.get("team_id"), body.name)
        doc = {
            "plug_id": f"plg_{uuid.uuid4().hex[:12]}", "survey_id": survey_id, "team_id": user.get("team_id"),
            **body.model_dump(), "name": body.name.strip(),
            "created_by": user["email"], "created_at": _now(), "updated_at": _now(),
        }
        await db.survey_plugs.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @r.put("/plugs/{plug_id}")
    async def update_plug(plug_id: str, body: PlugIn, user: dict = Depends(require_user)):
        require_supervisor(user)
        p = await _plug(plug_id, user.get("team_id"))
        _validate(body, await _survey(p["survey_id"], user.get("team_id")))
        await _unique_name(p["survey_id"], user.get("team_id"), body.name, exclude=plug_id)
        upd = {**body.model_dump(), "name": body.name.strip(), "updated_at": _now(), "updated_by": user["email"]}
        await db.survey_plugs.update_one({"plug_id": plug_id}, {"$set": upd})
        return {**p, **upd}

    @r.delete("/plugs/{plug_id}")
    async def delete_plug(plug_id: str, user: dict = Depends(require_user)):
        require_supervisor(user)
        await _plug(plug_id, user.get("team_id"))
        await db.survey_plugs.delete_one({"plug_id": plug_id})
        return {"success": True}

    @r.post("/surveys/{survey_id}/plug-runs")
    async def record_run(survey_id: str, body: PlugRunIn, user: dict = Depends(require_user)):
        require_crew(user)
        await _survey(survey_id, user.get("team_id"))
        doc = {
            "run_id": f"run_{uuid.uuid4().hex[:12]}", "survey_id": survey_id, "team_id": user.get("team_id"),
            **body.model_dump(), "created_by": user["email"], "created_at": _now(),
        }
        await db.plug_runs.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @r.get("/surveys/{survey_id}/plug-runs")
    async def list_runs(survey_id: str, user: dict = Depends(require_user)):
        await _survey(survey_id, user.get("team_id"))
        docs = await db.plug_runs.find({"survey_id": survey_id, "team_id": user.get("team_id")}, {"_id": 0}).sort("created_at", -1).to_list(10)
        return {"runs": docs}

    return r
