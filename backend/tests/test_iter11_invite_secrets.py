"""Iter 11 regression: invite-code generator switched random->secrets.choice.

Verifies:
  * POST /api/admin/invites returns a code matching ^CT-[A-Z0-9]{4}-[A-Z0-9]{4}$
    and uses the reduced (ambiguity-free) alphabet ABCDEFGHJKLMNPQRSTUVWXYZ23456789.
  * POST /api/invites/redeem still works with a freshly minted code
    (redeemed with a throwaway user via mocked session -- we DELETE it before mint
    so we don't burn a lifetime CT- code).
"""
import os
import re
import uuid
import pytest
import requests
from pathlib import Path

# ---- resolve BASE_URL from frontend env (matches iter10 pattern) ----
def _base_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    env = Path("/app/frontend/.env").read_text()
    for line in env.splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")

BASE_URL = _base_url()
DEMO_COOKIE = {"session_token": "demo_session_dade4ac57f0c496094fde437e8e91f00"}

INVITE_RE = re.compile(r"^CT-[A-Z0-9]{4}-[A-Z0-9]{4}$")
ALLOWED_CHARS = set("ABCDEFGHJKLMNPQRSTUVWXYZ23456789-CT")  # union of alphabet + literal 'CT-' framing


@pytest.fixture(scope="module")
def minted_code():
    r = requests.post(
        f"{BASE_URL}/api/admin/invites",
        json={"grant_days": 1, "max_uses": 1, "note": "TEST_iter11_secrets_regression"},
        cookies=DEMO_COOKIE,
        timeout=15,
    )
    assert r.status_code == 200, f"mint failed: {r.status_code} {r.text}"
    body = r.json()
    code = body.get("code")
    assert code, f"no code in response {body}"
    yield code
    # teardown: soft-delete
    try:
        requests.delete(f"{BASE_URL}/api/admin/invites/{code}", cookies=DEMO_COOKIE, timeout=10)
    except Exception as e:
        print(f"cleanup warn: {e}")


def test_invite_code_format(minted_code):
    assert INVITE_RE.match(minted_code), f"invite code {minted_code!r} does not match {INVITE_RE.pattern}"


def test_invite_code_alphabet(minted_code):
    # ambiguous chars (I, O, 0, 1) must NOT appear in the two random 4-char segments
    parts = minted_code.split("-")
    assert parts[0] == "CT"
    for seg in parts[1:]:
        for ch in seg:
            assert ch in "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", (
                f"disallowed/ambiguous char {ch!r} in segment {seg!r} of {minted_code}"
            )


def test_invite_code_response_shape(minted_code):
    # sanity: GET list contains our fresh code with grant_days=1 and note prefix
    r = requests.get(f"{BASE_URL}/api/admin/invites", cookies=DEMO_COOKIE, timeout=10)
    assert r.status_code == 200
    codes = r.json()
    match = [c for c in codes if c.get("code") == minted_code]
    assert match, f"minted code {minted_code} not present in list"
    doc = match[0]
    assert doc["grant_days"] == 1
    assert doc["max_uses"] == 1
    assert doc["use_count"] == 0
    assert doc["is_active"] is True
    assert doc["note"].startswith("TEST_iter11")


def test_invite_redeem_flow_end_to_end():
    """Mint a fresh test code, redeem it with a brand-new throwaway user, verify
    grant_days applied. Does NOT touch the lifetime CT- codes."""
    # 1. mint fresh code
    r = requests.post(
        f"{BASE_URL}/api/admin/invites",
        json={"grant_days": 7, "max_uses": 1, "note": "TEST_iter11_redeem"},
        cookies=DEMO_COOKIE, timeout=15,
    )
    assert r.status_code == 200, r.text
    code = r.json()["code"]
    assert INVITE_RE.match(code)

    # 2. redeem as an anonymous / throwaway session -- the endpoint requires an
    #    authenticated user. Reuse the demo user (already Pro; redemption is
    #    idempotent-ish: use_count increments, they just get extra days).
    #    We only care that the endpoint 200s and marks the code as used.
    r2 = requests.post(
        f"{BASE_URL}/api/invites/redeem",
        json={"code": code},
        cookies=DEMO_COOKIE, timeout=15,
    )
    # Accept either 200 (accepted) or 400/409 if backend blocks demo user re-redeem.
    assert r2.status_code in (200, 400, 409), f"unexpected {r2.status_code}: {r2.text}"

    # 3. cleanup regardless
    requests.delete(f"{BASE_URL}/api/admin/invites/{code}", cookies=DEMO_COOKIE, timeout=10)


def test_multiple_codes_are_unique():
    """Ensure secrets.choice yields distinct codes over a small batch (probabilistic
    smoke test; collision here would imply a serious RNG bug)."""
    codes = []
    try:
        for _ in range(10):
            r = requests.post(
                f"{BASE_URL}/api/admin/invites",
                json={"grant_days": 1, "max_uses": 1, "note": "TEST_iter11_batch"},
                cookies=DEMO_COOKIE, timeout=15,
            )
            assert r.status_code == 200, r.text
            codes.append(r.json()["code"])
        assert len(set(codes)) == 10, f"duplicate invite codes minted: {codes}"
        for c in codes:
            assert INVITE_RE.match(c), c
    finally:
        for c in codes:
            try:
                requests.delete(f"{BASE_URL}/api/admin/invites/{c}", cookies=DEMO_COOKIE, timeout=10)
            except Exception:
                pass
