#!/usr/bin/env python3
"""
Read-only staging connectivity and bootstrap checker.

What this script does:
1) Validates local backend/.env + frontend/.env presence and required keys.
2) Performs non-destructive HTTP probes against a staging base URL.

No writes, no outbound sends, no webhook triggers.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, List, Tuple
from urllib import request as urlrequest
from urllib.error import URLError, HTTPError


ROOT = Path(__file__).resolve().parents[2]
BACKEND_ENV = ROOT / "backend" / ".env"
FRONTEND_ENV = ROOT / "frontend" / ".env"
DEFAULT_STAGING_URL = os.environ.get("STAGING_BASE_URL", "").strip()

REQUIRED_BACKEND_KEYS = [
    "MONGO_URL",
    "DB_NAME",
    "APP_ENV",
    "CORS_ORIGINS",
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_WEBHOOK_ID",
    "EMERGENT_LLM_KEY",
    "RESEND_API_KEY",
    "SMS_PROVIDER",
    "INTEGRATION_PROXY_URL",
    "HITL_ENFORCE_OUTBOUND",
]

REQUIRED_FRONTEND_KEYS = ["REACT_APP_BACKEND_URL"]


def parse_env(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    out: Dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def status(v: str | None) -> str:
    if v is None:
        return "missing"
    if v == "":
        return "empty"
    return "set"


def check_env() -> Tuple[List[str], List[str]]:
    warnings: List[str] = []
    lines: List[str] = []

    b = parse_env(BACKEND_ENV)
    f = parse_env(FRONTEND_ENV)

    lines.append(f"backend/.env: {'present' if BACKEND_ENV.exists() else 'missing'}")
    lines.append(f"frontend/.env: {'present' if FRONTEND_ENV.exists() else 'missing'}")

    for k in REQUIRED_BACKEND_KEYS:
        s = status(b.get(k))
        lines.append(f"backend:{k}:{s}")
        if s != "set":
            warnings.append(f"backend {k} is {s}")
    for k in REQUIRED_FRONTEND_KEYS:
        s = status(f.get(k))
        lines.append(f"frontend:{k}:{s}")
        if s != "set":
            warnings.append(f"frontend {k} is {s}")

    if b.get("APP_ENV", "").lower() != "production":
        warnings.append("APP_ENV is not production")
    if b.get("HITL_ENFORCE_OUTBOUND", "").lower() not in {"1", "true", "yes", "on"}:
        warnings.append("HITL_ENFORCE_OUTBOUND is not enabled")
    if b.get("SMS_PROVIDER", "").lower() == "twilio":
        for tw in ("SMS_FROM_NUMBER", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"):
            if status(b.get(tw)) != "set":
                warnings.append(f"SMS_PROVIDER=twilio but {tw} is {status(b.get(tw))}")
    return lines, warnings


def probe(base_url: str) -> Tuple[List[Dict[str, str]], List[str]]:
    warnings: List[str] = []
    results: List[Dict[str, str]] = []
    if not base_url:
        warnings.append("No STAGING_BASE_URL provided; skipping remote probes.")
        return results, warnings

    base = base_url.rstrip("/")
    checks = [
        ("health", "GET", "/api/health", None, {200}),
        ("auth-route-reachable", "POST", "/api/auth/session", {}, {400, 401}),
        ("ai-route-reachable", "POST", "/api/ai/chat", {"mode": "assistant", "message": "ping"}, {401, 403, 500}),
        ("payments-route-reachable", "GET", "/api/payments/status/healthcheck", None, {404, 401}),
        ("docs-route-reachable", "GET", "/api/documents", None, {401}),
    ]

    for name, method, path, payload, acceptable in checks:
        url = f"{base}{path}"
        try:
            body = None
            headers = {}
            if method != "GET":
                body = json.dumps(payload or {}).encode("utf-8")
                headers["Content-Type"] = "application/json"
            req = urlrequest.Request(url=url, data=body, headers=headers, method=method)
            with urlrequest.urlopen(req, timeout=12) as resp:
                code = resp.getcode()
            ok = code in acceptable
            results.append({
                "check": name,
                "url": path,
                "status_code": str(code),
                "result": "pass" if ok else "fail",
            })
            if not ok:
                warnings.append(f"{name} returned {code}; expected one of {sorted(acceptable)}")
        except HTTPError as e:
            code = e.code
            ok = code in acceptable
            results.append({
                "check": name,
                "url": path,
                "status_code": str(code),
                "result": "pass" if ok else "fail",
            })
            if not ok:
                warnings.append(f"{name} returned {code}; expected one of {sorted(acceptable)}")
        except URLError as e:
            results.append({
                "check": name,
                "url": path,
                "status_code": "n/a",
                "result": "error",
            })
            warnings.append(f"{name} probe failed: {e.reason}")
        except Exception as e:
            results.append({
                "check": name,
                "url": path,
                "status_code": "n/a",
                "result": "error",
            })
            warnings.append(f"{name} probe failed: {e}")
    return results, warnings


TENANT_COLLECTIONS = ("rigs", "jobs", "surveys", "telemetry_events", "telemetry_snapshots",
                      "encoder_consensus", "hitl_approvals", "audit_logs")


def check_mqtt() -> Tuple[Dict[str, str], List[str]]:
    """TCP reachability and, when certs are configured, a real mTLS (>=1.2) handshake."""
    import socket
    import ssl
    from urllib.parse import urlparse

    url = os.environ.get("MQTT_BROKER_URL", "").strip()
    row = {"check": "mqtt_broker", "url": url or "unset", "result": "skipped"}
    if not url:
        return row, ["MQTT_BROKER_URL not set; broker reachability not verified"]
    u = urlparse(url if "://" in url else f"mqtt://{url}")
    tls = u.scheme in ("mqtts", "ssl", "tls")
    port = u.port or (8883 if tls else 1883)
    try:
        sock = socket.create_connection((u.hostname, port), timeout=5)
        if tls:
            ctx = ssl.create_default_context(cafile=os.environ.get("MQTT_TLS_CA") or None)
            ctx.minimum_version = ssl.TLSVersion.TLSv1_2
            if os.environ.get("MQTT_CLIENT_CERT"):
                ctx.load_cert_chain(os.environ["MQTT_CLIENT_CERT"], os.environ.get("MQTT_CLIENT_KEY"))
            sock = ctx.wrap_socket(sock, server_hostname=u.hostname)
            row["tls"] = sock.version() or "unknown"
        sock.close()
        row["result"] = "pass"
        return row, []
    except Exception as e:
        row["result"] = "fail"
        return row, [f"MQTT broker unreachable at {u.hostname}:{port}: {e}"]


def check_tenant_and_audit() -> Tuple[List[Dict[str, str]], List[str]]:
    """Tenant index health (org_id-leading index per tenant collection), HITL gate and audit-chain integrity."""
    rows: List[Dict[str, str]] = []
    warns: List[str] = []
    enforce = os.environ.get("HITL_ENFORCE_OUTBOUND", "").strip().lower() in {"1", "true", "yes", "on"}
    rows.append({"check": "hitl_enforce_outbound", "result": "pass" if enforce else "fail"})
    if not enforce:
        warns.append("HITL_ENFORCE_OUTBOUND is not true; outbound actions would bypass approval")
    mongo_url, db_name = os.environ.get("MONGO_URL"), os.environ.get("DB_NAME")
    if not (mongo_url and db_name):
        warns.append("MONGO_URL/DB_NAME not set; tenant index and audit-chain checks skipped")
        return rows, warns
    try:
        import hashlib
        from pymongo import MongoClient
        db = MongoClient(mongo_url, serverSelectionTimeoutMS=4000)[db_name]
        for coll in TENANT_COLLECTIONS:
            ok = any(list(ix["key"])[:1] == [("org_id", 1)] for ix in db[coll].list_indexes()) \
                if coll in db.list_collection_names() else False
            rows.append({"check": f"tenant_index:{coll}", "result": "pass" if ok else "fail"})
            if not ok:
                warns.append(f"{coll} lacks a compound index leading with org_id (start the API once to create it)")
        orgs = db.audit_logs.distinct("org_id")
        broken = []
        for org in orgs:
            prev = "0" * 64
            for e in db.audit_logs.find({"org_id": org}, {"_id": 0}).sort("seq", 1):
                body = {k: e.get(k) for k in (
                    "id", "org_id", "seq", "ts", "action", "actor_user_id", "actor_email", "approver_user_id",
                    "rig_id", "target", "payload_hash", "decision", "meta")}
                canon = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
                if e["prev_hash"] != prev or hashlib.sha256((canon + prev).encode()).hexdigest() != e["entry_hash"]:
                    broken.append(org)
                    break
                prev = e["entry_hash"]
        rows.append({"check": "audit_chain_integrity", "orgs": str(len(orgs)),
                     "result": "fail" if broken else "pass"})
        if broken:
            warns.append(f"audit hash chain broken for orgs: {broken}")
    except Exception as e:
        rows.append({"check": "tenant_audit_db", "result": "error"})
        warns.append(f"tenant/audit DB check failed: {e}")
    return rows, warns


def main() -> None:
    env_lines, env_warn = check_env()
    probe_rows, probe_warn = probe(DEFAULT_STAGING_URL)
    mqtt_row, mqtt_warn = check_mqtt()
    audit_rows, audit_warn = check_tenant_and_audit()
    warnings = env_warn + probe_warn + mqtt_warn + audit_warn
    out = {
        "env_checks": env_lines,
        "remote_probe_base_url": DEFAULT_STAGING_URL or None,
        "remote_probes": probe_rows,
        "mqtt": mqtt_row,
        "tenant_and_audit": audit_rows,
        "warnings": warnings,
        "overall": "pass" if not warnings else "needs_configuration",
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
