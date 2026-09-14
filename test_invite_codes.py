#!/usr/bin/env python3
"""
Test suite for CT Field Workbook invite code system
Tests admin gating, redemption, max uses, revocation, and extension logic
"""
import requests
import json
from datetime import datetime, timedelta

# Base URL from frontend/.env
BASE_URL = "https://ct-workbook-sim.preview.emergentagent.com/api"

# Test sessions from MongoDB test_database
ADMIN_SESSION = "demo_pro_session_token_12345"  # demo.pro@example.com (in ADMIN_EMAILS)
NON_ADMIN_SESSION = "demo_free_session_token_67890"  # demo.free@example.com

# Store codes for later tests
CODE_A = None
CODE_B = None
CODE_C = None

def make_request(method, endpoint, session_token=None, json_body=None, expect_status=200):
    """Helper to make API requests with session token"""
    url = f"{BASE_URL}{endpoint}"
    headers = {}
    if session_token:
        headers["Cookie"] = f"session_token={session_token}"
    
    try:
        if method == "GET":
            resp = requests.get(url, headers=headers, timeout=10)
        elif method == "POST":
            resp = requests.post(url, headers=headers, json=json_body, timeout=10)
        elif method == "DELETE":
            resp = requests.delete(url, headers=headers, timeout=10)
        elif method == "PATCH":
            resp = requests.patch(url, headers=headers, json=json_body, timeout=10)
        else:
            raise ValueError(f"Unsupported method: {method}")
        
        print(f"\n{method} {endpoint}")
        print(f"Status: {resp.status_code}")
        if resp.status_code != expect_status:
            print(f"❌ EXPECTED {expect_status}, GOT {resp.status_code}")
            print(f"Response: {resp.text}")
            return None
        
        if resp.status_code in [200, 201]:
            try:
                data = resp.json()
                print(f"✅ Response: {json.dumps(data, indent=2)}")
                return data
            except:
                print(f"✅ Response: {resp.text}")
                return resp.text
        else:
            print(f"Response: {resp.text}")
            return resp.text
            
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return None


print("=" * 80)
print("TEST 1 — ADMIN GATING ON CREATION")
print("=" * 80)

# Test 1a: Admin creates invite code
print("\n1a. POST /api/admin/invites as ADMIN with valid body")
data = make_request(
    "POST", 
    "/admin/invites",
    session_token=ADMIN_SESSION,
    json_body={"grant_days": 30, "note": "pilot user", "max_uses": 1},
    expect_status=200
)
if data:
    CODE_A = data.get("code")
    print(f"\n✅ CODE_A saved: {CODE_A}")
    # Verify response structure
    assert data.get("created_by_email") == "demo.pro@example.com", "created_by_email mismatch"
    assert data.get("grant_days") == 30, "grant_days mismatch"
    assert data.get("max_uses") == 1, "max_uses mismatch"
    assert data.get("use_count") == 0, "use_count should be 0"
    assert data.get("is_active") == True, "is_active should be True"
    # Verify code pattern: CT-XXXX-XXXX
    import re
    assert re.match(r"^CT-[A-Z0-9]{4}-[A-Z0-9]{4}$", CODE_A), f"Code pattern mismatch: {CODE_A}"
    print("✅ All response fields verified")

# Test 1b: Non-admin tries to create invite code
print("\n1b. POST /api/admin/invites as NON-ADMIN (expect 403)")
make_request(
    "POST",
    "/admin/invites",
    session_token=NON_ADMIN_SESSION,
    json_body={"grant_days": 30, "note": "pilot user", "max_uses": 1},
    expect_status=403
)

# Test 1c: Admin with grant_days=0 (invalid)
print("\n1c. POST /api/admin/invites as ADMIN with grant_days=0 (expect 400)")
make_request(
    "POST",
    "/admin/invites",
    session_token=ADMIN_SESSION,
    json_body={"grant_days": 0},
    expect_status=400
)

# Test 1d: Admin with max_uses=0 (invalid)
print("\n1d. POST /api/admin/invites as ADMIN with max_uses=0 (expect 400)")
make_request(
    "POST",
    "/admin/invites",
    session_token=ADMIN_SESSION,
    json_body={"grant_days": 30, "max_uses": 0},
    expect_status=400
)


print("\n" + "=" * 80)
print("TEST 2 — ADMIN LIST")
print("=" * 80)

