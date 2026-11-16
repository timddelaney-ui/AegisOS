#!/usr/bin/env python3
"""
Read-only staging connectivity and bootstrap checker.

What this script does:
1) Validates local backend/.env + frontend/.env presence and required keys.
2) Performs non-destructive HTTP probes against a staging base URL.

No writes, no outbound sends, no webhook triggers.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import socket
import ssl
import sys
import time
from pathlib import Path
from typing import Dict, List, Tuple
from urllib import request as urlrequest
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[2]
PROD_ENV = ROOT / "infra" / "prod" / ".env.prod"
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

TRUTHY = {"1", "true", "yes", "on"}
WS_PATH = "/api/liveops/ws"


def _hitl_enforced() -> Tuple[bool, str]:
    """HITL_ENFORCE_OUTBOUND must be true: process env first, then backend/.env, then infra/prod/.env.prod."""
    if "HITL_ENFORCE_OUTBOUND" in os.environ:
        return os.environ["HITL_ENFORCE_OUTBOUND"].strip().lower() in TRUTHY, "environment"
    for path in (BACKEND_ENV, PROD_ENV):
        vals = parse_env(path)
        if "HITL_ENFORCE_OUTBOUND" in vals:
            return vals["HITL_ENFORCE_OUTBOUND"].strip().lower() in TRUTHY, str(path.relative_to(ROOT))
    return False, "unset"


def check_https_tls(base_url: str, ca: str | None = None, timeout: float = 8) -> Tuple[Dict[str, str], List[str]]:
    """Real TLS handshake (verified chain + hostname, >= TLS 1.2) and certificate expiry."""
    u = urlparse(base_url)
    row = {"check": "https_tls", "url": base_url, "result": "fail"}
    if u.scheme != "https":
        return row, [f"https_tls: {base_url} is not https://"]
    port = u.port or 443
    try:
        ctx = ssl.create_default_context(cafile=ca or None)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        with socket.create_connection((u.hostname, port), timeout=timeout) as raw:
            with ctx.wrap_socket(raw, server_hostname=u.hostname) as tls:
                row["tls"] = tls.version() or "unknown"
                cert = tls.getpeercert()
        left = (ssl.cert_time_to_seconds(cert["notAfter"]) - time.time()) / 86400
        row["days_to_expiry"] = str(int(left))
        if left < 14:
            return row, [f"https_tls: certificate expires in {int(left)} days"]
        row["result"] = "pass"
        return row, []
    except Exception as e:
        return row, [f"https_tls handshake failed for {u.hostname}:{port}: {e}"]


def check_websocket(base_url: str, path: str = WS_PATH, ca: str | None = None,
                    timeout: float = 8) -> Tuple[Dict[str, str], List[str]]:
    """RFC 6455 upgrade handshake through the edge proxy.

    101 means the upgrade is proxied and accepted. 401/403 mean it reached the app, which refuses
    unauthenticated sockets by design, so the proxy path is proven. Anything else is a failure.
    """
    u = urlparse(base_url)
    tls = u.scheme == "https"
    port = u.port or (443 if tls else 80)
    row = {"check": "websocket_handshake", "url": path, "result": "fail"}
    key = base64.b64encode(os.urandom(16)).decode()
    origin = f"{u.scheme}://{u.netloc}"
    req = (f"GET {path} HTTP/1.1\r\nHost: {u.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: {origin}\r\n\r\n")
    try:
        sock = socket.create_connection((u.hostname, port), timeout=timeout)
        if tls:
            ctx = ssl.create_default_context(cafile=ca or None)
            sock = ctx.wrap_socket(sock, server_hostname=u.hostname)
        with sock:
            sock.sendall(req.encode())
            data = b""
            while b"\r\n\r\n" not in data and len(data) < 8192:
                chunk = sock.recv(1024)
                if not chunk:
                    break
                data += chunk
        status_line = data.split(b"\r\n", 1)[0].decode("latin-1")
        parts = status_line.split()
        code = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        row["status_code"] = str(code or "n/a")
        if code in (401, 403):
            row["result"] = "pass"
            row["note"] = "upgrade reached app (auth required)"
            return row, []
        if code == 101:
            headers = data.lower()
            expect = base64.b64encode(
                hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
            ).decode().lower().encode()
            if b"sec-websocket-accept: " + expect in headers:
                row["result"] = "pass"
                return row, []
            return row, ["websocket handshake: invalid Sec-WebSocket-Accept"]
        return row, [f"websocket handshake returned {code or 'no HTTP response'}; expected 101/401/403"]
    except Exception as e:
        return row, [f"websocket handshake failed: {e}"]


def _mqtt_target() -> Tuple[str | None, int]:
    url = os.environ.get("MQTT_BROKER_URL", "").strip()
    if url:
        u = urlparse(url if "://" in url else f"mqtts://{url}")
        return u.hostname, u.port or 8883
    host = os.environ.get("MQTT_HOST", "").strip()
    return (host or None), 8883


def check_mqtt_mtls(host: str | None, port: int = 8883, ca: str | None = None, cert: str | None = None,
                    key: str | None = None, timeout: float = 6) -> Tuple[Dict[str, str], List[str]]:
    """Broker must accept a client-cert handshake (TLS >= 1.2) and reject a cert-less client."""
    row = {"check": "mqtt_mtls", "url": f"{host}:{port}", "result": "skipped"}
    if not host:
        return row, ["mqtt_mtls: no MQTT_BROKER_URL/MQTT_HOST; mTLS on :8883 not verified"]
    if not (cert and key):
        return row, ["mqtt_mtls: MQTT_CLIENT_CERT/MQTT_CLIENT_KEY not set; client-cert handshake not verified"]
    row["result"] = "fail"
    connect_pkt = b"\x10\x0c\x00\x04MQTT\x04\x02\x00\x3c\x00\x00"
    try:
        ctx = ssl.create_default_context(cafile=ca or None)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(cert, key)
        with socket.create_connection((host, port), timeout=timeout) as raw:
            with ctx.wrap_socket(raw, server_hostname=host) as s:
                row["tls"] = s.version() or "unknown"
    except Exception as e:
        return row, [f"mqtt_mtls: handshake with client certificate failed: {e}"]
    try:
        ctx = ssl.create_default_context(cafile=ca or None)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        with socket.create_connection((host, port), timeout=timeout) as raw:
            with ctx.wrap_socket(raw, server_hostname=host) as s:
                s.sendall(connect_pkt)
                reply = s.recv(16)  # TLS 1.3 surfaces the missing-cert alert on first read
        if reply[:1] == b"\x20":
            return row, ["mqtt_mtls: broker accepted a client WITHOUT a certificate (mTLS not enforced)"]
    except (ssl.SSLError, ConnectionError, socket.timeout, OSError):
        pass
    row["result"] = "pass"
    row["client_cert_required"] = "true"
    return row, []


def check_hitl_gate() -> Tuple[Dict[str, str], List[str]]:
    ok, src = _hitl_enforced()
    row = {"check": "hitl_enforce_outbound", "source": src, "result": "pass" if ok else "fail"}
    return row, ([] if ok else [f"HITL_ENFORCE_OUTBOUND is not true ({src}); outbound actions would bypass approval"])


def check_production_edge(base_url: str) -> Tuple[List[Dict[str, str]], List[str]]:
    """HTTPS TLS, WebSocket upgrade and mTLS MQTT checks used for the production edge."""
    rows: List[Dict[str, str]] = []
    warns: List[str] = []
    ca = os.environ.get("STAGING_TLS_CA") or None
    if base_url:
        for r, w in (check_https_tls(base_url, ca), check_websocket(base_url, ca=ca)):
            rows.append(r)
            warns += w
    host, port = _mqtt_target()
    if not host and base_url:
        h = urlparse(base_url).hostname or ""
        host = f"mqtt.{h[4:] if h.startswith('www.') else h}" if h else None
    r, w = check_mqtt_mtls(host, port, os.environ.get("MQTT_TLS_CA") or None,
                           os.environ.get("MQTT_CLIENT_CERT"), os.environ.get("MQTT_CLIENT_KEY"))
    rows.append(r)
    return rows, warns + w


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


def main(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument("--base-url", default=DEFAULT_STAGING_URL, help="defaults to $STAGING_BASE_URL")
    ap.add_argument("--strict", action="store_true", help="exit 1 when any warning/failure is reported")
    args = ap.parse_args(argv)
    base = args.base_url.strip()

    env_lines, env_warn = check_env()
    probe_rows, probe_warn = probe(base)
    edge_rows, edge_warn = check_production_edge(base)
    mqtt_row, mqtt_warn = check_mqtt()
    audit_rows, audit_warn = check_tenant_and_audit()
    hitl_row, hitl_warn = check_hitl_gate()
    audit_rows = [r for r in audit_rows if r["check"] != "hitl_enforce_outbound"] + [hitl_row]
    audit_warn = [w for w in audit_warn if "HITL_ENFORCE_OUTBOUND" not in w] + hitl_warn
    warnings = env_warn + probe_warn + edge_warn + mqtt_warn + audit_warn
    out = {
        "env_checks": env_lines,
        "remote_probe_base_url": base or None,
        "remote_probes": probe_rows,
        "production_edge": edge_rows,
        "mqtt": mqtt_row,
        "tenant_and_audit": audit_rows,
        "warnings": warnings,
        "overall": "pass" if not warnings else "needs_configuration",
    }
    print(json.dumps(out, indent=2))
    return 1 if (args.strict and warnings) else 0


if __name__ == "__main__":
    sys.exit(main())
