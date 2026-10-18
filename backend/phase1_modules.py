"""
Phase 1 modules: RBAC, Reels, Fatigue, Surveys, Certifications,
Tasks, Job Packages, Parts Approval, Timecards, Pay Codes, Payroll.

Imported by server.py — relies on `api_router`, `db`, `require_user`,
`get_current_user`, `_serialize`, `_is_admin`, and `_user_role` from server.py.
"""

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import csv
import io
import math
import uuid


# ---------- RBAC: three-role mapping with legacy aliases ----------
# Plan roles: crew | supervisor | management
# Legacy roles (kept on DB rows):  crew | field_manager | ops_manager
LEGACY_TO_PLAN = {
    "crew": "crew",
    "field_manager": "supervisor",
    "ops_manager": "management",
    "supervisor": "supervisor",
    "management": "management",
    "admin": "management",
}
PLAN_TO_LEGACY = {
    "crew": "crew",
    "supervisor": "field_manager",
    "management": "ops_manager",
}


def role_of(user: dict) -> str:
    raw = (user or {}).get("role") or "crew"
    return LEGACY_TO_PLAN.get(raw, "crew")


def is_supervisor_or_higher(user: dict) -> bool:
    return role_of(user) in ("supervisor", "management")


def is_management(user: dict) -> bool:
    return role_of(user) == "management"


def require_supervisor(user: dict) -> dict:
    if not is_supervisor_or_higher(user):
        raise HTTPException(403, "Supervisor or Management role required.")
    return user


def require_management(user: dict) -> dict:
    if not is_management(user):
        raise HTTPException(403, "Management role required.")
    return user


