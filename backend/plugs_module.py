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


class CorrelationIn(BaseModel):
    offset_ft: float = Field(ge=-5000, le=5000)
    move_target: Literal["ct_string", "plugs"] = "ct_string"
    reason: Literal["manual", "nudge", "reset", "tag", "target"] = "manual"
    plug_id: Optional[str] = None
    plug_name: Optional[str] = None
    plug_md_ft: Optional[float] = None
    counter_ft: Optional[float] = None


class CustomChannel(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=60)
    group: str = Field(min_length=1, max_length=30)
    dim: Literal["pressure"] = "pressure"
    tag: Optional[str] = Field(default=None, max_length=30)
    warn: Optional[float] = None
    crit: Optional[float] = None


class LayoutIn(BaseModel):
    active_sets: List[str] = Field(default_factory=list, max_length=20)
    hidden: List[str] = Field(default_factory=list, max_length=100)
    custom: List[CustomChannel] = Field(default_factory=list, max_length=50)


class TeamChannelConfigIn(BaseModel):
    order: List[str] = Field(default_factory=list, max_length=200)
    names: dict[str, str] = Field(default_factory=dict)


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

    @r.get("/surveys/{survey_id}/correlation")
    async def get_correlation(survey_id: str, user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        await _survey(survey_id, team_id)
        cur = await db.depth_correlations.find_one({"survey_id": survey_id, "team_id": team_id}, {"_id": 0})
        log = await db.depth_correlation_log.find({"survey_id": survey_id, "team_id": team_id}, {"_id": 0}).sort("at", -1).to_list(20)
        return {
            "offset_ft": (cur or {}).get("offset_ft", 0.0),
            "move_target": (cur or {}).get("move_target", "ct_string"),
            "updated_by": (cur or {}).get("updated_by"), "updated_at": (cur or {}).get("updated_at"),
            "log": log,
        }

    @r.post("/surveys/{survey_id}/correlation")
    async def set_correlation(survey_id: str, body: CorrelationIn, user: dict = Depends(require_user)):
        require_crew(user)
        team_id = user.get("team_id")
        await _survey(survey_id, team_id)
        prev = await db.depth_correlations.find_one({"survey_id": survey_id, "team_id": team_id}, {"_id": 0}) or {}
        now = _now()
        cur = {"survey_id": survey_id, "team_id": team_id, "offset_ft": round(body.offset_ft, 2),
               "move_target": body.move_target, "updated_by": user["email"], "updated_at": now}
        await db.depth_correlations.update_one({"survey_id": survey_id, "team_id": team_id}, {"$set": cur}, upsert=True)
        entry = {"entry_id": f"cor_{uuid.uuid4().hex[:10]}", "survey_id": survey_id, "team_id": team_id,
                 **body.model_dump(), "offset_ft": cur["offset_ft"], "prev_offset_ft": prev.get("offset_ft", 0.0),
                 "by": user["email"], "by_name": user.get("name") or user["email"], "at": now}
        await db.depth_correlation_log.insert_one(entry)
        entry.pop("_id", None)
        cur.pop("team_id", None)
        return {**cur, "entry": entry}

    @r.get("/me/operator-layout")
    async def get_layout(user: dict = Depends(require_user)):
        doc = await db.operator_layouts.find_one({"email": user["email"]}, {"_id": 0})
        return doc or {"active_sets": None, "hidden": [], "custom": []}

    @r.put("/me/operator-layout")
    async def put_layout(body: LayoutIn, user: dict = Depends(require_user)):
        doc = {"email": user["email"], **body.model_dump(), "updated_at": _now()}
        await db.operator_layouts.update_one({"email": user["email"]}, {"$set": doc}, upsert=True)
        return doc

    @r.get("/team/channel-config")
    async def get_team_channels(user: dict = Depends(require_user)):
        doc = await db.team_channel_config.find_one({"team_id": user.get("team_id")}, {"_id": 0, "team_id": 0})
        return doc or {"order": [], "names": {}, "updated_by": None, "updated_at": None}

    @r.put("/team/channel-config")
    async def put_team_channels(body: TeamChannelConfigIn, user: dict = Depends(require_user)):
        require_crew(user)
        if any(not i or len(i) > 40 for i in body.order):
            raise HTTPException(422, "Channel ids must be 1-40 characters.")
        if len(body.names) > 200:
            raise HTTPException(422, "Too many renamed channels.")
        names = {}
        for k, v in body.names.items():
            v = (v or "").strip()
            if not k or len(k) > 40 or len(v) > 40:
                raise HTTPException(422, "Channel names must be 1-40 characters.")
            if v:
                names[k] = v
        doc = {"team_id": user.get("team_id"), "order": list(dict.fromkeys(body.order)), "names": names,
               "updated_by": user["email"], "updated_at": _now()}
        await db.team_channel_config.update_one({"team_id": doc["team_id"]}, {"$set": doc}, upsert=True)
        doc.pop("team_id")
        return doc

    return r
