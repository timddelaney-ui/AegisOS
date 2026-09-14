#!/usr/bin/env python3
"""
Backend API Testing for CT Field Workbook
Tests: Auth, Teams, Jobs, Subscription/Stripe
"""
import requests
import subprocess
import json
import time
from typing import Dict, Optional

# Base URL from frontend/.env
BASE_URL = "https://ct-workbook-sim.preview.emergentagent.com/api"

class TestUser:
    def __init__(self, user_id: str, session_token: str, email: str):
        self.user_id = user_id
        self.session_token = session_token
        self.email = email
        self.team_id: Optional[str] = None
        self.invite_code: Optional[str] = None

def create_test_user(name: str) -> TestUser:
    """Create a test user and session in MongoDB"""
    timestamp = int(time.time() * 1000)
    user_id = f"test-user-{timestamp}"
    session_token = f"test_session_{timestamp}"
    email = f"test.user.{timestamp}@example.com"
    
    mongo_script = f"""
use('test_database');
db.users.insertOne({{
  user_id: '{user_id}',
  email: '{email}',
  name: '{name}',
  picture: 'https://via.placeholder.com/150',
  team_id: null,
  subscription_status: 'free',
  subscription_plan: null,
  subscription_expires_at: null,
  created_at: new Date()
}});
db.user_sessions.insertOne({{
  user_id: '{user_id}',
  session_token: '{session_token}',
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
}});
print('SUCCESS');
"""
    
    result = subprocess.run(
        ["mongosh", "--quiet", "--eval", mongo_script],
        capture_output=True,
        text=True
    )
    
    if "SUCCESS" not in result.stdout:
        raise Exception(f"Failed to create user: {result.stderr}")
    
    print(f"✓ Created test user: {name} ({user_id})")
    return TestUser(user_id, session_token, email)

