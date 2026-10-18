"""
Phase 1 modules: RBAC, Reels, Fatigue, Surveys, Certifications,
Tasks, Job Packages, Parts Approval, Timecards, Pay Codes, Payroll.

Imported by server.py — relies on `api_router`, `db`, `require_user`,
`get_current_user`, `_serialize`, `_is_admin`, and `_user_role` from server.py.
"""

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Response
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import csv
import io
import math
import uuid


# ---------- RBAC: four-role mapping with legacy aliases ----------
# Plan roles: guest | crew | supervisor | management
# Legacy roles (kept on DB rows):  guest | crew | field_manager | ops_manager
LEGACY_TO_PLAN = {
    "guest": "guest",
    "crew": "crew",
    "field_manager": "supervisor",
    "ops_manager": "management",
    "supervisor": "supervisor",
    "management": "management",
    "admin": "management",
}
PLAN_TO_LEGACY = {
    "guest": "guest",
    "crew": "crew",
    "supervisor": "field_manager",
    "management": "ops_manager",
}


def role_of(user: dict) -> str:
    raw = (user or {}).get("role") or "crew"
    return LEGACY_TO_PLAN.get(raw, "crew")


def is_guest(user: dict) -> bool:
    return role_of(user) == "guest"


def is_crew_or_higher(user: dict) -> bool:
    return role_of(user) in ("crew", "supervisor", "management")


def is_supervisor_or_higher(user: dict) -> bool:
    return role_of(user) in ("supervisor", "management")


def is_management(user: dict) -> bool:
    return role_of(user) == "management"