# Test 2a: Admin lists all invite codes
print("\n2a. GET /api/admin/invites as ADMIN")
data = make_request(
    "GET",
    "/admin/invites",
    session_token=ADMIN_SESSION,
    expect_status=200
)
if data:
    assert isinstance(data, list), "Response should be an array"
    # Verify CODE_A is in the list
    codes = [item.get("code") for item in data]
    assert CODE_A in codes, f"CODE_A {CODE_A} not found in list"
    print(f"✅ CODE_A found in list")

# Test 2b: Non-admin tries to list invite codes
print("\n2b. GET /api/admin/invites as NON-ADMIN (expect 403)")
make_request(
    "GET",
    "/admin/invites",
    session_token=NON_ADMIN_SESSION,
    expect_status=403
)


print("\n" + "=" * 80)
print("TEST 3 — REDEMPTION SUCCESS")
print("=" * 80)

# Test 3a: Non-admin redeems CODE_A
print(f"\n3a. POST /api/invites/redeem as NON-ADMIN with CODE_A: {CODE_A}")
data = make_request(
    "POST",
    "/invites/redeem",
    session_token=NON_ADMIN_SESSION,
    json_body={"code": CODE_A},
    expect_status=200
)
if data:
    assert data.get("success") == True, "success should be True"
    assert data.get("grant_days") == 30, "grant_days should be 30"
    assert "expires_at" in data, "expires_at missing"
    assert "message" in data, "message missing"
    # Verify expires_at is ~30 days in future
    expires_at = datetime.fromisoformat(data["expires_at"].replace("Z", "+00:00"))
    now = datetime.now(expires_at.tzinfo)
    days_diff = (expires_at - now).days
    assert 29 <= days_diff <= 31, f"expires_at should be ~30 days in future, got {days_diff} days"
    print(f"✅ expires_at is {days_diff} days in future")

# Test 3b: Verify user subscription status updated
print("\n3b. GET /api/auth/me as NON-ADMIN (verify subscription updated)")
data = make_request(
    "GET",
    "/auth/me",
    session_token=NON_ADMIN_SESSION,
    expect_status=200
)
if data:
    assert data.get("subscription_status") == "active", "subscription_status should be 'active'"
    assert data.get("subscription_plan") == "invite", "subscription_plan should be 'invite'"
    assert data.get("subscription_expires_at") is not None, "subscription_expires_at should be set"
    print("✅ User subscription status updated correctly")


print("\n" + "=" * 80)
print("TEST 4 — CANNOT REDEEM SAME CODE TWICE AS SAME USER")
print("=" * 80)

print(f"\n4. POST /api/invites/redeem with CODE_A again as NON-ADMIN (expect 400)")
resp = make_request(
    "POST",
    "/invites/redeem",
    session_token=NON_ADMIN_SESSION,
    json_body={"code": CODE_A},
    expect_status=400
)
if resp:
    # Verify error message mentions "already"
    assert "already" in str(resp).lower(), "Error message should mention 'already'"
    print("✅ Error message mentions 'already'")


print("\n" + "=" * 80)
print("TEST 5 — MAX USES ENFORCED")
print("=" * 80)

print(f"\n5. POST /api/invites/redeem with CODE_A as ADMIN (expect 400 - max_uses=1 already hit)")
resp = make_request(
    "POST",
    "/invites/redeem",
    session_token=ADMIN_SESSION,
    json_body={"code": CODE_A},
    expect_status=400
)
if resp:
    # Verify error message mentions "already been redeemed"
    assert "already been redeemed" in str(resp).lower() or "already" in str(resp).lower(), \
        "Error message should mention max uses hit"
    print("✅ Error message indicates max uses hit")


print("\n" + "=" * 80)
print("TEST 6 — INVALID CODE")
print("=" * 80)

print("\n6. POST /api/invites/redeem with invalid code CT-ZZZZ-9999 (expect 404)")
make_request(
    "POST",
    "/invites/redeem",
    session_token=NON_ADMIN_SESSION,
    json_body={"code": "CT-ZZZZ-9999"},
    expect_status=404
)


print("\n" + "=" * 80)
print("TEST 7 — REVOCATION")
print("=" * 80)

# Test 7a: Admin creates CODE_B
print("\n7a. POST /api/admin/invites as ADMIN (create CODE_B)")
data = make_request(
    "POST",
    "/admin/invites",
    session_token=ADMIN_SESSION,
    json_body={"grant_days": 15, "max_uses": 5, "note": "multi-use"},
    expect_status=200
)
if data:
    CODE_B = data.get("code")
    print(f"\n✅ CODE_B saved: {CODE_B}")

