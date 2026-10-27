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
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
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


def main() -> None:
    env_lines, env_warn = check_env()
    probe_rows, probe_warn = probe(DEFAULT_STAGING_URL)
    out = {
        "env_checks": env_lines,
        "remote_probe_base_url": DEFAULT_STAGING_URL or None,
        "remote_probes": probe_rows,
        "warnings": env_warn + probe_warn,
        "overall": "pass" if not (env_warn + probe_warn) else "needs_configuration",
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