# ---------- helper ----------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def ser(doc: Optional[dict]) -> Optional[dict]:
    if doc is None:
        return None
    out = {}
    for k, v in doc.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def register_phase1(api_router: APIRouter, db, require_user, get_current_user, _is_admin):
    """Attach all Phase 1 endpoints to the main api_router."""

    # -----------------------------------------------------------------
    # RBAC admin endpoints
    # -----------------------------------------------------------------
    class RolePromote(BaseModel):
        user_id: str
        role: str  # crew | supervisor | management

    @api_router.get("/rbac/me")
    async def rbac_me(user: dict = Depends(require_user)):
        return {
            "user_id": user["user_id"],
            "email": user["email"],
            "role_plan": role_of(user),
            "role_raw": user.get("role") or "crew",
            "team_id": user.get("team_id"),
            "is_supervisor": is_supervisor_or_higher(user),
            "is_management": is_management(user),
        }

    @api_router.get("/rbac/members")
    async def rbac_members(user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            return {"members": []}
        members = await db.users.find({"team_id": team_id}, {"_id": 0, "user_id": 1, "email": 1, "name": 1, "role": 1, "picture": 1}).to_list(500)
        out = []
        for m in members:
            out.append({
                **m,
                "role_plan": LEGACY_TO_PLAN.get(m.get("role") or "crew", "crew"),
            })
        return {"members": out}

    @api_router.post("/rbac/promote")
    async def rbac_promote(body: RolePromote, user: dict = Depends(require_user)):
        require_supervisor(user)
        if body.role not in ("crew", "supervisor", "management"):
            raise HTTPException(400, "role must be crew|supervisor|management")
        # Only management can promote TO management
        if body.role == "management" and not is_management(user):
            raise HTTPException(403, "Only Management can promote to Management.")
        target = await db.users.find_one({"user_id": body.user_id}, {"_id": 0})
        if not target:
            raise HTTPException(404, "User not found.")
        if target.get("team_id") != user.get("team_id") and not _is_admin(user):
            raise HTTPException(403, "User belongs to a different workspace.")
        legacy = PLAN_TO_LEGACY[body.role]
        await db.users.update_one({"user_id": body.user_id}, {"$set": {"role": legacy, "role_updated_at": now_utc(), "role_updated_by": user["email"]}})
        return {"success": True, "user_id": body.user_id, "role_plan": body.role, "role_raw": legacy}

    # Allowed-email domain allowlist on the team workspace
    class DomainAllowlist(BaseModel):
        domains: List[str]  # ['acme.com', 'acme-energy.com']

    @api_router.patch("/rbac/workspace/domains")
    async def set_workspace_domains(body: DomainAllowlist, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        cleaned = [d.strip().lower().lstrip("@") for d in (body.domains or []) if d and "." in d]
        await db.teams.update_one({"team_id": team_id}, {"$set": {"allowed_domains": cleaned, "domains_updated_at": now_utc()}})
        return {"team_id": team_id, "allowed_domains": cleaned}

    @api_router.get("/rbac/workspace/domains")
    async def get_workspace_domains(user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            return {"allowed_domains": []}
        t = await db.teams.find_one({"team_id": team_id}, {"_id": 0, "allowed_domains": 1})
        return {"allowed_domains": (t or {}).get("allowed_domains", [])}

    # -----------------------------------------------------------------
    # MODULE 1 — String & Reel Manager
    # -----------------------------------------------------------------
    # Reel = full physical pipe asset. Intervals = tapered sections (OD, ID derived from WT, grade, length).
    #   grade: QT-800 | QT-900 | QT-1000 | CT-110
    class ReelInterval(BaseModel):
        start_md_ft: float = 0.0
        end_md_ft: float
        od_in: float
        wt_in: float
        grade: str = "QT-900"
        smys_psi: Optional[int] = None  # if omitted, derived from grade

    class ReelCreate(BaseModel):
        name: str
        serial: Optional[str] = None
        total_length_ft: float
        intervals: List[ReelInterval]
        notes: Optional[str] = None
        source: Optional[str] = None  # 'manual'|'csv'|'json'

    class ReelUpdate(BaseModel):
        name: Optional[str] = None
        serial: Optional[str] = None
        total_length_ft: Optional[float] = None
        intervals: Optional[List[ReelInterval]] = None
        notes: Optional[str] = None
        retired: Optional[bool] = None

    GRADE_SMYS = {"QT-800": 80000, "QT-900": 90000, "QT-1000": 100000, "CT-110": 110000, "CT-80": 80000, "CT-90": 90000, "CT-100": 100000}

    def _default_smys(grade: str) -> int:
        return GRADE_SMYS.get((grade or "").upper(), 90000)

    @api_router.post("/reels")
    async def create_reel(body: ReelCreate, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "Create a crew/workspace first.")
        reel_id = f"reel_{uuid.uuid4().hex[:12]}"
        now = now_utc()
        intervals = []
        for seg in body.intervals:
            smys = seg.smys_psi or _default_smys(seg.grade)
            intervals.append({**seg.model_dump(), "smys_psi": smys})
        doc = {
            "reel_id": reel_id,
            "team_id": team_id,
            "name": body.name.strip(),
            "serial": (body.serial or "").strip() or None,
            "total_length_ft": body.total_length_ft,
            "intervals": intervals,
            "source": body.source or "manual",
            "notes": (body.notes or "").strip() or None,
            "retired": False,
            "is_active": False,
            "created_by": user["email"],
            "created_at": now,
            "updated_at": now,
        }
        await db.reels.insert_one(doc)
        doc.pop("_id", None)
        return ser(doc)

    @api_router.get("/reels")
    async def list_reels(user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            return {"reels": [], "active_reel_id": None}
        docs = await db.reels.find({"team_id": team_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
        active = next((d["reel_id"] for d in docs if d.get("is_active") and not d.get("retired")), None)
        return {"reels": [ser(d) for d in docs], "active_reel_id": active}

    @api_router.patch("/reels/{reel_id}")
    async def patch_reel(reel_id: str, body: ReelUpdate, user: dict = Depends(require_user)):
        require_supervisor(user)
        reel = await db.reels.find_one({"reel_id": reel_id, "team_id": user.get("team_id")}, {"_id": 0})
        if not reel:
            raise HTTPException(404, "Reel not found.")
        update: Dict[str, Any] = {"updated_at": now_utc()}
        if body.name is not None:        update["name"] = body.name.strip()
        if body.serial is not None:      update["serial"] = body.serial.strip() or None
        if body.total_length_ft is not None: update["total_length_ft"] = body.total_length_ft
        if body.notes is not None:       update["notes"] = body.notes.strip() or None
        if body.retired is not None:     update["retired"] = bool(body.retired)
        if body.intervals is not None:
            intervals = []
            for seg in body.intervals:
                smys = seg.smys_psi or _default_smys(seg.grade)
                intervals.append({**seg.model_dump(), "smys_psi": smys})
            update["intervals"] = intervals
        await db.reels.update_one({"reel_id": reel_id}, {"$set": update})
        updated = await db.reels.find_one({"reel_id": reel_id}, {"_id": 0})
        return ser(updated)

    @api_router.post("/reels/{reel_id}/activate")
    async def activate_reel(reel_id: str, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        reel = await db.reels.find_one({"reel_id": reel_id, "team_id": team_id}, {"_id": 0})
        if not reel:
            raise HTTPException(404, "Reel not found.")
        if reel.get("retired"):
            raise HTTPException(400, "Cannot activate a retired reel.")
        await db.reels.update_many({"team_id": team_id}, {"$set": {"is_active": False}})
        await db.reels.update_one({"reel_id": reel_id}, {"$set": {"is_active": True, "activated_at": now_utc(), "activated_by": user["email"]}})
        return {"success": True, "active_reel_id": reel_id}

    @api_router.delete("/reels/{reel_id}")
    async def delete_reel(reel_id: str, user: dict = Depends(require_user)):
        require_management(user)
        res = await db.reels.delete_one({"reel_id": reel_id, "team_id": user.get("team_id")})
        if res.deleted_count == 0:
            raise HTTPException(404, "Reel not found.")
        await db.reel_fatigue.delete_many({"reel_id": reel_id})
        return {"success": True}

    @api_router.post("/reels/upload")
    async def upload_reel(
        file: UploadFile = File(...),
        name: str = Form(...),
        serial: Optional[str] = Form(None),
        user: dict = Depends(require_user),
    ):
        """Parse CSV/JSON. CSV columns (case-insensitive):
           start_md_ft,end_md_ft,od_in,wt_in,grade[,smys_psi]
        """
        require_supervisor(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "Create a crew first.")
        raw = await file.read()
        if len(raw) > 2 * 1024 * 1024:
            raise HTTPException(413, "File too large (max 2 MB).")
        intervals: List[Dict[str, Any]] = []
        text = raw.decode("utf-8-sig", errors="replace")
        fn = (file.filename or "").lower()
        try:
            if fn.endswith(".json"):
                import json
                data = json.loads(text)
                for row in (data if isinstance(data, list) else data.get("intervals", [])):
                    intervals.append({
                        "start_md_ft": float(row["start_md_ft"]),
                        "end_md_ft": float(row["end_md_ft"]),
                        "od_in": float(row["od_in"]),
                        "wt_in": float(row["wt_in"]),
                        "grade": str(row.get("grade", "QT-900")).upper(),
                        "smys_psi": int(row["smys_psi"]) if row.get("smys_psi") else _default_smys(row.get("grade", "QT-900")),
                    })
            else:
                reader = csv.DictReader(io.StringIO(text))
                keymap = {}
                for col in (reader.fieldnames or []):
                    keymap[col.lower().strip().replace(" ", "_")] = col
                for row in reader:
                    def gv(k, default=None):
                        src = keymap.get(k)
                        return row[src] if src and row.get(src) is not None else default
                    g = str(gv("grade", "QT-900") or "QT-900").upper()
                    intervals.append({
                        "start_md_ft": float(gv("start_md_ft") or gv("start") or 0),
                        "end_md_ft": float(gv("end_md_ft") or gv("end")),
                        "od_in": float(gv("od_in") or gv("od")),
                        "wt_in": float(gv("wt_in") or gv("wt")),
                        "grade": g,
                        "smys_psi": int(gv("smys_psi") or _default_smys(g)),
                    })
        except Exception as e:
            raise HTTPException(400, f"Could not parse file: {e}")
        if not intervals:
            raise HTTPException(400, "No intervals parsed.")
        intervals.sort(key=lambda s: s["start_md_ft"])
        total = max(s["end_md_ft"] for s in intervals)
        reel_id = f"reel_{uuid.uuid4().hex[:12]}"
        now = now_utc()
        doc = {
            "reel_id": reel_id, "team_id": team_id,
            "name": name.strip(), "serial": (serial or "").strip() or None,
            "total_length_ft": total, "intervals": intervals,
            "source": "json" if fn.endswith(".json") else "csv",
            "retired": False, "is_active": False,
            "created_by": user["email"], "created_at": now, "updated_at": now,
        }
        await db.reels.insert_one(doc)
        doc.pop("_id", None)
        return ser(doc)

    # -----------------------------------------------------------------
    # MODULE 3 — Fatigue engine
    # -----------------------------------------------------------------
    # Palmgren-Miner linear damage per station node. Pressure feed:
    #   - traction_pressure_psi: live injector-skate hydraulic pressure
    #   - cycle_count: how many bending events happened in this feed window
    #     (defaults to 1 — the client advises e.g. 1 cycle per depth-trip)
    #   - depth_ft: current operating depth → identifies which station is bending now
    #
    # Simple published-form Manson-Coffin curve:
    #   N_f(epsilon_p) = (epsilon_p / 0.5)^(-1 / 0.5)        # strain-life exponent approximation
    # Plastic bending strain range at wrap:
    #   epsilon_p = (OD / 2 / R_bend)
    # R_bend baseline from reel core radius (worst node).
    # Pressure-scaled contact / ovality uplift:
    #   uplift = 1 + k*(P/P_ref - 1), bounded [0.5, 2.5]
    # Public references: Palmgren(1924), Miner(1945), Tipton(1994),
    #   API RP 5C7 §8 fatigue testing of CT (open-domain).

    NODE_SPACING_FT_DEFAULT = 100
    REEL_CORE_RADIUS_FT = 72.0 / 12.0        # 72 in core radius (standard CT reel)
    GOOSENECK_RADIUS_FT = 72.0 / 12.0
    STRAIGHTENER_RADIUS_FT = 1e9             # pseudo-infinite (no bending)
    P_REF_PSI = 1200.0                       # reference injector traction pressure
    PRESSURE_UPLIFT_K = 0.6                  # pressure sensitivity

    def _node_count(total_ft: float, spacing_ft: int) -> int:
        return max(1, int(math.ceil(total_ft / max(spacing_ft, 1))) + 1)

    def _interval_at(reel: dict, md_ft: float) -> Optional[dict]:
        for seg in reel.get("intervals", []):
            if seg["start_md_ft"] <= md_ft <= seg["end_md_ft"]:
                return seg
        if reel.get("intervals"):
            return reel["intervals"][-1 if md_ft > reel["intervals"][-1]["end_md_ft"] else 0]
        return None

    def _nf_cycles(od_in: float, bend_radius_ft: float, grade_smys: int) -> float:
        od_ft = od_in / 12.0
        eps_p = (od_ft / 2.0) / max(bend_radius_ft, 0.1)
        # Grade uplift: higher SMYS → more cycles tolerated
        grade_factor = (grade_smys / 90000.0) ** 1.2
        base_nf = (eps_p / 0.5) ** (-2.0)
        return max(50.0, base_nf * grade_factor)

    class PressureFeed(BaseModel):
        reel_id: str
        depth_ft: float
        traction_pressure_psi: float
        cycle_count: int = 1  # bending events this feed window
        source: str = "manual"  # 'manual' | 'simulated' | 'daq'

    @api_router.post("/fatigue/feed")
    async def feed_fatigue(body: PressureFeed, user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        reel = await db.reels.find_one({"reel_id": body.reel_id, "team_id": team_id}, {"_id": 0})
        if not reel:
            raise HTTPException(404, "Reel not found.")
        if reel.get("retired"):
            raise HTTPException(400, "Reel retired. Reset or activate a new reel.")

        state = await db.reel_fatigue.find_one({"reel_id": body.reel_id}, {"_id": 0})
        spacing = int((state or {}).get("spacing_ft") or NODE_SPACING_FT_DEFAULT)
        total = reel.get("total_length_ft") or (reel["intervals"][-1]["end_md_ft"] if reel.get("intervals") else 10000)
        n_nodes = _node_count(total, spacing)
        damage = (state or {}).get("damage") or [0.0] * n_nodes
        if len(damage) < n_nodes:
            damage += [0.0] * (n_nodes - len(damage))
        damage = damage[:n_nodes]

        # Which node is currently bending at the gooseneck / reel-core?
        # Model: every bend event affects THREE nodes (reel core + gooseneck zone)
        bend_node = min(int(body.depth_ft / spacing), n_nodes - 1)
        uplift = max(0.5, min(2.5, 1 + PRESSURE_UPLIFT_K * (body.traction_pressure_psi / P_REF_PSI - 1)))
        # Nodes that bend during the trip
        affected = sorted(set([
            bend_node,
            max(0, bend_node - 1),
            min(n_nodes - 1, bend_node + 1),
        ]))
        new_events: List[Dict[str, Any]] = []
        for ni in affected:
            md = ni * spacing
            seg = _interval_at(reel, md) or (reel.get("intervals") or [{}])[0]
            od_in = seg.get("od_in", 2.0)
            smys = seg.get("smys_psi", 90000)
            # Each bend event = 1 cycle through reel-core-radius wrap (worst) counted via Miner
            nf = _nf_cycles(od_in, REEL_CORE_RADIUS_FT, smys)
            damage[ni] = min(1.0, damage[ni] + (body.cycle_count * uplift) / nf)
            new_events.append({"node_idx": ni, "md_ft": md, "nf_cycles": nf, "damage_add": body.cycle_count * uplift / nf})

        update = {
            "reel_id": body.reel_id, "team_id": team_id,
            "spacing_ft": spacing, "node_count": n_nodes,
            "damage": damage, "updated_at": now_utc(),
            "last_pressure_psi": body.traction_pressure_psi,
            "last_depth_ft": body.depth_ft,
            "last_source": body.source,
        }
        await db.reel_fatigue.update_one({"reel_id": body.reel_id}, {"$set": update, "$setOnInsert": {"created_at": now_utc()}}, upsert=True)
        # append event audit
        await db.reel_fatigue_events.insert_one({
            "reel_id": body.reel_id, "team_id": team_id,
            "pressure_psi": body.traction_pressure_psi,
            "depth_ft": body.depth_ft,
            "cycles": body.cycle_count,
            "uplift": uplift,
            "source": body.source,
            "events": new_events,
            "user_email": user["email"],
            "created_at": now_utc(),
        })
        worst = max(damage) if damage else 0.0
        return {"reel_id": body.reel_id, "spacing_ft": spacing, "node_count": n_nodes, "damage": damage, "worst_damage": worst, "derate_warning": worst >= 0.8}

    @api_router.get("/fatigue/state")
    async def get_fatigue(reel_id: str, user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        state = await db.reel_fatigue.find_one({"reel_id": reel_id, "team_id": team_id}, {"_id": 0})
        if not state:
            reel = await db.reels.find_one({"reel_id": reel_id, "team_id": team_id}, {"_id": 0})
            if not reel:
                raise HTTPException(404, "Reel not found.")
            total = reel.get("total_length_ft") or 10000
            n = _node_count(total, NODE_SPACING_FT_DEFAULT)
            return {"reel_id": reel_id, "spacing_ft": NODE_SPACING_FT_DEFAULT, "node_count": n, "damage": [0.0] * n, "worst_damage": 0.0, "derate_warning": False}
        damage = state.get("damage") or []
        return {**ser(state), "worst_damage": max(damage) if damage else 0.0, "derate_warning": (max(damage) if damage else 0.0) >= 0.8}

    @api_router.post("/fatigue/reset")
    async def reset_fatigue(reel_id: str, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        reel = await db.reels.find_one({"reel_id": reel_id, "team_id": team_id}, {"_id": 0})
        if not reel:
            raise HTTPException(404, "Reel not found.")
        await db.reel_fatigue.delete_one({"reel_id": reel_id})
        await db.reel_fatigue_events.insert_one({
            "reel_id": reel_id, "team_id": team_id, "source": "reset",
            "user_email": user["email"], "created_at": now_utc(),
        })
        return {"success": True}

    # -----------------------------------------------------------------
    # MODULE 6 — Directional Survey (3D wellbore)
    # -----------------------------------------------------------------
    class SurveyStation(BaseModel):
        md_ft: float
        inc_deg: float
        azi_deg: float
        tvd_ft: Optional[float] = None
        dls_deg_per_100ft: Optional[float] = None

    class SurveyCreate(BaseModel):
        well_name: str
        stations: List[SurveyStation]
        notes: Optional[str] = None

    def _mcm_tvd(stations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Minimum curvature method: fill TVD, N, E and DLS."""
        out: List[Dict[str, Any]] = []
        prev = None
        tvd = 0.0; north = 0.0; east = 0.0
        for s in stations:
            md = float(s["md_ft"]); inc = math.radians(float(s["inc_deg"])); azi = math.radians(float(s["azi_deg"]))
            if prev is None:
                prev = {"md": md, "inc": inc, "azi": azi}
                dls = 0.0
                out.append({"md_ft": md, "inc_deg": math.degrees(inc), "azi_deg": math.degrees(azi), "tvd_ft": tvd, "north_ft": north, "east_ft": east, "dls_deg_per_100ft": dls})
                continue
            dmd = md - prev["md"]
            try:
                cos_dls = math.cos(prev["inc"]) * math.cos(inc) + math.sin(prev["inc"]) * math.sin(inc) * math.cos(azi - prev["azi"])
                cos_dls = max(-1.0, min(1.0, cos_dls))
                dls_rad = math.acos(cos_dls)
            except ValueError:
                dls_rad = 0.0
            rf = 1.0 if dls_rad < 1e-6 else (2.0 / dls_rad) * math.tan(dls_rad / 2.0)
            dtvd = (dmd / 2.0) * (math.cos(prev["inc"]) + math.cos(inc)) * rf
            dnorth = (dmd / 2.0) * (math.sin(prev["inc"]) * math.cos(prev["azi"]) + math.sin(inc) * math.cos(azi)) * rf
            deast = (dmd / 2.0) * (math.sin(prev["inc"]) * math.sin(prev["azi"]) + math.sin(inc) * math.sin(azi)) * rf
            tvd += dtvd; north += dnorth; east += deast
            dls_per_100 = math.degrees(dls_rad) * (100.0 / dmd) if dmd > 0 else 0.0
            out.append({"md_ft": md, "inc_deg": math.degrees(inc), "azi_deg": math.degrees(azi), "tvd_ft": tvd, "north_ft": north, "east_ft": east, "dls_deg_per_100ft": dls_per_100})
            prev = {"md": md, "inc": inc, "azi": azi}
        return out

    @api_router.post("/surveys")
    async def create_survey(body: SurveyCreate, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        if not body.stations or len(body.stations) < 2:
            raise HTTPException(400, "Need at least 2 survey stations.")
        stations = [s.model_dump() for s in sorted(body.stations, key=lambda x: x.md_ft)]
        computed = _mcm_tvd(stations)
        survey_id = f"srv_{uuid.uuid4().hex[:12]}"
        now = now_utc()
        doc = {
            "survey_id": survey_id, "team_id": team_id, "well_name": body.well_name.strip(),
            "stations": computed, "notes": (body.notes or "").strip() or None,
            "is_active": False,
            "created_by": user["email"], "created_at": now, "updated_at": now,
        }
        await db.surveys.insert_one(doc)
        doc.pop("_id", None)
        return ser(doc)

    @api_router.post("/surveys/upload")
    async def upload_survey(
        file: UploadFile = File(...),
        well_name: str = Form(...),
        user: dict = Depends(require_user),
    ):
        require_supervisor(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        raw = await file.read()
        if len(raw) > 4 * 1024 * 1024:
            raise HTTPException(413, "File too large (max 4 MB).")
        text = raw.decode("utf-8-sig", errors="replace")
        try:
            reader = csv.DictReader(io.StringIO(text))
            km = {c.lower().strip().replace(" ", "_"): c for c in (reader.fieldnames or [])}
            stations: List[Dict[str, Any]] = []
            for row in reader:
                def g(k):
                    src = km.get(k)
                    return row[src] if src else None
                md = g("md_ft") or g("md") or g("depth") or g("depth_ft")
                inc = g("inc_deg") or g("inc") or g("inclination")
                azi = g("azi_deg") or g("azi") or g("azimuth")
                if md is None or inc is None or azi is None:
                    continue
                stations.append({"md_ft": float(md), "inc_deg": float(inc), "azi_deg": float(azi)})
        except Exception as e:
            raise HTTPException(400, f"Could not parse survey: {e}")
        if len(stations) < 2:
            raise HTTPException(400, "Need at least 2 stations (columns: md_ft, inc_deg, azi_deg).")
        stations.sort(key=lambda s: s["md_ft"])
        computed = _mcm_tvd(stations)
        survey_id = f"srv_{uuid.uuid4().hex[:12]}"
        now = now_utc()
        doc = {
            "survey_id": survey_id, "team_id": team_id, "well_name": well_name.strip(),
            "stations": computed, "is_active": False,
            "created_by": user["email"], "created_at": now, "updated_at": now,
        }
        await db.surveys.insert_one(doc)
        doc.pop("_id", None)
        return ser(doc)

    @api_router.get("/surveys")
    async def list_surveys(user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            return {"surveys": [], "active_survey_id": None}
        docs = await db.surveys.find({"team_id": team_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
        active = next((d["survey_id"] for d in docs if d.get("is_active")), None)
        return {"surveys": [ser(d) for d in docs], "active_survey_id": active}

    @api_router.get("/surveys/{survey_id}")
    async def get_survey(survey_id: str, user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        s = await db.surveys.find_one({"survey_id": survey_id, "team_id": team_id}, {"_id": 0})
        if not s:
            raise HTTPException(404, "Survey not found.")
        return ser(s)

    @api_router.post("/surveys/{survey_id}/activate")
    async def activate_survey(survey_id: str, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        s = await db.surveys.find_one({"survey_id": survey_id, "team_id": team_id}, {"_id": 0})
        if not s:
            raise HTTPException(404, "Survey not found.")
        await db.surveys.update_many({"team_id": team_id}, {"$set": {"is_active": False}})
        await db.surveys.update_one({"survey_id": survey_id}, {"$set": {"is_active": True}})
        return {"success": True, "active_survey_id": survey_id}

    @api_router.delete("/surveys/{survey_id}")
    async def delete_survey(survey_id: str, user: dict = Depends(require_user)):
        require_supervisor(user)
        res = await db.surveys.delete_one({"survey_id": survey_id, "team_id": user.get("team_id")})
        if res.deleted_count == 0:
            raise HTTPException(404, "Not found.")
        return {"success": True}

    # -----------------------------------------------------------------
    # MODULE A — Certification Ledger
    # -----------------------------------------------------------------
    CERT_CATEGORIES = {"lifting", "iron", "pce", "ct_unit", "snubbing", "h2s", "first_aid", "other"}

    class CertCreate(BaseModel):
        user_id: Optional[str] = None  # defaults to self
        category: str
        issuing_body: Optional[str] = None
        cert_number: Optional[str] = None
        issue_date: str  # YYYY-MM-DD
        expiry_date: str
        attachment_id: Optional[str] = None
        notes: Optional[str] = None

    class CertUpdate(BaseModel):
        category: Optional[str] = None
        issuing_body: Optional[str] = None
        cert_number: Optional[str] = None
        issue_date: Optional[str] = None
        expiry_date: Optional[str] = None
        attachment_id: Optional[str] = None
        notes: Optional[str] = None

    def _parse_date(s: str) -> datetime:
        try:
            return datetime.strptime(s[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, f"Date must be YYYY-MM-DD (got {s!r})")

    @api_router.post("/certifications")
    async def create_cert(body: CertCreate, user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        target_uid = body.user_id or user["user_id"]
        if target_uid != user["user_id"] and not is_supervisor_or_higher(user):
            raise HTTPException(403, "Only supervisors can edit another crew member's certs.")
        if body.category not in CERT_CATEGORIES:
            raise HTTPException(400, f"category must be one of {sorted(CERT_CATEGORIES)}")
        issue = _parse_date(body.issue_date)
        expiry = _parse_date(body.expiry_date)
        if expiry < issue:
            raise HTTPException(400, "expiry_date must be on or after issue_date.")
        cert_id = f"cert_{uuid.uuid4().hex[:12]}"
        now = now_utc()
        target = await db.users.find_one({"user_id": target_uid}, {"_id": 0, "name": 1, "email": 1})
        doc = {
            "cert_id": cert_id, "team_id": team_id, "user_id": target_uid,
            "user_name": (target or {}).get("name") or "", "user_email": (target or {}).get("email") or "",
            "category": body.category,
            "issuing_body": (body.issuing_body or "").strip() or None,
            "cert_number": (body.cert_number or "").strip() or None,
            "issue_date": issue, "expiry_date": expiry,
            "attachment_id": body.attachment_id or None,
            "notes": (body.notes or "").strip() or None,
            "created_by": user["email"], "created_at": now, "updated_at": now,
        }
        await db.certifications.insert_one(doc)
        doc.pop("_id", None)
        return ser(doc)

    @api_router.get("/certifications")
    async def list_certs(user_id: Optional[str] = None, user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            return {"certifications": []}
        q: Dict[str, Any] = {"team_id": team_id}
        if user_id:
            # Non-supervisors can only see their own
            if user_id != user["user_id"] and not is_supervisor_or_higher(user):
                raise HTTPException(403, "Crew can only view own cert profile.")
            q["user_id"] = user_id
        docs = await db.certifications.find(q, {"_id": 0}).sort("expiry_date", 1).to_list(500)
        today = datetime.now(timezone.utc)
        out = []
        for d in docs:
            ds = ser(d)
            exp = d.get("expiry_date")
            if isinstance(exp, datetime):
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                days = (exp - today).days
                ds["days_to_expiry"] = days
                if days < 0:
                    ds["status"] = "expired"
                elif days <= 30:
                    ds["status"] = "amber"
                else:
                    ds["status"] = "green"
            out.append(ds)
        return {"certifications": out}

    @api_router.patch("/certifications/{cert_id}")
    async def patch_cert(cert_id: str, body: CertUpdate, user: dict = Depends(require_user)):
        doc = await db.certifications.find_one({"cert_id": cert_id, "team_id": user.get("team_id")}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Cert not found.")
        if doc["user_id"] != user["user_id"] and not is_supervisor_or_higher(user):
            raise HTTPException(403, "Only supervisors can edit others' certs.")
        update: Dict[str, Any] = {"updated_at": now_utc()}
        if body.category is not None:
            if body.category not in CERT_CATEGORIES:
                raise HTTPException(400, "Invalid category")
            update["category"] = body.category
        for k in ("issuing_body", "cert_number", "notes", "attachment_id"):
            v = getattr(body, k)
            if v is not None:
                update[k] = v.strip() if isinstance(v, str) else v
        if body.issue_date is not None:   update["issue_date"] = _parse_date(body.issue_date)
        if body.expiry_date is not None:  update["expiry_date"] = _parse_date(body.expiry_date)
        await db.certifications.update_one({"cert_id": cert_id}, {"$set": update})
        return ser(await db.certifications.find_one({"cert_id": cert_id}, {"_id": 0}))

    @api_router.delete("/certifications/{cert_id}")
    async def delete_cert(cert_id: str, user: dict = Depends(require_user)):
        require_supervisor(user)
        res = await db.certifications.delete_one({"cert_id": cert_id, "team_id": user.get("team_id")})
        if res.deleted_count == 0:
            raise HTTPException(404, "Not found.")
        return {"success": True}

    # -----------------------------------------------------------------
    # MODULE B — Daily Tasks + Job Packages
    # -----------------------------------------------------------------
    class TaskCreate(BaseModel):
        rig_id: Optional[str] = None
        title: str
        detail: Optional[str] = None
        assignee_user_id: Optional[str] = None
        due_date: Optional[str] = None  # YYYY-MM-DD

    class TaskUpdate(BaseModel):
        title: Optional[str] = None
        detail: Optional[str] = None
        assignee_user_id: Optional[str] = None
        status: Optional[str] = None  # open | done
        due_date: Optional[str] = None

    @api_router.post("/tasks")
    async def create_task(body: TaskCreate, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        task_id = f"task_{uuid.uuid4().hex[:12]}"
        now = now_utc()
        doc = {
            "task_id": task_id, "team_id": team_id, "rig_id": body.rig_id,
            "title": body.title.strip()[:200],
            "detail": (body.detail or "").strip() or None,
            "assignee_user_id": body.assignee_user_id,
            "due_date": _parse_date(body.due_date) if body.due_date else None,
            "status": "open",
            "created_by": user["email"], "created_by_user_id": user["user_id"],
            "created_at": now, "updated_at": now,
        }
        await db.daily_tasks.insert_one(doc)
        doc.pop("_id", None)
        return ser(doc)

    @api_router.get("/tasks")
    async def list_tasks(rig_id: Optional[str] = None, status: Optional[str] = None, user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            return {"tasks": []}
        q: Dict[str, Any] = {"team_id": team_id}
        if rig_id:    q["rig_id"] = rig_id
        if status:    q["status"] = status
        docs = await db.daily_tasks.find(q, {"_id": 0}).sort([("status", 1), ("due_date", 1), ("created_at", -1)]).to_list(500)
        return {"tasks": [ser(d) for d in docs]}

    @api_router.patch("/tasks/{task_id}")
    async def patch_task(task_id: str, body: TaskUpdate, user: dict = Depends(require_user)):
        doc = await db.daily_tasks.find_one({"task_id": task_id, "team_id": user.get("team_id")}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Task not found.")
        # Crew can only mark their assigned task done
        is_edit = any(getattr(body, k) is not None for k in ("title", "detail", "assignee_user_id", "due_date"))
        if is_edit and not is_supervisor_or_higher(user):
            raise HTTPException(403, "Only supervisors can edit task content.")
        update: Dict[str, Any] = {"updated_at": now_utc()}
        if body.title is not None:            update["title"] = body.title.strip()[:200]
        if body.detail is not None:           update["detail"] = body.detail.strip() or None
        if body.assignee_user_id is not None: update["assignee_user_id"] = body.assignee_user_id or None
        if body.due_date is not None:         update["due_date"] = _parse_date(body.due_date) if body.due_date else None
        if body.status is not None:
            if body.status not in ("open", "done"):
                raise HTTPException(400, "status must be open|done")
            update["status"] = body.status
            if body.status == "done":
                update["completed_by"] = user["email"]
                update["completed_at"] = now_utc()
            else:
                update["completed_by"] = None
                update["completed_at"] = None
        await db.daily_tasks.update_one({"task_id": task_id}, {"$set": update})
        return ser(await db.daily_tasks.find_one({"task_id": task_id}, {"_id": 0}))

    @api_router.delete("/tasks/{task_id}")
    async def delete_task(task_id: str, user: dict = Depends(require_user)):
        require_supervisor(user)
        res = await db.daily_tasks.delete_one({"task_id": task_id, "team_id": user.get("team_id")})
        if res.deleted_count == 0:
            raise HTTPException(404, "Not found.")
        return {"success": True}

    # Job Packages
    class JobPackageCreate(BaseModel):
        rig_id: str
        job_number: str
        well_name: Optional[str] = None
        target_date: str  # YYYY-MM-DD
        program_summary: Optional[str] = None
        attachment_ids: Optional[List[str]] = None
        reel_id: Optional[str] = None
        survey_id: Optional[str] = None

    @api_router.post("/job-packages")
    async def create_jobpkg(body: JobPackageCreate, user: dict = Depends(require_user)):
        require_management(user)  # Management pushes job files
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        pkg_id = f"jpkg_{uuid.uuid4().hex[:12]}"
        now = now_utc()
        doc = {
            "pkg_id": pkg_id, "team_id": team_id, "rig_id": body.rig_id,
            "job_number": body.job_number.strip(),
            "well_name": (body.well_name or "").strip() or None,
            "target_date": _parse_date(body.target_date),
            "program_summary": (body.program_summary or "").strip() or None,
            "attachment_ids": list(body.attachment_ids or []),
            "reel_id": body.reel_id, "survey_id": body.survey_id,
            "status": "pending",       # pending | acknowledged | active | archived
            "pushed_by": user["email"], "created_at": now, "updated_at": now,
            "acknowledged_at": None, "acknowledged_by": None,
        }
        await db.job_packages.insert_one(doc)
        doc.pop("_id", None)
        return ser(doc)

    @api_router.get("/job-packages")
    async def list_jobpkgs(rig_id: Optional[str] = None, status: Optional[str] = None, user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            return {"packages": []}
        q: Dict[str, Any] = {"team_id": team_id}
        if rig_id: q["rig_id"] = rig_id
        if status: q["status"] = status
        docs = await db.job_packages.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"packages": [ser(d) for d in docs]}

    @api_router.post("/job-packages/{pkg_id}/acknowledge")
    async def ack_jobpkg(pkg_id: str, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        pkg = await db.job_packages.find_one({"pkg_id": pkg_id, "team_id": team_id}, {"_id": 0})
        if not pkg:
            raise HTTPException(404, "Package not found.")
        # Auto-attach reel + survey if specified
        if pkg.get("reel_id"):
            await db.reels.update_many({"team_id": team_id}, {"$set": {"is_active": False}})
            await db.reels.update_one({"reel_id": pkg["reel_id"], "team_id": team_id}, {"$set": {"is_active": True}})
        if pkg.get("survey_id"):
            await db.surveys.update_many({"team_id": team_id}, {"$set": {"is_active": False}})
            await db.surveys.update_one({"survey_id": pkg["survey_id"], "team_id": team_id}, {"$set": {"is_active": True}})
        await db.job_packages.update_one({"pkg_id": pkg_id}, {"$set": {
            "status": "active",
            "acknowledged_at": now_utc(),
            "acknowledged_by": user["email"],
            "updated_at": now_utc(),
        }})
        return ser(await db.job_packages.find_one({"pkg_id": pkg_id}, {"_id": 0}))

    # -----------------------------------------------------------------
    # MODULE C — Parts Orders with Approval Chain
    # -----------------------------------------------------------------
    class PartsOrderCreate(BaseModel):
        rig_id: Optional[str] = None
        part_number: Optional[str] = None
        description: str
        quantity: int = 1
        needed_by: Optional[str] = None  # YYYY-MM-DD
        note: Optional[str] = None

    @api_router.post("/parts-orders")
    async def create_parts_order(body: PartsOrderCreate, user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        po_id = f"po_{uuid.uuid4().hex[:12]}"
        now = now_utc()
        # Crew → pending supervisor approval. Supervisor/Mgmt orders auto-approved.
        if is_supervisor_or_higher(user):
            status = "approved"
            approved_by = user["email"]
            approved_at = now
        else:
            status = "pending_supervisor"
            approved_by = None
            approved_at = None
        doc = {
            "po_id": po_id, "team_id": team_id, "rig_id": body.rig_id,
            "part_number": (body.part_number or "").strip() or None,
            "description": body.description.strip()[:400],
            "quantity": max(1, int(body.quantity)),
            "needed_by": _parse_date(body.needed_by) if body.needed_by else None,
            "note": (body.note or "").strip() or None,
            "status": status,
            "created_by": user["email"], "created_by_user_id": user["user_id"],
            "approved_by": approved_by, "approved_at": approved_at,
            "created_at": now, "updated_at": now,
            "history": [{"action": "created", "by": user["email"], "at": now.isoformat(), "status": status}],
        }
        await db.parts_orders.insert_one(doc)
        doc.pop("_id", None)
        return ser(doc)

    @api_router.get("/parts-orders")
    async def list_parts_orders(status: Optional[str] = None, rig_id: Optional[str] = None, user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            return {"orders": []}
        q: Dict[str, Any] = {"team_id": team_id}
        if status: q["status"] = status
        if rig_id: q["rig_id"] = rig_id
        docs = await db.parts_orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
        return {"orders": [ser(d) for d in docs]}

    class PartsOrderAction(BaseModel):
        comment: Optional[str] = None
        new_status: Optional[str] = None  # for free-form status move (ordered, received, rejected)

    @api_router.post("/parts-orders/{po_id}/approve")
    async def approve_parts(po_id: str, body: PartsOrderAction, user: dict = Depends(require_user)):
        require_supervisor(user)
        po = await db.parts_orders.find_one({"po_id": po_id, "team_id": user.get("team_id")}, {"_id": 0})
        if not po:
            raise HTTPException(404, "Order not found.")
        now = now_utc()
        hist = (po.get("history") or []) + [{"action": "approved", "by": user["email"], "at": now.isoformat(), "comment": body.comment or ""}]
        await db.parts_orders.update_one({"po_id": po_id}, {"$set": {
            "status": "approved",
            "approved_by": user["email"], "approved_at": now,
            "updated_at": now, "history": hist,
        }})
        return ser(await db.parts_orders.find_one({"po_id": po_id}, {"_id": 0}))

    @api_router.post("/parts-orders/{po_id}/reject")
    async def reject_parts(po_id: str, body: PartsOrderAction, user: dict = Depends(require_user)):
        require_supervisor(user)
        po = await db.parts_orders.find_one({"po_id": po_id, "team_id": user.get("team_id")}, {"_id": 0})
        if not po:
            raise HTTPException(404, "Order not found.")
        now = now_utc()
        hist = (po.get("history") or []) + [{"action": "rejected", "by": user["email"], "at": now.isoformat(), "comment": body.comment or ""}]
        await db.parts_orders.update_one({"po_id": po_id}, {"$set": {
            "status": "rejected", "updated_at": now, "history": hist,
        }})
        return ser(await db.parts_orders.find_one({"po_id": po_id}, {"_id": 0}))

    @api_router.post("/parts-orders/{po_id}/status")
    async def set_parts_status(po_id: str, body: PartsOrderAction, user: dict = Depends(require_user)):
        require_supervisor(user)
        if body.new_status not in ("ordered", "received", "approved", "pending_supervisor"):
            raise HTTPException(400, "invalid status")
        po = await db.parts_orders.find_one({"po_id": po_id, "team_id": user.get("team_id")}, {"_id": 0})
        if not po:
            raise HTTPException(404, "Order not found.")
        now = now_utc()
        hist = (po.get("history") or []) + [{"action": body.new_status, "by": user["email"], "at": now.isoformat(), "comment": body.comment or ""}]
        await db.parts_orders.update_one({"po_id": po_id}, {"$set": {
            "status": body.new_status, "updated_at": now, "history": hist,
        }})
        return ser(await db.parts_orders.find_one({"po_id": po_id}, {"_id": 0}))

    # -----------------------------------------------------------------
    # MODULE D — Timecards + Pay Codes + Payroll
    # -----------------------------------------------------------------
    # Default pay codes seeded per workspace. Workspace can override multipliers and rate.
    DEFAULT_PAY_CODES = [
        {"code": "regular", "label": "Regular", "multiplier": 1.0, "flat_rate_per_day": None, "is_per_diem": False},
        {"code": "overtime", "label": "Overtime", "multiplier": 1.5, "flat_rate_per_day": None, "is_per_diem": False},
        {"code": "double_time", "label": "Double-time", "multiplier": 2.0, "flat_rate_per_day": None, "is_per_diem": False},
        {"code": "per_diem", "label": "Per Diem", "multiplier": None, "flat_rate_per_day": 100.0, "is_per_diem": True},
        {"code": "days_off_premium", "label": "Days-off Premium", "multiplier": 2.0, "flat_rate_per_day": None, "is_per_diem": False},
        {"code": "travel_standby", "label": "Travel/Standby", "multiplier": 0.75, "flat_rate_per_day": None, "is_per_diem": False},
    ]

    async def _ensure_paycodes(team_id: str):
        count = await db.pay_codes.count_documents({"team_id": team_id})
        if count == 0:
            now = now_utc()
            for pc in DEFAULT_PAY_CODES:
                await db.pay_codes.insert_one({"team_id": team_id, **pc, "created_at": now, "updated_at": now})

    class PayCodeUpsert(BaseModel):
        code: str
        label: str
        multiplier: Optional[float] = None
        flat_rate_per_day: Optional[float] = None
        is_per_diem: bool = False

    @api_router.get("/paycodes")
    async def list_paycodes(user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            return {"paycodes": []}
        await _ensure_paycodes(team_id)
        docs = await db.pay_codes.find({"team_id": team_id}, {"_id": 0}).sort("code", 1).to_list(100)
        return {"paycodes": [ser(d) for d in docs]}

    @api_router.post("/paycodes")
    async def upsert_paycode(body: PayCodeUpsert, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        code = body.code.strip().lower().replace(" ", "_")
        now = now_utc()
        await db.pay_codes.update_one(
            {"team_id": team_id, "code": code},
            {"$set": {
                "label": body.label.strip(),
                "multiplier": body.multiplier,
                "flat_rate_per_day": body.flat_rate_per_day,
                "is_per_diem": bool(body.is_per_diem),
                "updated_at": now,
            }, "$setOnInsert": {"team_id": team_id, "code": code, "created_at": now}},
            upsert=True,
        )
        return ser(await db.pay_codes.find_one({"team_id": team_id, "code": code}, {"_id": 0}))

    @api_router.delete("/paycodes/{code}")
    async def delete_paycode(code: str, user: dict = Depends(require_user)):
        require_supervisor(user)
        if code in ("regular", "overtime", "double_time", "per_diem", "days_off_premium", "travel_standby"):
            raise HTTPException(400, "Default pay codes can be edited but not deleted.")
        await db.pay_codes.delete_one({"team_id": user.get("team_id"), "code": code})
        return {"success": True}

    # Per-user base rate (hourly)
    class BaseRateSet(BaseModel):
        user_id: str
        base_rate_hourly: float

    @api_router.post("/paycodes/base-rate")
    async def set_base_rate(body: BaseRateSet, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        target = await db.users.find_one({"user_id": body.user_id, "team_id": team_id}, {"_id": 0})
        if not target:
            raise HTTPException(404, "User not found in your workspace.")
        await db.users.update_one({"user_id": body.user_id}, {"$set": {"base_rate_hourly": float(body.base_rate_hourly), "base_rate_updated_at": now_utc()}})
        return {"success": True, "user_id": body.user_id, "base_rate_hourly": float(body.base_rate_hourly)}

    # Timecard lines
    class TimecardLineCreate(BaseModel):
        work_date: str  # YYYY-MM-DD
        hours: float = 0.0
        description: str
        job_number: str
        pay_code: str
        rig_id: Optional[str] = None
        # for per-diem: `hours` field is reused as "days" (per plan)

    class TimecardLineUpdate(BaseModel):
        work_date: Optional[str] = None
        hours: Optional[float] = None
        description: Optional[str] = None
        job_number: Optional[str] = None
        pay_code: Optional[str] = None
        rig_id: Optional[str] = None

    async def _compute_line_cost(team_id: str, user_doc: dict, pay_code: str, hours: float) -> Dict[str, Any]:
        pc = await db.pay_codes.find_one({"team_id": team_id, "code": pay_code}, {"_id": 0})
        if not pc:
            raise HTTPException(400, f"Unknown pay_code '{pay_code}'. Use GET /api/paycodes.")
        base = float(user_doc.get("base_rate_hourly") or 0.0)
        if pc.get("is_per_diem"):
            total = (pc.get("flat_rate_per_day") or 0.0) * hours
            return {"pay_code_label": pc["label"], "rate_used": pc.get("flat_rate_per_day") or 0.0, "multiplier": None, "line_total": round(total, 2)}
        mult = float(pc.get("multiplier") or 1.0)
        line_total = base * mult * hours
        return {"pay_code_label": pc["label"], "rate_used": base, "multiplier": mult, "line_total": round(line_total, 2)}

    @api_router.post("/timecards/lines")
    async def create_tc_line(body: TimecardLineCreate, user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        await _ensure_paycodes(team_id)
        wd = _parse_date(body.work_date)
        cost = await _compute_line_cost(team_id, user, body.pay_code, float(body.hours))
        line_id = f"tcl_{uuid.uuid4().hex[:12]}"
        now = now_utc()
        doc = {
            "line_id": line_id, "team_id": team_id,
            "user_id": user["user_id"], "user_email": user["email"],
            "user_name": user.get("name") or "",
            "work_date": wd, "hours": float(body.hours),
            "description": body.description.strip()[:500],
            "job_number": body.job_number.strip()[:60],
            "pay_code": body.pay_code,
            "rig_id": body.rig_id,
            **cost,
            "status": "draft",   # draft | submitted | approved_supervisor | approved_payroll | rejected
            "history": [{"action": "created", "by": user["email"], "at": now.isoformat()}],
            "created_at": now, "updated_at": now,
        }
        await db.timecard_lines.insert_one(doc)
        doc.pop("_id", None)
        return ser(doc)

    @api_router.get("/timecards/lines")
    async def list_tc_lines(
        user_id: Optional[str] = None,
        status: Optional[str] = None,
        start: Optional[str] = None,
        end: Optional[str] = None,
        user: dict = Depends(require_user),
    ):
        team_id = user.get("team_id")
        if not team_id:
            return {"lines": []}
        q: Dict[str, Any] = {"team_id": team_id}
        # Access: crew sees own; supervisor+ sees all team
        if not is_supervisor_or_higher(user):
            q["user_id"] = user["user_id"]
        else:
            if user_id:
                q["user_id"] = user_id
        if status: q["status"] = status
        if start or end:
            q["work_date"] = {}
            if start: q["work_date"]["$gte"] = _parse_date(start)
            if end:   q["work_date"]["$lte"] = _parse_date(end)
        docs = await db.timecard_lines.find(q, {"_id": 0}).sort([("work_date", -1), ("created_at", -1)]).to_list(2000)
        return {"lines": [ser(d) for d in docs]}

    @api_router.patch("/timecards/lines/{line_id}")
    async def patch_tc_line(line_id: str, body: TimecardLineUpdate, user: dict = Depends(require_user)):
        line = await db.timecard_lines.find_one({"line_id": line_id, "team_id": user.get("team_id")}, {"_id": 0})
        if not line:
            raise HTTPException(404, "Line not found.")
        is_owner = line["user_id"] == user["user_id"]
        is_sup = is_supervisor_or_higher(user)
        if not (is_owner or is_sup):
            raise HTTPException(403, "Not allowed.")
        # Owners can edit only while in draft/rejected; supervisor can edit until approved_payroll
        if is_owner and line["status"] not in ("draft", "rejected", "submitted"):
            raise HTTPException(400, "Line already approved. Supervisor must edit.")
        if line["status"] == "approved_payroll":
            raise HTTPException(400, "Line locked by payroll approval.")
        update: Dict[str, Any] = {"updated_at": now_utc()}
        new_pay_code = body.pay_code if body.pay_code is not None else line["pay_code"]
        new_hours = float(body.hours) if body.hours is not None else float(line["hours"])
        if body.work_date is not None:   update["work_date"] = _parse_date(body.work_date)
        if body.description is not None: update["description"] = body.description.strip()[:500]
        if body.job_number is not None:  update["job_number"] = body.job_number.strip()[:60]
        if body.rig_id is not None:      update["rig_id"] = body.rig_id or None
        if body.pay_code is not None or body.hours is not None:
            target_user = await db.users.find_one({"user_id": line["user_id"]}, {"_id": 0}) or user
            cost = await _compute_line_cost(user["team_id"], target_user, new_pay_code, new_hours)
            update.update(cost)
            update["pay_code"] = new_pay_code
            update["hours"] = new_hours
        hist = line.get("history", []) + [{"action": "edited", "by": user["email"], "at": now_utc().isoformat()}]
        update["history"] = hist
        await db.timecard_lines.update_one({"line_id": line_id}, {"$set": update})
        return ser(await db.timecard_lines.find_one({"line_id": line_id}, {"_id": 0}))

    @api_router.delete("/timecards/lines/{line_id}")
    async def delete_tc_line(line_id: str, user: dict = Depends(require_user)):
        line = await db.timecard_lines.find_one({"line_id": line_id, "team_id": user.get("team_id")}, {"_id": 0})
        if not line:
            raise HTTPException(404, "Line not found.")
        is_owner = line["user_id"] == user["user_id"]
        if not (is_owner or is_supervisor_or_higher(user)):
            raise HTTPException(403, "Not allowed.")
        if line["status"] in ("approved_supervisor", "approved_payroll"):
            raise HTTPException(400, "Line locked by approval chain.")
        await db.timecard_lines.delete_one({"line_id": line_id})
        return {"success": True}

    class TCBatchAction(BaseModel):
        line_ids: List[str]
        comment: Optional[str] = None

    @api_router.post("/timecards/submit")
    async def submit_timecard(body: TCBatchAction, user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        now = now_utc()
        n = 0
        for lid in body.line_ids:
            res = await db.timecard_lines.update_one(
                {"line_id": lid, "team_id": team_id, "user_id": user["user_id"], "status": {"$in": ["draft", "rejected"]}},
                {"$set": {"status": "submitted", "submitted_at": now, "updated_at": now},
                 "$push": {"history": {"action": "submitted", "by": user["email"], "at": now.isoformat(), "comment": body.comment or ""}}},
            )
            n += res.modified_count
        return {"submitted": n}

    @api_router.post("/timecards/approve-supervisor")
    async def approve_tc_supervisor(body: TCBatchAction, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        now = now_utc()
        n = 0
        for lid in body.line_ids:
            res = await db.timecard_lines.update_one(
                {"line_id": lid, "team_id": team_id, "status": "submitted"},
                {"$set": {"status": "approved_supervisor", "supervisor_approved_by": user["email"], "supervisor_approved_at": now, "updated_at": now},
                 "$push": {"history": {"action": "approved_supervisor", "by": user["email"], "at": now.isoformat(), "comment": body.comment or ""}}},
            )
            n += res.modified_count
        return {"approved": n}

    @api_router.post("/timecards/approve-payroll")
    async def approve_tc_payroll(body: TCBatchAction, user: dict = Depends(require_user)):
        require_management(user)
        team_id = user.get("team_id")
        now = now_utc()
        n = 0
        for lid in body.line_ids:
            res = await db.timecard_lines.update_one(
                {"line_id": lid, "team_id": team_id, "status": "approved_supervisor"},
                {"$set": {"status": "approved_payroll", "payroll_approved_by": user["email"], "payroll_approved_at": now, "updated_at": now},
                 "$push": {"history": {"action": "approved_payroll", "by": user["email"], "at": now.isoformat(), "comment": body.comment or ""}}},
            )
            n += res.modified_count
        return {"approved": n}

    @api_router.post("/timecards/reject")
    async def reject_tc(body: TCBatchAction, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        now = now_utc()
        n = 0
        for lid in body.line_ids:
            res = await db.timecard_lines.update_one(
                {"line_id": lid, "team_id": team_id, "status": {"$in": ["submitted", "approved_supervisor"]}},
                {"$set": {"status": "rejected", "rejected_by": user["email"], "rejected_at": now, "updated_at": now,
                          "rejection_comment": body.comment or ""},
                 "$push": {"history": {"action": "rejected", "by": user["email"], "at": now.isoformat(), "comment": body.comment or ""}}},
            )
            n += res.modified_count
        return {"rejected": n}

    @api_router.get("/timecards/export")
    async def export_timecards(
        start: str, end: str,
        status: Optional[str] = "approved_payroll",
        user: dict = Depends(require_user),
    ):
        require_supervisor(user)
        team_id = user.get("team_id")
        s = _parse_date(start); e = _parse_date(end)
        q: Dict[str, Any] = {"team_id": team_id, "work_date": {"$gte": s, "$lte": e}}
        if status and status != "any":
            q["status"] = status
        lines = await db.timecard_lines.find(q, {"_id": 0}).sort([("user_email", 1), ("work_date", 1)]).to_list(10000)
        # CSV
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["user_name", "user_email", "work_date", "job_number", "pay_code", "hours_or_days", "rate_used", "multiplier", "line_total_usd", "description", "rig_id", "status"])
        for ln in lines:
            w.writerow([
                ln.get("user_name") or "", ln.get("user_email") or "",
                (ln["work_date"].isoformat()[:10] if isinstance(ln.get("work_date"), datetime) else ln.get("work_date") or ""),
                ln.get("job_number") or "", ln.get("pay_code") or "",
                ln.get("hours") or 0, ln.get("rate_used") or 0, ln.get("multiplier") or "",
                ln.get("line_total") or 0, (ln.get("description") or "").replace("\n", " "),
                ln.get("rig_id") or "", ln.get("status") or "",
            ])
        return {"csv": out.getvalue(), "row_count": len(lines)}

    return api_router