# Test 7b: Admin revokes CODE_B
print(f"\n7b. DELETE /api/admin/invites/{CODE_B} as ADMIN")
make_request(
    "DELETE",
    f"/admin/invites/{CODE_B}",
    session_token=ADMIN_SESSION,
    expect_status=200
)

# Test 7c: Non-admin tries to revoke (expect 403)
print(f"\n7c. DELETE /api/admin/invites/{CODE_B} as NON-ADMIN (expect 403)")
make_request(
    "DELETE",
    f"/admin/invites/{CODE_B}",
    session_token=NON_ADMIN_SESSION,
    expect_status=403
)

# Test 7d: Admin tries to revoke non-existent code
print("\n7d. DELETE /api/admin/invites/NOT_A_REAL_CODE as ADMIN (expect 404)")
make_request(
    "DELETE",
    "/admin/invites/NOT_A_REAL_CODE",
    session_token=ADMIN_SESSION,
    expect_status=404
)

# Test 7e: Try to redeem revoked CODE_B
print(f"\n7e. POST /api/invites/redeem with revoked CODE_B as ADMIN (expect 400)")
resp = make_request(
    "POST",
    "/invites/redeem",
    session_token=ADMIN_SESSION,
    json_body={"code": CODE_B},
    expect_status=400
)
if resp:
    # Verify error message mentions "revoked"
    assert "revoked" in str(resp).lower(), "Error message should mention 'revoked'"
    print("✅ Error message mentions 'revoked'")


print("\n" + "=" * 80)
print("TEST 8 — EXTENSION (NOT RESET) ON REPEAT REDEMPTION")
print("=" * 80)

# Test 8a: Create CODE_C
print("\n8a. POST /api/admin/invites as ADMIN (create CODE_C)")
data = make_request(
    "POST",
    "/admin/invites",
    session_token=ADMIN_SESSION,
    json_body={"grant_days": 10, "max_uses": 1, "note": "extension test"},
    expect_status=200
)
if data:
    CODE_C = data.get("code")
    print(f"\n✅ CODE_C saved: {CODE_C}")

# Test 8b: Get demo_free user's current subscription_expires_at (T1)
print("\n8b. GET /api/auth/me as NON-ADMIN (get current T1)")
data = make_request(
    "GET",
    "/auth/me",
    session_token=NON_ADMIN_SESSION,
    expect_status=200
)
T1 = None
if data:
    T1_str = data.get("subscription_expires_at")
    if T1_str:
        T1 = datetime.fromisoformat(T1_str.replace("Z", "+00:00"))
        print(f"✅ T1 (current expires_at): {T1}")

# Test 8c: Redeem CODE_C as demo_free user
print(f"\n8c. POST /api/invites/redeem with CODE_C as NON-ADMIN")
data = make_request(
    "POST",
    "/invites/redeem",
    session_token=NON_ADMIN_SESSION,
    json_body={"code": CODE_C},
    expect_status=200
)

# Test 8d: Get updated subscription_expires_at (T2)
print("\n8d. GET /api/auth/me as NON-ADMIN (get updated T2)")
data = make_request(
    "GET",
    "/auth/me",
    session_token=NON_ADMIN_SESSION,
    expect_status=200
)
T2 = None
if data:
    T2_str = data.get("subscription_expires_at")
    if T2_str:
        T2 = datetime.fromisoformat(T2_str.replace("Z", "+00:00"))
        print(f"✅ T2 (updated expires_at): {T2}")

# Test 8e: Verify T2 ≈ T1 + 10 days (extension, not reset)
if T1 and T2:
    expected_T2 = T1 + timedelta(days=10)
    diff_seconds = abs((T2 - expected_T2).total_seconds())
    # Allow 60 seconds tolerance for processing time
    assert diff_seconds < 60, f"T2 should be T1 + 10 days, but diff is {diff_seconds} seconds"
    print(f"✅ T2 is T1 + 10 days (extension verified, diff: {diff_seconds}s)")
    print(f"   T1: {T1}")
    print(f"   T2: {T2}")
    print(f"   Expected T2: {expected_T2}")


print("\n" + "=" * 80)
print("ALL TESTS COMPLETE")
print("=" * 80)