def test_auth(user: TestUser):
    """Test authentication endpoints"""
    print("\n=== Testing AUTH Endpoints ===")
    
    # Test GET /api/auth/me with Bearer token
    print("Testing GET /api/auth/me...")
    headers = {"Authorization": f"Bearer {user.session_token}"}
    resp = requests.get(f"{BASE_URL}/auth/me", headers=headers)
    
    if resp.status_code != 200:
        print(f"❌ GET /api/auth/me failed: {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()
    if data.get("user_id") != user.user_id:
        print(f"❌ GET /api/auth/me returned wrong user_id: {data.get('user_id')}")
        return False
    
    print(f"✓ GET /api/auth/me returned correct user data")
    
    # Test POST /api/auth/logout
    print("Testing POST /api/auth/logout...")
    resp = requests.post(f"{BASE_URL}/auth/logout", headers=headers)
    
    if resp.status_code != 200:
        print(f"❌ POST /api/auth/logout failed: {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()
    if not data.get("success"):
        print(f"❌ POST /api/auth/logout did not return success")
        return False
    
    print(f"✓ POST /api/auth/logout successful")
    
    # Verify session is cleared (should fail now)
    print("Verifying session is cleared...")
    resp = requests.get(f"{BASE_URL}/auth/me", headers=headers)
    
    if resp.status_code == 200:
        print(f"❌ Session still valid after logout")
        return False
    
    print(f"✓ Session correctly cleared after logout")
    
    # Recreate session for further tests
    print("Recreating session for further tests...")
    timestamp = int(time.time() * 1000)
    new_token = f"test_session_{timestamp}"
    
    mongo_script = f"""
use('test_database');
db.user_sessions.insertOne({{
  user_id: '{user.user_id}',
  session_token: '{new_token}',
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
}});
print('SUCCESS');
"""
    
    result = subprocess.run(
        ["mongosh", "--quiet", "--eval", mongo_script],
        capture_output=True,
        text=True
    )
    
    if "SUCCESS" not in result.stdout:
        print(f"❌ Failed to recreate session: {result.stderr}")
        return False
    
    user.session_token = new_token
    print(f"✓ Session recreated")
    
    return True

def test_teams(user1: TestUser, user2: TestUser):
    """Test team management endpoints"""
    print("\n=== Testing TEAM Endpoints ===")
    
    headers1 = {"Authorization": f"Bearer {user1.session_token}"}
    headers2 = {"Authorization": f"Bearer {user2.session_token}"}
    
    # Test POST /api/teams (create team)
    print("Testing POST /api/teams (create team)...")
    resp = requests.post(
        f"{BASE_URL}/teams",
        headers=headers1,
        json={"name": "Test Crew"}
    )
    
    if resp.status_code != 200:
        print(f"❌ POST /api/teams failed: {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()
    if not data.get("invite_code"):
        print(f"❌ POST /api/teams did not return invite_code")
        return False
    
    user1.invite_code = data["invite_code"]
    user1.team_id = data["team_id"]
    print(f"✓ Team created with invite_code: {user1.invite_code}")
    
    # Test GET /api/teams/me (should return team with 1 member)
    print("Testing GET /api/teams/me (user1)...")
    resp = requests.get(f"{BASE_URL}/teams/me", headers=headers1)
    
    if resp.status_code != 200:
        print(f"❌ GET /api/teams/me failed: {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()
    if not data or data.get("team_id") != user1.team_id:
        print(f"❌ GET /api/teams/me returned wrong team_id")
        return False
    
    if len(data.get("members", [])) != 1:
        print(f"❌ GET /api/teams/me should have 1 member, got {len(data.get('members', []))}")
        return False
    
    print(f"✓ GET /api/teams/me returned team with 1 member")
    
    # Test POST /api/teams/join (user2 joins team)
    print("Testing POST /api/teams/join (user2 joins)...")
    resp = requests.post(
        f"{BASE_URL}/teams/join",
        headers=headers2,
        json={"invite_code": user1.invite_code}
    )
    
    if resp.status_code != 200:
        print(f"❌ POST /api/teams/join failed: {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()
    if data.get("team_id") != user1.team_id:
        print(f"❌ POST /api/teams/join returned wrong team_id")
        return False
    
    user2.team_id = user1.team_id
    print(f"✓ User2 joined team successfully")
    
    # Test GET /api/teams/me (user2 should see 2 members)
    print("Testing GET /api/teams/me (user2, should see 2 members)...")
    resp = requests.get(f"{BASE_URL}/teams/me", headers=headers2)
    
    if resp.status_code != 200:
        print(f"❌ GET /api/teams/me failed for user2: {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()
    if len(data.get("members", [])) != 2:
        print(f"❌ GET /api/teams/me should have 2 members, got {len(data.get('members', []))}")
        return False
    
    print(f"✓ GET /api/teams/me returned team with 2 members")
    
    # Test POST /api/teams/leave (user2 leaves)
    print("Testing POST /api/teams/leave (user2 leaves)...")
    resp = requests.post(f"{BASE_URL}/teams/leave", headers=headers2)
    
    if resp.status_code != 200:
        print(f"❌ POST /api/teams/leave failed: {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()
    if not data.get("success"):
        print(f"❌ POST /api/teams/leave did not return success")
        return False
    
    user2.team_id = None
    print(f"✓ User2 left team successfully")
    
    # Rejoin for jobs testing
    print("User2 rejoining team for jobs testing...")
    resp = requests.post(
        f"{BASE_URL}/teams/join",
        headers=headers2,
        json={"invite_code": user1.invite_code}
    )
    
    if resp.status_code != 200:
        print(f"❌ Failed to rejoin team: {resp.status_code} - {resp.text}")
        return False
    
    user2.team_id = user1.team_id
    print(f"✓ User2 rejoined team")
    
    return True

def test_jobs(user1: TestUser, user2: TestUser):
    """Test job CRUD endpoints with visibility"""
    print("\n=== Testing JOB Endpoints ===")
    
    headers1 = {"Authorization": f"Bearer {user1.session_token}"}
    headers2 = {"Authorization": f"Bearer {user2.session_token}"}
    
    # Test POST /api/jobs (private visibility)
    print("Testing POST /api/jobs (private visibility)...")
    resp = requests.post(
        f"{BASE_URL}/jobs",
        headers=headers1,
        json={
            "sheet_key": "Pipe_Stretch",
            "title": "Private Test Job",
            "unit_system": "imp",
            "values": {"0": "3.5", "1": "6500"},
            "visibility": "private"
        }
    )
    
    if resp.status_code != 200:
        print(f"❌ POST /api/jobs (private) failed: {resp.status_code} - {resp.text}")
        return False
    
    private_job = resp.json()
    private_job_id = private_job.get("job_id")
    print(f"✓ Created private job: {private_job_id}")
    
    # Test POST /api/jobs (team visibility)
    print("Testing POST /api/jobs (team visibility)...")
    resp = requests.post(
        f"{BASE_URL}/jobs",
        headers=headers1,
        json={
            "sheet_key": "Pipe_Stretch",
            "title": "Team Test Job",
            "unit_system": "imp",
            "values": {"0": "4.5", "1": "7500"},
            "visibility": "team"
        }
    )
    
    if resp.status_code != 200:
        print(f"❌ POST /api/jobs (team) failed: {resp.status_code} - {resp.text}")
        return False
    
    team_job = resp.json()
    team_job_id = team_job.get("job_id")
    print(f"✓ Created team job: {team_job_id}")
    
    # Test GET /api/jobs (user1 should see both)
    print("Testing GET /api/jobs (user1 should see both)...")
    resp = requests.get(f"{BASE_URL}/jobs", headers=headers1)
    
    if resp.status_code != 200:
        print(f"❌ GET /api/jobs failed for user1: {resp.status_code} - {resp.text}")
        return False
    
    jobs = resp.json()
    if len(jobs) < 2:
        print(f"❌ GET /api/jobs should return at least 2 jobs for user1, got {len(jobs)}")
        return False
    
    job_ids = [j["job_id"] for j in jobs]
    if private_job_id not in job_ids or team_job_id not in job_ids:
        print(f"❌ GET /api/jobs missing expected jobs for user1")
        return False
    
    print(f"✓ User1 sees both private and team jobs ({len(jobs)} total)")
    
    # Test GET /api/jobs (user2 should see only team job, NOT private)
    print("Testing GET /api/jobs (user2 should see team job only)...")
    resp = requests.get(f"{BASE_URL}/jobs", headers=headers2)
    
    if resp.status_code != 200:
        print(f"❌ GET /api/jobs failed for user2: {resp.status_code} - {resp.text}")
        return False
    
    jobs = resp.json()
    job_ids = [j["job_id"] for j in jobs]
    
    if private_job_id in job_ids:
        print(f"❌ User2 should NOT see private job, but it's in the list")
        return False
    
    if team_job_id not in job_ids:
        print(f"❌ User2 should see team job, but it's not in the list")
        return False
    
    print(f"✓ User2 sees team job but NOT private job (correct visibility)")
    
    # Test PATCH /api/jobs/{id} (update title)
    print("Testing PATCH /api/jobs/{id} (update title)...")
    resp = requests.patch(
        f"{BASE_URL}/jobs/{private_job_id}",
        headers=headers1,
        json={"title": "Updated Private Job"}
    )
    
    if resp.status_code != 200:
        print(f"❌ PATCH /api/jobs/{private_job_id} failed: {resp.status_code} - {resp.text}")
        return False
    
    updated_job = resp.json()
    if updated_job.get("title") != "Updated Private Job":
        print(f"❌ PATCH /api/jobs did not update title correctly")
        return False
    
    print(f"✓ Job title updated successfully")
    
    # Test DELETE /api/jobs/{id} (non-owner should fail with 403)
    print("Testing DELETE /api/jobs/{id} (non-owner should get 403)...")
    resp = requests.delete(f"{BASE_URL}/jobs/{private_job_id}", headers=headers2)
    
    if resp.status_code != 403:
        print(f"❌ DELETE /api/jobs should return 403 for non-owner, got {resp.status_code}")
        return False
    
    print(f"✓ Non-owner correctly denied delete (403)")
    
    # Test DELETE /api/jobs/{id} (owner should succeed)
    print("Testing DELETE /api/jobs/{id} (owner should succeed)...")
    resp = requests.delete(f"{BASE_URL}/jobs/{private_job_id}", headers=headers1)
    
    if resp.status_code != 200:
        print(f"❌ DELETE /api/jobs failed for owner: {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()
    if not data.get("success"):
        print(f"❌ DELETE /api/jobs did not return success")
        return False
    
    print(f"✓ Owner successfully deleted job")
    
    return True

def test_subscription_stripe(user: TestUser):
    """Test subscription and Stripe endpoints"""
    print("\n=== Testing SUBSCRIPTION/STRIPE Endpoints ===")
    
    headers = {"Authorization": f"Bearer {user.session_token}"}
    
    # Test GET /api/subscription/status (should return free)
    print("Testing GET /api/subscription/status...")
    resp = requests.get(f"{BASE_URL}/subscription/status", headers=headers)
    
    if resp.status_code != 200:
        print(f"❌ GET /api/subscription/status failed: {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()
    if data.get("status") != "free":
        print(f"❌ GET /api/subscription/status should return 'free', got '{data.get('status')}'")
        return False
    
    print(f"✓ Subscription status is 'free'")
    
    # Test POST /api/payments/checkout (valid lookup_key)
    print("Testing POST /api/payments/checkout (valid lookup_key)...")
    resp = requests.post(
        f"{BASE_URL}/payments/checkout",
        headers=headers,
        json={
            "lookup_key": "ct_pro_monthly",
            "origin_url": "https://example.com"
        }
    )
    
    if resp.status_code != 200:
        print(f"❌ POST /api/payments/checkout failed: {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()
    if not data.get("checkout_url") or not data.get("session_id"):
        print(f"❌ POST /api/payments/checkout missing checkout_url or session_id")
        return False
    
    session_id = data["session_id"]
    print(f"✓ Checkout session created: {session_id}")
    
    # Test POST /api/payments/checkout (invalid lookup_key)
    print("Testing POST /api/payments/checkout (invalid lookup_key)...")
    resp = requests.post(
        f"{BASE_URL}/payments/checkout",
        headers=headers,
        json={
            "lookup_key": "invalid_key_12345",
            "origin_url": "https://example.com"
        }
    )
    
    if resp.status_code != 500:
        print(f"❌ POST /api/payments/checkout should return 500 for invalid key, got {resp.status_code}")
        return False
    
    print(f"✓ Invalid lookup_key correctly returns 500")
    
    # Test GET /api/payments/status/{session_id}
    print("Testing GET /api/payments/status/{session_id}...")
    resp = requests.get(f"{BASE_URL}/payments/status/{session_id}", headers=headers)
    
    if resp.status_code != 200:
        print(f"❌ GET /api/payments/status/{session_id} failed: {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()
    if data.get("payment_status") not in ["pending", "unpaid"]:
        print(f"❌ GET /api/payments/status should return 'pending' or 'unpaid', got '{data.get('payment_status')}'")
        return False
    
    print(f"✓ Payment status is '{data.get('payment_status')}' (expected)")
    
    return True

def main():
    print("=" * 60)
    print("CT Field Workbook Backend API Testing")
    print("=" * 60)
    
    try:
        # Create test users
        print("\n=== Creating Test Users ===")
        user1 = create_test_user("Test User 1")
        user2 = create_test_user("Test User 2")
        
        # Run tests
        results = {
            "AUTH": test_auth(user1),
            "TEAMS": test_teams(user1, user2),
            "JOBS": test_jobs(user1, user2),
            "SUBSCRIPTION/STRIPE": test_subscription_stripe(user1)
        }
        
        # Summary
        print("\n" + "=" * 60)
        print("TEST SUMMARY")
        print("=" * 60)
        
        all_passed = True
        for category, passed in results.items():
            status = "✓ PASSED" if passed else "❌ FAILED"
            print(f"{category}: {status}")
            if not passed:
                all_passed = False
        
        print("=" * 60)
        
        if all_passed:
            print("\n✓ ALL TESTS PASSED")
            return 0
        else:
            print("\n❌ SOME TESTS FAILED")
            return 1
            
    except Exception as e:
        print(f"\n❌ CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    exit(main())