def require_crew(user: dict) -> dict:
    """Blocks guests from writing internal data (pay, schedule, parts, etc.)."""
    if not is_crew_or_higher(user):
        raise HTTPException(403, "Crew role or higher required (guest is view-only operational).")
    return user


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

    # -----------------------------------------------------------------
    # USER PREFS — Hub tile customization, home page, live-ops layout
    # -----------------------------------------------------------------
    DEFAULT_HUB_TILES = [
        "live-ops", "workbook", "ctd-calculator", "reels", "stress", "fatigue",
        "wellbore", "certs", "tasks", "parts-orders", "timecards", "crew-admin",
        "documents", "team-hub", "treatment", "handover", "ai-sop", "crew-contacts",
    ]

    class UserPrefsUpdate(BaseModel):
        hub_tiles: Optional[List[Dict[str, Any]]] = None  # [{id,visible,order}]
        home_default: Optional[str] = None  # 'hub' | 'live-ops' | 'workbook'
        liveops_layout: Optional[List[str]] = None  # ordered panel ids: ['vm','fatigue','weight','pressure','chart']

    @api_router.get("/me/prefs")
    async def get_my_prefs(user: dict = Depends(require_user)):
        p = await db.user_prefs.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
        defaults = {
            "user_id": user["user_id"],
            "hub_tiles": [{"id": t, "visible": True, "order": i} for i, t in enumerate(DEFAULT_HUB_TILES)],
            "home_default": "hub",
            "liveops_layout": ["vm", "fatigue", "weight", "pressure", "chart"],
        }
        for k, v in defaults.items():
            p.setdefault(k, v)
        return ser(p)

    @api_router.patch("/me/prefs")
    async def patch_my_prefs(body: UserPrefsUpdate, user: dict = Depends(require_user)):
        update: Dict[str, Any] = {"updated_at": now_utc()}
        if body.hub_tiles is not None:
            # Keep only known tiles, re-order
            seen = set()
            clean = []
            for t in body.hub_tiles:
                tid = str(t.get("id") or "")
                if not tid or tid in seen:
                    continue
                seen.add(tid)
                clean.append({"id": tid, "visible": bool(t.get("visible", True)), "order": int(t.get("order", len(clean)))})
            clean.sort(key=lambda x: x["order"])
            update["hub_tiles"] = clean
        if body.home_default is not None:
            if body.home_default not in ("hub", "live-ops", "workbook"):
                raise HTTPException(400, "home_default must be hub|live-ops|workbook")
            update["home_default"] = body.home_default
        if body.liveops_layout is not None:
            update["liveops_layout"] = [str(s) for s in body.liveops_layout]
        await db.user_prefs.update_one(
            {"user_id": user["user_id"]},
            {"$set": update, "$setOnInsert": {"user_id": user["user_id"], "created_at": now_utc()}},
            upsert=True,
        )
        p = await db.user_prefs.find_one({"user_id": user["user_id"]}, {"_id": 0})
        return ser(p)

    # -----------------------------------------------------------------
    # LIVE OPS — DAQ feed ring buffer (weight, pressure, depth)
    # -----------------------------------------------------------------
    # Phase 1: client-side simulator POSTs samples; team sees the latest.
    # Phase 2 will swap in real WITS 0 / WITSML / Modbus listeners.
    LIVEOPS_MAX_SAMPLES = 600  # ~10 min @ 1 Hz

    class LiveSample(BaseModel):
        rig_id: Optional[str] = None
        reel_id: Optional[str] = None
        weight_lb: Optional[float] = None
        pressure_psi: Optional[float] = None
        traction_pressure_psi: Optional[float] = None
        depth_ft: Optional[float] = None
        p_internal_psi: Optional[float] = None
        p_external_psi: Optional[float] = None
        axial_force_lbf: Optional[float] = None
        source: str = "simulated"  # 'simulated' | 'wits' | 'modbus' | 'manual'

    @api_router.post("/liveops/feed")
    async def feed_liveops(body: LiveSample, user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        now = now_utc()
        doc = {**body.model_dump(), "team_id": team_id, "created_at": now, "user_email": user["email"]}
        await db.liveops_samples.insert_one(doc)
        # Keep only the last N samples per team (soft cap, pruned opportunistically)
        count = await db.liveops_samples.count_documents({"team_id": team_id})
        if count > LIVEOPS_MAX_SAMPLES * 2:
            cutoff = await db.liveops_samples.find({"team_id": team_id}, {"created_at": 1, "_id": 0}).sort("created_at", -1).skip(LIVEOPS_MAX_SAMPLES).limit(1).to_list(1)
            if cutoff:
                await db.liveops_samples.delete_many({"team_id": team_id, "created_at": {"$lt": cutoff[0]["created_at"]}})
        doc.pop("_id", None)
        return ser(doc)

    @api_router.get("/liveops/stream")
    async def stream_liveops(
        limit: int = 300,
        since: Optional[str] = None,
        user: dict = Depends(require_user),
    ):
        team_id = user.get("team_id")
        if not team_id:
            return {"samples": [], "latest": None}
        q: Dict[str, Any] = {"team_id": team_id}
        if since:
            try:
                q["created_at"] = {"$gt": datetime.fromisoformat(since.replace("Z", "+00:00"))}
            except Exception:
                pass
        docs = await db.liveops_samples.find(q, {"_id": 0}).sort("created_at", -1).limit(min(limit, LIVEOPS_MAX_SAMPLES)).to_list(min(limit, LIVEOPS_MAX_SAMPLES))
        docs.reverse()
        latest = docs[-1] if docs else None
        return {"samples": [ser(d) for d in docs], "latest": ser(latest) if latest else None}

    @api_router.delete("/liveops/stream")
    async def clear_liveops(user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        res = await db.liveops_samples.delete_many({"team_id": team_id})
        return {"cleared": res.deleted_count}

    @api_router.post("/rbac/promote")
    async def rbac_promote(body: RolePromote, user: dict = Depends(require_user)):
        require_supervisor(user)
        if body.role not in ("guest", "crew", "supervisor", "management"):
            raise HTTPException(400, "role must be guest|crew|supervisor|management")
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
        # Phase 2 Module 4: multiply by reel's K_t (gripper block stress concentration)
        k_t = float(reel.get("k_t") or 1.0)
        uplift *= k_t
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
    # Default pay codes seeded per workspace. Workspace can override multipliers, rates, labels.
    # Rate resolution per line:
    #   • is_per_diem=True   → total = flat_rate_per_day × days
    #   • flat_rate_per_hour → total = flat_rate_per_hour × hours (overrides base rate)
    #   • multiplier         → total = base_rate_hourly × multiplier × hours
    DEFAULT_PAY_CODES = [
        {"code": "regular", "label": "Regular (base rate)", "multiplier": 1.0, "flat_rate_per_hour": None, "flat_rate_per_day": None, "is_per_diem": False},
        {"code": "overtime", "label": "Overtime (1.5×)", "multiplier": 1.5, "flat_rate_per_hour": None, "flat_rate_per_day": None, "is_per_diem": False},
        {"code": "double_time", "label": "Double-time (2.0×)", "multiplier": 2.0, "flat_rate_per_hour": None, "flat_rate_per_day": None, "is_per_diem": False},
        {"code": "field_rate", "label": "Field rate", "multiplier": None, "flat_rate_per_hour": 60.0, "flat_rate_per_day": None, "is_per_diem": False},
        {"code": "shop_rate", "label": "Shop rate", "multiplier": None, "flat_rate_per_hour": 40.0, "flat_rate_per_day": None, "is_per_diem": False},
        {"code": "travel_rate", "label": "Travel rate", "multiplier": None, "flat_rate_per_hour": 35.0, "flat_rate_per_day": None, "is_per_diem": False},
        {"code": "moving_equipment", "label": "Moving equipment", "multiplier": None, "flat_rate_per_hour": 55.0, "flat_rate_per_day": None, "is_per_diem": False},
        {"code": "per_diem", "label": "Per Diem (days)", "multiplier": None, "flat_rate_per_hour": None, "flat_rate_per_day": 100.0, "is_per_diem": True},
        {"code": "days_off_premium", "label": "Days-off premium (2.0×)", "multiplier": 2.0, "flat_rate_per_hour": None, "flat_rate_per_day": None, "is_per_diem": False},
        {"code": "standby", "label": "Standby (0.75×)", "multiplier": 0.75, "flat_rate_per_hour": None, "flat_rate_per_day": None, "is_per_diem": False},
    ]

    async def _ensure_paycodes(team_id: str):
        """Seed default pay codes and backfill any missing new defaults for existing workspaces."""
        existing_codes = set()
        async for d in db.pay_codes.find({"team_id": team_id}, {"code": 1, "_id": 0}):
            existing_codes.add(d["code"])
        now = now_utc()
        for pc in DEFAULT_PAY_CODES:
            if pc["code"] not in existing_codes:
                await db.pay_codes.insert_one({"team_id": team_id, **pc, "created_at": now, "updated_at": now})
        # Migration: rename legacy 'travel_standby' label if it still exists
        await db.pay_codes.update_one(
            {"team_id": team_id, "code": "travel_standby"},
            {"$set": {"label": "Standby (legacy)"}},
        )

    class PayCodeUpsert(BaseModel):
        code: str
        label: str
        multiplier: Optional[float] = None
        flat_rate_per_hour: Optional[float] = None
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
                "flat_rate_per_hour": body.flat_rate_per_hour,
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
        # Default codes can be edited but not deleted
        if code in {pc["code"] for pc in DEFAULT_PAY_CODES}:
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
        if pc.get("is_per_diem"):
            rate = float(pc.get("flat_rate_per_day") or 0.0)
            total = rate * hours  # 'hours' here means 'days'
            return {"pay_code_label": pc["label"], "rate_used": rate, "multiplier": None, "line_total": round(total, 2)}
        # Flat hourly rate on the pay code overrides base rate
        if pc.get("flat_rate_per_hour") is not None:
            rate = float(pc["flat_rate_per_hour"])
            return {"pay_code_label": pc["label"], "rate_used": rate, "multiplier": None, "line_total": round(rate * hours, 2)}
        # Otherwise: base rate × multiplier
        base = float(user_doc.get("base_rate_hourly") or 0.0)
        mult = float(pc.get("multiplier") or 1.0)
        return {"pay_code_label": pc["label"], "rate_used": base, "multiplier": mult, "line_total": round(base * mult * hours, 2)}

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

    class TimecardShiftActivity(BaseModel):
        hours: float
        pay_code: str
        description: str

    class TimecardShiftBatch(BaseModel):
        work_date: str
        job_number: str
        rig_id: Optional[str] = None
        activities: List[TimecardShiftActivity]

    @api_router.post("/timecards/shift")
    async def create_tc_shift(body: TimecardShiftBatch, user: dict = Depends(require_user)):
        """One shift = one date + one job #, but multiple activities at different rates
        (shop, field, travel, moving equipment, OT, per-diem day, etc.) in one submission."""
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        if not body.activities:
            raise HTTPException(400, "At least one activity required.")
        await _ensure_paycodes(team_id)
        wd = _parse_date(body.work_date)
        now = now_utc()
        inserted: List[Dict[str, Any]] = []
        for act in body.activities:
            if float(act.hours) <= 0:
                continue
            cost = await _compute_line_cost(team_id, user, act.pay_code, float(act.hours))
            line_id = f"tcl_{uuid.uuid4().hex[:12]}"
            doc = {
                "line_id": line_id, "team_id": team_id,
                "user_id": user["user_id"], "user_email": user["email"],
                "user_name": user.get("name") or "",
                "work_date": wd, "hours": float(act.hours),
                "description": act.description.strip()[:500],
                "job_number": body.job_number.strip()[:60],
                "pay_code": act.pay_code,
                "rig_id": body.rig_id,
                **cost,
                "status": "draft",
                "shift_batch_id": f"shift_{wd.strftime('%Y%m%d')}_{user['user_id']}_{int(now.timestamp())}",
                "history": [{"action": "created", "by": user["email"], "at": now.isoformat()}],
                "created_at": now, "updated_at": now,
            }
            await db.timecard_lines.insert_one(doc)
            doc.pop("_id", None)
            inserted.append(ser(doc))
        if not inserted:
            raise HTTPException(400, "All activities had zero hours.")
        return {"inserted": inserted, "count": len(inserted), "total": sum(d["line_total"] for d in inserted)}

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

    # -----------------------------------------------------------------
    # PHASE 2 — DAQ Configs + Listener skeletons (WITS 0 / Modbus / WITSML)
    # -----------------------------------------------------------------
    # Phase 2 SCAFFOLD: stores connection profiles + an in-process "listener"
    # status flag. Real socket/serial listeners get bolted on when field
    # testing starts. The Live Ops page "Connected to unit" button reads
    # this collection to show real status.
    SUPPORTED_PROTOCOLS = {"wits0_tcp", "wits0_serial", "modbus_tcp", "witsml_rest"}

    class DaqConfig(BaseModel):
        name: str
        protocol: str
        host: Optional[str] = None
        port: Optional[int] = None
        serial_port: Optional[str] = None
        baud: Optional[int] = 9600
        witsml_url: Optional[str] = None
        witsml_version: Optional[str] = "1.4.1.1"
        rig_id: Optional[str] = None
        channel_map: Optional[Dict[str, str]] = None
        enabled: bool = False
        notes: Optional[str] = None

    @api_router.get("/daq/configs")
    async def list_daq_configs(user: dict = Depends(require_user)):
        require_crew(user)  # guests cannot see DAQ internals
        team_id = user.get("team_id")
        if not team_id:
            return {"configs": []}
        docs = await db.daq_configs.find({"team_id": team_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"configs": [ser(d) for d in docs]}

    @api_router.post("/daq/configs")
    async def create_daq_config(body: DaqConfig, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        if body.protocol not in SUPPORTED_PROTOCOLS:
            raise HTTPException(400, f"protocol must be one of {sorted(SUPPORTED_PROTOCOLS)}")
        config_id = f"daq_{uuid.uuid4().hex[:12]}"
        now = now_utc()
        doc = {
            "config_id": config_id, "team_id": team_id,
            **body.model_dump(),
            "status": "idle",             # idle | connecting | connected | error
            "last_sample_at": None,
            "last_error": None,
            "created_by": user["email"], "created_at": now, "updated_at": now,
        }
        await db.daq_configs.insert_one(doc)
        doc.pop("_id", None)
        return ser(doc)

    class DaqConfigPatch(BaseModel):
        name: Optional[str] = None
        host: Optional[str] = None
        port: Optional[int] = None
        serial_port: Optional[str] = None
        baud: Optional[int] = None
        witsml_url: Optional[str] = None
        witsml_version: Optional[str] = None
        rig_id: Optional[str] = None
        channel_map: Optional[Dict[str, str]] = None
        enabled: Optional[bool] = None
        notes: Optional[str] = None

    @api_router.patch("/daq/configs/{config_id}")
    async def patch_daq_config(config_id: str, body: DaqConfigPatch, user: dict = Depends(require_user)):
        require_supervisor(user)
        cfg = await db.daq_configs.find_one({"config_id": config_id, "team_id": user.get("team_id")}, {"_id": 0})
        if not cfg:
            raise HTTPException(404, "Config not found.")
        update = {k: v for k, v in body.model_dump().items() if v is not None}
        update["updated_at"] = now_utc()
        # Toggling enabled flips status to connecting (listener engages on next tick)
        if body.enabled is True and cfg.get("status") != "connected":
            update["status"] = "connecting"
        if body.enabled is False:
            update["status"] = "idle"
        await db.daq_configs.update_one({"config_id": config_id}, {"$set": update})
        return ser(await db.daq_configs.find_one({"config_id": config_id}, {"_id": 0}))

    @api_router.delete("/daq/configs/{config_id}")
    async def delete_daq_config(config_id: str, user: dict = Depends(require_user)):
        require_supervisor(user)
        res = await db.daq_configs.delete_one({"config_id": config_id, "team_id": user.get("team_id")})
        if res.deleted_count == 0:
            raise HTTPException(404, "Config not found.")
        return {"success": True}

    class DaqStatusPatch(BaseModel):
        """Called by in-process listener (Phase 2) or health check to flip status."""
        status: str  # idle | connecting | connected | error
        last_error: Optional[str] = None
        last_sample_at: Optional[str] = None

    @api_router.post("/daq/configs/{config_id}/status")
    async def set_daq_status(config_id: str, body: DaqStatusPatch, user: dict = Depends(require_user)):
        require_crew(user)
        cfg = await db.daq_configs.find_one({"config_id": config_id, "team_id": user.get("team_id")}, {"_id": 0})
        if not cfg:
            raise HTTPException(404, "Not found.")
        if body.status not in ("idle", "connecting", "connected", "error"):
            raise HTTPException(400, "invalid status")
        update: Dict[str, Any] = {"status": body.status, "updated_at": now_utc()}
        if body.last_error is not None:
            update["last_error"] = body.last_error
        if body.last_sample_at is not None:
            try:
                update["last_sample_at"] = datetime.fromisoformat(body.last_sample_at.replace("Z", "+00:00"))
            except Exception:
                pass
        await db.daq_configs.update_one({"config_id": config_id}, {"$set": update})
        return {"success": True}

    # -----------------------------------------------------------------
    # PHASE 2 — Module 4 scaffold: K_t (stress concentration) per reel
    # -----------------------------------------------------------------
    # Updated fatigue uplift uses: uplift *= K_t (gripper block ovality factor).
    # Default K_t = 1.0 (neutral) until test data lands.
    class KtSet(BaseModel):
        reel_id: str
        k_t: float  # 1.0 .. 2.0 typical

    @api_router.post("/fatigue/kt")
    async def set_kt(body: KtSet, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        reel = await db.reels.find_one({"reel_id": body.reel_id, "team_id": team_id}, {"_id": 0})
        if not reel:
            raise HTTPException(404, "Reel not found.")
        if not (0.5 <= body.k_t <= 3.0):
            raise HTTPException(400, "k_t must be between 0.5 and 3.0")
        await db.reels.update_one({"reel_id": body.reel_id}, {"$set": {"k_t": body.k_t, "kt_updated_at": now_utc()}})
        return {"success": True, "reel_id": body.reel_id, "k_t": body.k_t}

    # -----------------------------------------------------------------
    # PHASE 2 — Engineering Audit Dossier (default outline, HTML/markdown)
    # -----------------------------------------------------------------
    @api_router.get("/dossier")
    async def generate_dossier(
        start: Optional[str] = None,
        end: Optional[str] = None,
        user: dict = Depends(require_user),
    ):
        require_crew(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        # Window: default = last 24 h
        now = now_utc()
        try:
            start_dt = datetime.fromisoformat(start) if start else now - timedelta(hours=24)
            end_dt = datetime.fromisoformat(end) if end else now
        except Exception:
            raise HTTPException(400, "Invalid start/end ISO date.")

        active_reel = await db.reels.find_one({"team_id": team_id, "is_active": True}, {"_id": 0})
        samples = await db.liveops_samples.find(
            {"team_id": team_id, "created_at": {"$gte": start_dt, "$lte": end_dt}},
            {"_id": 0}
        ).sort("created_at", 1).to_list(2000)
        treatments = await db.treatments.find({"team_id": team_id}, {"_id": 0}).sort("started_at", -1).limit(5).to_list(5)
        tc_lines = await db.timecard_lines.find(
            {"team_id": team_id, "work_date": {"$gte": start_dt, "$lte": end_dt}},
            {"_id": 0, "user_name": 1, "hours": 1, "pay_code_label": 1, "job_number": 1, "description": 1}
        ).limit(200).to_list(200)
        fatigue = await db.reel_fatigue.find_one({"reel_id": (active_reel or {}).get("reel_id")}, {"_id": 0}) if active_reel else None

        # Compute sparkline summaries
        def sparkline(series_key: str):
            vals = [s.get(series_key) for s in samples if isinstance(s.get(series_key), (int, float))]
            if not vals:
                return {"min": None, "max": None, "avg": None, "count": 0}
            return {"min": min(vals), "max": max(vals), "avg": sum(vals) / len(vals), "count": len(vals)}

        # Alerts: any sample that would push VM past 0.80 at active reel
        alerts: List[Dict[str, Any]] = []
        if active_reel and active_reel.get("intervals"):
            seg = active_reel["intervals"][0]
            smys = seg.get("smys_psi", 90000)
            safe = 0.8 * smys
            r_m = ((seg["od_in"] - seg["wt_in"]) / 2.0)
            area = math.pi * ((seg["od_in"] / 2) ** 2 - ((seg["od_in"] - 2 * seg["wt_in"]) / 2) ** 2)
            for s in samples:
                dp = (s.get("p_internal_psi") or 0) - (s.get("p_external_psi") or 0)
                F = s.get("axial_force_lbf") or 0
                sh = dp * r_m / max(seg["wt_in"], 1e-6)
                sa = F / max(area, 1e-6)
                vm = math.sqrt(sh * sh - sh * sa + sa * sa)
                if vm >= safe:
                    alerts.append({"ts": s.get("created_at").isoformat() if isinstance(s.get("created_at"), datetime) else s.get("created_at"),
                                   "vm": round(vm, 0), "pct_of_safe": round(vm / safe * 100, 1)})

        dossier = {
            "team_id": team_id,
            "generated_at": now.isoformat(),
            "generated_by": user["email"],
            "window": {"start": start_dt.isoformat(), "end": end_dt.isoformat()},
            "job_header": {
                "crew_lead": user.get("name") or user.get("email"),
                "active_reel": ser(active_reel) if active_reel else None,
                "fatigue_worst": max(fatigue.get("damage") or [0]) if fatigue else 0.0,
                "fatigue_spacing_ft": (fatigue or {}).get("spacing_ft", 100),
            },
            "pump_schedule": [{"treatment": t.get("name"), "started_at": t.get("started_at").isoformat() if isinstance(t.get("started_at"), datetime) else t.get("started_at"), "entries": t.get("entry_count", 0)} for t in treatments],
            "recorded_channels": {
                "weight_lb": sparkline("weight_lb"),
                "p_internal_psi": sparkline("p_internal_psi"),
                "p_external_psi": sparkline("p_external_psi"),
                "traction_pressure_psi": sparkline("traction_pressure_psi"),
                "axial_force_lbf": sparkline("axial_force_lbf"),
                "depth_ft": sparkline("depth_ft"),
            },
            "vm_alerts": alerts[:50],
            "vm_alert_count": len(alerts),
            "fatigue_delta": {
                "worst_damage_now": max((fatigue or {}).get("damage") or [0]) if fatigue else 0.0,
                "node_count": ((fatigue or {}).get("damage") or []).__len__(),
            },
            "crew_hours": [{
                "user_name": ln.get("user_name"),
                "pay_code": ln.get("pay_code_label"),
                "hours": ln.get("hours"),
                "job_number": ln.get("job_number"),
                "description": ln.get("description"),
            } for ln in tc_lines],
            "crew_signatures": [],  # populated client-side at print time
            "sample_count": len(samples),
        }
        return dossier

    # -----------------------------------------------------------------
    # PHASE 2 — Guest Share Links (7-day read-only URL to Live Ops)
    # -----------------------------------------------------------------
    import secrets as _secrets

    class ShareLinkCreate(BaseModel):
        label: Optional[str] = None
        days: int = 7

    @api_router.post("/share-links")
    async def create_share_link(body: ShareLinkCreate, user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        days = max(1, min(int(body.days or 7), 30))
        token = _secrets.token_urlsafe(32)
        link_id = f"share_{uuid.uuid4().hex[:12]}"
        now = now_utc()
        expires_at = now + timedelta(days=days)
        doc = {
            "link_id": link_id, "team_id": team_id, "token": token,
            "label": (body.label or "Client view").strip()[:80],
            "created_by": user["email"], "created_at": now,
            "expires_at": expires_at, "revoked": False,
            "last_used_at": None, "use_count": 0,
        }
        await db.share_links.insert_one(doc)
        doc.pop("_id", None)
        return ser({**doc, "share_url_path": f"/share/{token}"})

    @api_router.get("/share-links")
    async def list_share_links(user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        if not team_id:
            return {"links": []}
        docs = await db.share_links.find({"team_id": team_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
        now = now_utc()
        out = []
        for d in docs:
            exp = d.get("expires_at")
            if isinstance(exp, datetime) and exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            d["is_expired"] = bool(isinstance(exp, datetime) and exp < now)
            d["share_url_path"] = f"/share/{d['token']}"
            out.append(ser(d))
        return {"links": out}

    @api_router.delete("/share-links/{link_id}")
    async def revoke_share_link(link_id: str, user: dict = Depends(require_user)):
        require_supervisor(user)
        res = await db.share_links.update_one(
            {"link_id": link_id, "team_id": user.get("team_id")},
            {"$set": {"revoked": True, "revoked_at": now_utc(), "revoked_by": user["email"]}},
        )
        if res.matched_count == 0:
            raise HTTPException(404, "Not found.")
        return {"success": True}

    # -----------------------------------------------------------------
    # PHASE 2 — Playback Annotations (manual + rig-computer sourced)
    # Timestamped notes on the Live Ops timeline, visible in playback,
    # exported in CSV/LAS. Rig-computer rules (threshold-driven) write
    # to the same collection via /liveops/annotations/ingest. The
    # ingest pathway is the hand-off point for real WITS 0 / Modbus
    # listeners (Phase 2) and currently accepts jobs from the browser
    # simulator or any trusted feeder.
    # -----------------------------------------------------------------
    SEVERITIES = ("info", "warn", "critical")

    class AnnotationCreate(BaseModel):
        timestamp_ms: int                      # unix epoch ms of the sample this note refers to
        note: str
        severity: str = "info"                 # info | warn | critical
        depth_ft: Optional[float] = None       # snapshot of depth at drop time (optional)
        channel: Optional[str] = None          # e.g. "pressure_psi", "weight_lb" — if attached to one series
        value: Optional[float] = None          # snapshotted channel value

    class AnnotationIngestItem(BaseModel):
        timestamp_ms: int
        note: str
        severity: str = "warn"
        rule_id: Optional[str] = None          # which threshold rule fired
        channel: Optional[str] = None
        value: Optional[float] = None
        depth_ft: Optional[float] = None

    class AnnotationIngest(BaseModel):
        items: List[AnnotationIngestItem]
        source: str = "rig_computer"           # 'rig_computer' | 'daq_rule' | 'wits0' | 'modbus' | 'witsml'

    class AnnotationUpdate(BaseModel):
        note: Optional[str] = None
        severity: Optional[str] = None

    def _ser_annot(d: dict) -> dict:
        return ser(d)

    @api_router.post("/liveops/annotations")
    async def create_annotation(body: AnnotationCreate, user: dict = Depends(require_user)):
        """Supervisor-or-higher drops a timestamped note on the playback timeline."""
        require_supervisor(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        sev = (body.severity or "info").lower()
        if sev not in SEVERITIES:
            raise HTTPException(400, f"severity must be one of {SEVERITIES}")
        note = (body.note or "").strip()
        if not note:
            raise HTTPException(400, "note required")
        annot_id = f"annot_{uuid.uuid4().hex[:12]}"
        doc = {
            "annot_id": annot_id,
            "team_id": team_id,
            "timestamp_ms": int(body.timestamp_ms),
            "note": note[:500],
            "severity": sev,
            "depth_ft": body.depth_ft,
            "channel": body.channel,
            "value": body.value,
            "author_user_id": user["user_id"],
            "author_name": user.get("name") or user.get("email"),
            "author_email": user.get("email"),
            "source": "manual",
            "rule_id": None,
            "created_at": now_utc(),
        }
        await db.playback_annotations.insert_one(doc)
        doc.pop("_id", None)
        return _ser_annot(doc)

    @api_router.post("/liveops/annotations/ingest")
    async def ingest_annotations(body: AnnotationIngest, user: dict = Depends(require_user)):
        """
        Rig-computer / DAQ ingest pathway. Accepts a batch of auto-generated
        notes (e.g. "pressure spike at 9120 psi — exceeded 9000 psi hard cap").
        Any crew+ user may call this (the rig computer runs under a team session).
        Phase 2 hand-off: real WITS 0 / Modbus / WITSML listeners will POST
        here after evaluating threshold rules (see /liveops/annotations/rules).
        """
        require_crew(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        src = (body.source or "rig_computer").lower()
        if src not in ("rig_computer", "daq_rule", "wits0", "modbus", "witsml", "simulated"):
            src = "rig_computer"
        now = now_utc()
        docs = []
        for it in body.items:
            sev = (it.severity or "warn").lower()
            if sev not in SEVERITIES:
                sev = "warn"
            note = (it.note or "").strip()
            if not note:
                continue
            docs.append({
                "annot_id": f"annot_{uuid.uuid4().hex[:12]}",
                "team_id": team_id,
                "timestamp_ms": int(it.timestamp_ms),
                "note": note[:500],
                "severity": sev,
                "depth_ft": it.depth_ft,
                "channel": it.channel,
                "value": it.value,
                "author_user_id": f"rig_{src}",
                "author_name": f"Rig Computer · {src}",
                "author_email": None,
                "source": src,
                "rule_id": it.rule_id,
                "created_at": now,
            })
        if not docs:
            return {"inserted": 0, "items": []}
        await db.playback_annotations.insert_many(docs)
        for d in docs:
            d.pop("_id", None)
        return {"inserted": len(docs), "items": [_ser_annot(d) for d in docs]}

    @api_router.get("/liveops/annotations")
    async def list_annotations(
        from_ms: Optional[int] = None,
        to_ms: Optional[int] = None,
        limit: int = 500,
        user: dict = Depends(require_user),
    ):
        """List annotations for the user's team within an optional time window."""
        team_id = user.get("team_id")
        if not team_id:
            return {"annotations": []}
        q: Dict[str, Any] = {"team_id": team_id}
        if from_ms is not None or to_ms is not None:
            rng: Dict[str, Any] = {}
            if from_ms is not None: rng["$gte"] = int(from_ms)
            if to_ms is not None: rng["$lte"] = int(to_ms)
            q["timestamp_ms"] = rng
        docs = await db.playback_annotations.find(q, {"_id": 0}).sort("timestamp_ms", 1).limit(min(limit, 2000)).to_list(min(limit, 2000))
        return {"annotations": [_ser_annot(d) for d in docs]}

    @api_router.patch("/liveops/annotations/{annot_id}")
    async def update_annotation(annot_id: str, body: AnnotationUpdate, user: dict = Depends(require_user)):
        """Author or management can edit a manual annotation. Rig-sourced notes are immutable."""
        existing = await db.playback_annotations.find_one({"annot_id": annot_id, "team_id": user.get("team_id")}, {"_id": 0})
        if not existing:
            raise HTTPException(404, "Not found.")
        if existing.get("source") != "manual":
            raise HTTPException(403, "Rig-sourced annotations cannot be edited.")
        if existing.get("author_user_id") != user["user_id"] and not is_management(user):
            raise HTTPException(403, "Only the author or management can edit this note.")
        update: Dict[str, Any] = {}
        if body.note is not None:
            note = body.note.strip()
            if not note:
                raise HTTPException(400, "note cannot be empty")
            update["note"] = note[:500]
        if body.severity is not None:
            sev = body.severity.lower()
            if sev not in SEVERITIES:
                raise HTTPException(400, f"severity must be one of {SEVERITIES}")
            update["severity"] = sev
        if not update:
            return _ser_annot(existing)
        update["updated_at"] = now_utc()
        await db.playback_annotations.update_one({"annot_id": annot_id}, {"$set": update})
        merged = {**existing, **update}
        return _ser_annot(merged)

    @api_router.delete("/liveops/annotations/{annot_id}")
    async def delete_annotation(annot_id: str, user: dict = Depends(require_user)):
        existing = await db.playback_annotations.find_one({"annot_id": annot_id, "team_id": user.get("team_id")}, {"_id": 0})
        if not existing:
            raise HTTPException(404, "Not found.")
        # Author can delete their own manual note; management can delete any note on their team.
        if existing.get("source") == "manual":
            if existing.get("author_user_id") != user["user_id"] and not is_management(user):
                raise HTTPException(403, "Only the author or management can delete.")
        else:
            if not is_management(user):
                raise HTTPException(403, "Only management can delete rig-sourced annotations.")
        await db.playback_annotations.delete_one({"annot_id": annot_id})
        return {"success": True}

    # ---- Rig-computer threshold rules (Phase 2 pathway) ----
    # These are the user-tunable triggers the rig computer / DAQ listener
    # evaluates in real time against each incoming WITS 0 / Modbus sample.
    # Shipping defaults are safe — users approve / tune them before testing
    # with real company data.
    DEFAULT_RULES = [
        {"rule_id": "p_hard_cap",    "channel": "p_internal_psi",       "op": ">",  "threshold": 9000,  "severity": "critical", "note": "Pressure hard cap breached"},
        {"rule_id": "p_warn",        "channel": "p_internal_psi",       "op": ">",  "threshold": 7500,  "severity": "warn",     "note": "Pressure warning threshold"},
        {"rule_id": "w_overpull",    "channel": "weight_lb",            "op": ">",  "threshold": 27000, "severity": "critical", "note": "Overpull — approaching string yield"},
        {"rule_id": "w_slack",       "channel": "weight_lb",            "op": "<",  "threshold": 1500,  "severity": "warn",     "note": "Low weight — possible slack / stuck"},
        {"rule_id": "traction_hi",   "channel": "traction_pressure_psi","op": ">",  "threshold": 1800,  "severity": "warn",     "note": "Injector traction pressure high"},
    ]

    @api_router.get("/liveops/annotations/rules")
    async def list_annotation_rules(user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            return {"rules": DEFAULT_RULES, "defaults": True}
        docs = await db.rig_annotation_rules.find({"team_id": team_id}, {"_id": 0}).to_list(100)
        if not docs:
            return {"rules": DEFAULT_RULES, "defaults": True}
        return {"rules": [ser(d) for d in docs], "defaults": False}

    class RuleUpsert(BaseModel):
        rule_id: str
        channel: str
        op: str                         # '>' or '<'
        threshold: float
        severity: str = "warn"
        note: str
        enabled: bool = True

    @api_router.put("/liveops/annotations/rules")
    async def upsert_annotation_rules(rules: List[RuleUpsert], user: dict = Depends(require_user)):
        require_supervisor(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        await db.rig_annotation_rules.delete_many({"team_id": team_id})
        payload = []
        for r in rules:
            if r.op not in (">", "<"):
                raise HTTPException(400, "op must be '>' or '<'")
            if r.severity not in SEVERITIES:
                raise HTTPException(400, f"severity must be one of {SEVERITIES}")
            payload.append({
                **r.model_dump(),
                "team_id": team_id,
                "updated_by": user["email"],
                "updated_at": now_utc(),
            })
        if payload:
            await db.rig_annotation_rules.insert_many(payload)
        return {"saved": len(payload)}

    # -----------------------------------------------------------------
    # PHASE 2 — Admin Rig Rename (per-team labels for RIG1..RIG25 + YARD)
    # Any authenticated user can read labels (needed to render the rig
    # selector dropdown). Only management can write.
    # -----------------------------------------------------------------
    class RigLabelsUpdate(BaseModel):
        labels: Dict[str, str]  # { "RIG1": "North Pad Unit", ... }

    @api_router.get("/rigs/labels")
    async def get_rig_labels(user: dict = Depends(require_user)):
        team_id = user.get("team_id")
        if not team_id:
            return {"labels": {}}
        docs = await db.rig_labels.find({"team_id": team_id}, {"_id": 0}).to_list(50)
        return {"labels": {d["rig_id"]: d["label"] for d in docs if d.get("label")}}

    @api_router.put("/rigs/labels")
    async def put_rig_labels(body: RigLabelsUpdate, user: dict = Depends(require_user)):
        require_management(user)
        team_id = user.get("team_id")
        if not team_id:
            raise HTTPException(400, "No team.")
        allowed = set([f"RIG{i}" for i in range(1, 26)]) | {"YARD"}
        now = now_utc()
        saved = 0
        for rig_id, label in body.labels.items():
            if rig_id not in allowed:
                continue
            label_clean = (label or "").strip()[:60]
            if label_clean:
                await db.rig_labels.update_one(
                    {"team_id": team_id, "rig_id": rig_id},
                    {"$set": {"team_id": team_id, "rig_id": rig_id, "label": label_clean,
                              "updated_by": user["email"], "updated_at": now}},
                    upsert=True,
                )
                saved += 1
            else:
                # Empty string = reset to default (delete override)
                await db.rig_labels.delete_one({"team_id": team_id, "rig_id": rig_id})
        return {"saved": saved}

    # PUBLIC — no auth required. Validates share token, creates a guest session, sets cookie.
    @api_router.get("/share/{token}")
    async def redeem_share_link(token: str, response: Response):
        link = await db.share_links.find_one({"token": token}, {"_id": 0})
        if not link:
            raise HTTPException(404, "Invalid or expired link.")
        if link.get("revoked"):
            raise HTTPException(403, "This share link has been revoked.")
        exp = link.get("expires_at")
        if isinstance(exp, datetime) and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        now = now_utc()
        if isinstance(exp, datetime) and exp < now:
            raise HTTPException(403, "This share link has expired.")

        guest_user_id = f"shareguest_{link['link_id']}"
        await db.users.update_one(
            {"user_id": guest_user_id},
            {"$set": {
                "user_id": guest_user_id,
                "email": f"guest+{link['link_id']}@share.local",
                "name": link.get("label") or "Client Guest",
                "role": "guest",
                "team_id": link["team_id"],
                "subscription_status": "active",
                "last_login": now,
            }},
            upsert=True,
        )
        session_token = _secrets.token_urlsafe(48)
        await db.user_sessions.insert_one({
            "session_token": session_token,
            "user_id": guest_user_id,
            "created_at": now,
            "expires_at": min(exp, now + timedelta(days=7)) if isinstance(exp, datetime) else (now + timedelta(days=7)),
            "share_link_id": link["link_id"],
        })
        await db.share_links.update_one(
            {"link_id": link["link_id"]},
            {"$inc": {"use_count": 1}, "$set": {"last_used_at": now}},
        )
        response.set_cookie(
            key="session_token", value=session_token, httponly=True,
            samesite="none", secure=True, path="/",
            max_age=7 * 24 * 3600,
        )
        return {"success": True, "redirect": "/live-ops", "label": link.get("label"), "team_id": link["team_id"]}

    return api_router
