import base64
import hashlib
import os
import socket
import ssl
import subprocess
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import staging_connectivity_check as chk  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
PROVISION = REPO / "infra" / "mqtt" / "provision_rig_cert.sh"


def _serve(handler, ctx=None):
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(8)
    srv.settimeout(0.2)
    stop = threading.Event()

    def loop():
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
            except socket.timeout:
                continue
            try:
                if ctx:
                    conn = ctx.wrap_socket(conn, server_side=True)
                handler(conn)
            except (ssl.SSLError, OSError):
                pass
            finally:
                conn.close()

    t = threading.Thread(target=loop, daemon=True)
    t.start()
    return srv.getsockname()[1], lambda: (stop.set(), t.join(2), srv.close())


def _ws_handler(mode):
    def handle(conn):
        req = conn.recv(4096).decode()
        key = [ln.split(": ", 1)[1] for ln in req.split("\r\n") if ln.lower().startswith("sec-websocket-key")][0]
        if mode == "101":
            acc = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            conn.sendall(f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                         f"Sec-WebSocket-Accept: {acc}\r\n\r\n".encode())
        elif mode == "bad-accept":
            conn.sendall(b"HTTP/1.1 101 Switching Protocols\r\nSec-WebSocket-Accept: nope\r\n\r\n")
        else:
            conn.sendall(f"HTTP/1.1 {mode} X\r\nContent-Length: 0\r\n\r\n".encode())
    return handle


@pytest.mark.parametrize("mode,ok", [("101", True), ("403", True), ("404", False), ("502", False), ("bad-accept", False)])
def test_websocket_handshake_classification(mode, ok):
    port, stop = _serve(_ws_handler(mode))
    try:
        row, warns = chk.check_websocket(f"http://127.0.0.1:{port}")
    finally:
        stop()
    assert (row["result"] == "pass") is ok
    assert bool(warns) is (not ok)


@pytest.fixture(scope="module")
def pki(tmp_path_factory):
    d = tmp_path_factory.mktemp("pki")
    env = {**os.environ, "PKI_DIR": str(d), "ACL_FILE": str(d / "acl.conf")}
    (d / "acl.conf").write_text("# --- BEGIN RIG ENTRIES ---\n# --- END RIG ENTRIES ---\n")
    for args in (["init-ca"], ["server", "localhost"], ["consumer"]):
        subprocess.run(["bash", str(PROVISION), *args], env=env, check=True, capture_output=True)
    return d


def _server_ctx(pki, require_client):
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(pki / "server.crt", pki / "server.key")
    if require_client:
        ctx.load_verify_locations(pki / "ca.crt")
        ctx.verify_mode = ssl.CERT_REQUIRED
    return ctx


def test_mqtt_mtls_passes_when_client_cert_required(pki):
    def broker(conn):
        conn.recv(16)
        conn.sendall(b"\x20\x02\x00\x00")

    port, stop = _serve(broker, _server_ctx(pki, True))
    try:
        row, warns = chk.check_mqtt_mtls("localhost", port, str(pki / "ca.crt"),
                                         str(pki / "cloud-consumer.crt"), str(pki / "cloud-consumer.key"))
    finally:
        stop()
    assert warns == [] and row["result"] == "pass" and row["tls"] in ("TLSv1.2", "TLSv1.3")


def test_mqtt_mtls_fails_when_broker_accepts_anonymous_clients(pki):
    def broker(conn):
        conn.recv(16)
        conn.sendall(b"\x20\x02\x00\x00")

    port, stop = _serve(broker, _server_ctx(pki, False))
    try:
        row, warns = chk.check_mqtt_mtls("localhost", port, str(pki / "ca.crt"),
                                         str(pki / "cloud-consumer.crt"), str(pki / "cloud-consumer.key"))
    finally:
        stop()
    assert row["result"] == "fail" and "WITHOUT a certificate" in warns[0]


def test_https_tls_verifies_chain_and_rejects_untrusted(pki):
    port, stop = _serve(lambda c: c.recv(1), _server_ctx(pki, False))
    try:
        ok_row, ok_warn = chk.check_https_tls(f"https://localhost:{port}", str(pki / "ca.crt"))
        bad_row, bad_warn = chk.check_https_tls(f"https://localhost:{port}")
    finally:
        stop()
    assert ok_row["result"] == "pass" and not ok_warn
    assert bad_row["result"] == "fail" and bad_warn
    assert chk.check_https_tls("http://localhost")[0]["result"] == "fail"


def test_hitl_gate_reads_environment(monkeypatch):
    monkeypatch.setenv("HITL_ENFORCE_OUTBOUND", "true")
    assert chk.check_hitl_gate()[0]["result"] == "pass"
    monkeypatch.setenv("HITL_ENFORCE_OUTBOUND", "false")
    row, warns = chk.check_hitl_gate()
    assert row["result"] == "fail" and warns
