#!/usr/bin/env python3
"""
Backend API Testing for CT Field Workbook - New Features
Tests: Feedback system, Admin whoami, AI Training mode, Updated Stripe pricing
"""
import requests
import subprocess
import json
from typing import Dict, Optional

# Base URL from frontend/.env
BASE_URL = "https://ct-workbook-sim.preview.emergentagent.com/api"

# Test sessions from MongoDB test_database
ADMIN_TOKEN = "demo_pro_session_token_12345"  # email: demo.pro@example.com (in ADMIN_EMAILS)
NON_ADMIN_TOKEN = "demo_free_session_token_67890"  # free trial user

def print_test_header(test_name: str):
    """Print formatted test header"""
    print(f"\n{'='*70}")
    print(f"TEST: {test_name}")
    print(f"{'='*70}")

def print_result(passed: bool, message: str):
    """Print test result"""
    status = "✓ PASS" if passed else "❌ FAIL"
    print(f"{status}: {message}")

def test_admin_whoami():
    """Test 1 - /api/admin/whoami"""
    print_test_header("Test 1 - /api/admin/whoami")
    
    results = []
    
    # Test 1a: Admin user
    print("\n[1a] GET /api/admin/whoami with admin cookie")
    headers = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
    resp = requests.get(f"{BASE_URL}/admin/whoami", headers=headers)
    
    if resp.status_code != 200:
        print_result(False, f"Expected 200, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        results.append(False)
    else:
        data = resp.json()
        if data.get("is_admin") == True and data.get("email") == "demo.pro@example.com":
            print_result(True, f"Admin user correctly identified: {data}")
            results.append(True)
        else:
            print_result(False, f"Expected is_admin=true and email=demo.pro@example.com, got {data}")
            results.append(False)
    
    # Test 1b: Non-admin user
    print("\n[1b] GET /api/admin/whoami with non-admin cookie")
    headers = {"Authorization": f"Bearer {NON_ADMIN_TOKEN}"}
    resp = requests.get(f"{BASE_URL}/admin/whoami", headers=headers)
    
    if resp.status_code != 200:
        print_result(False, f"Expected 200, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        results.append(False)
    else:
        data = resp.json()
        if data.get("is_admin") == False:
            print_result(True, f"Non-admin user correctly identified: {data}")
            results.append(True)
        else:
            print_result(False, f"Expected is_admin=false, got {data}")
            results.append(False)
    
    return all(results)

def test_feedback_create():
    """Test 2 - Feedback create"""
    print_test_header("Test 2 - Feedback create")
    
    results = []
    feedback_ids = []
    
    # Test 2a: Admin submits valid feedback
    print("\n[2a] POST /api/feedback as admin with valid body")
    headers = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
    body = {
        "category": "bug",
        "subject": "Cement plug rounding",
        "message": "Height shows 1271 ft; expected 1272",
        "page": "/app"
    }
    resp = requests.post(f"{BASE_URL}/feedback", headers=headers, json=body)
    
    if resp.status_code != 200:
        print_result(False, f"Expected 200, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        results.append(False)
    else:
        data = resp.json()
        if data.get("feedback_id") and data.get("status") == "new" and data.get("created_at"):
            print_result(True, f"Feedback created: {data.get('feedback_id')}")
            print(f"     Status: {data.get('status')}, Created: {data.get('created_at')}")
            feedback_ids.append(data.get("feedback_id"))
            results.append(True)
        else:
            print_result(False, f"Missing required fields: {data}")
            results.append(False)
    
    # Test 2b: Invalid category
    print("\n[2b] POST /api/feedback with invalid category")
    body = {
        "category": "totally_wrong",
        "subject": "x",
        "message": "x"
    }
    resp = requests.post(f"{BASE_URL}/feedback", headers=headers, json=body)
    
    if resp.status_code == 400:
        print_result(True, f"Invalid category correctly rejected with 400")
        print(f"     Error: {resp.json().get('detail')}")
        results.append(True)
    else:
        print_result(False, f"Expected 400, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        results.append(False)
    
    # Test 2c: Non-admin submits valid feedback
    print("\n[2c] POST /api/feedback as non-admin with valid body")
    headers = {"Authorization": f"Bearer {NON_ADMIN_TOKEN}"}
    body = {
        "category": "idea",
        "subject": "Feature request",
        "message": "Would be great to have dark mode",
        "page": "/settings"
    }
    resp = requests.post(f"{BASE_URL}/feedback", headers=headers, json=body)
    
    if resp.status_code != 200:
        print_result(False, f"Expected 200, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        results.append(False)
    else:
        data = resp.json()
        if data.get("feedback_id"):
            print_result(True, f"Non-admin can submit feedback: {data.get('feedback_id')}")
            feedback_ids.append(data.get("feedback_id"))
            results.append(True)
        else:
            print_result(False, f"Missing feedback_id: {data}")
            results.append(False)
    
    return all(results), feedback_ids

def test_feedback_list(feedback_ids):
    """Test 3 - Feedback list (admin gating)"""
    print_test_header("Test 3 - Feedback list (admin gating)")
    
    results = []
    
    # Test 3a: Admin can list all feedback
    print("\n[3a] GET /api/feedback with admin cookie")
    headers = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
    resp = requests.get(f"{BASE_URL}/feedback", headers=headers)
    
    if resp.status_code != 200:
        print_result(False, f"Expected 200, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        results.append(False)
    else:
        data = resp.json()
        if isinstance(data, list) and len(data) >= 2:
            print_result(True, f"Admin can list all feedback: {len(data)} items")
            # Check if our test feedback is in the list
            found_ids = [item.get("feedback_id") for item in data]
            if all(fid in found_ids for fid in feedback_ids):
                print(f"     All test feedback items found in list")
            results.append(True)
        else:
            print_result(False, f"Expected array with at least 2 items, got {len(data) if isinstance(data, list) else 'not a list'}")
            results.append(False)
    
    # Test 3b: Non-admin gets 403
    print("\n[3b] GET /api/feedback with non-admin cookie")
    headers = {"Authorization": f"Bearer {NON_ADMIN_TOKEN}"}
    resp = requests.get(f"{BASE_URL}/feedback", headers=headers)
    
    if resp.status_code == 403:
        detail = resp.json().get("detail", "")
        if "admin" in detail.lower():
            print_result(True, f"Non-admin correctly denied with 403")
            print(f"     Detail: {detail}")
            results.append(True)
        else:
            print_result(False, f"Got 403 but detail doesn't mention admin: {detail}")
            results.append(False)
    else:
        print_result(False, f"Expected 403, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        results.append(False)
    
    # Test 3c: Non-admin can list own feedback
    print("\n[3c] GET /api/feedback/mine as non-admin")
    resp = requests.get(f"{BASE_URL}/feedback/mine", headers=headers)
    
    if resp.status_code != 200:
        print_result(False, f"Expected 200, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        results.append(False)
    else:
        data = resp.json()
        if isinstance(data, list):
            print_result(True, f"Non-admin can list own feedback: {len(data)} items")
            # Verify all items belong to this user
            if len(data) > 0:
                print(f"     Sample feedback: {data[0].get('subject')}")
            results.append(True)
        else:
            print_result(False, f"Expected array, got {type(data)}")
            results.append(False)
    
    return all(results)

def test_feedback_update(feedback_ids):
    """Test 4 - Feedback update (admin only)"""
    print_test_header("Test 4 - Feedback update (admin only)")
    
    if not feedback_ids:
        print_result(False, "No feedback IDs available for testing")
        return False
    
    results = []
    feedback_id = feedback_ids[0]
    
    # Test 4a: Admin can update feedback
    print(f"\n[4a] PATCH /api/feedback/{feedback_id} as admin")
    headers = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
    body = {
        "status": "in_review",
        "admin_notes": "reviewing"
    }
    resp = requests.patch(f"{BASE_URL}/feedback/{feedback_id}", headers=headers, json=body)
    
    if resp.status_code != 200:
        print_result(False, f"Expected 200, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        results.append(False)
    else:
        data = resp.json()
        if data.get("status") == "in_review" and data.get("admin_notes") == "reviewing":
            print_result(True, f"Admin updated feedback successfully")
            print(f"     Status: {data.get('status')}, Notes: {data.get('admin_notes')}")
            results.append(True)
        else:
            print_result(False, f"Fields not updated correctly: {data}")
            results.append(False)
    
    # Test 4b: Non-admin gets 403
    print(f"\n[4b] PATCH /api/feedback/{feedback_id} as non-admin")
    headers = {"Authorization": f"Bearer {NON_ADMIN_TOKEN}"}
    body = {
        "status": "done"
    }
    resp = requests.patch(f"{BASE_URL}/feedback/{feedback_id}", headers=headers, json=body)
    
    if resp.status_code == 403:
        print_result(True, f"Non-admin correctly denied with 403")
        print(f"     Detail: {resp.json().get('detail')}")
        results.append(True)
    else:
        print_result(False, f"Expected 403, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        results.append(False)
    
    # Test 4c: Invalid feedback ID
    print(f"\n[4c] PATCH /api/feedback/invalid_id as admin")
    headers = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
    body = {
        "status": "done"
    }
    resp = requests.patch(f"{BASE_URL}/feedback/invalid_id_12345", headers=headers, json=body)
    
    if resp.status_code == 404:
        print_result(True, f"Invalid ID correctly returns 404")
        print(f"     Detail: {resp.json().get('detail')}")
        results.append(True)
    else:
        print_result(False, f"Expected 404, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        results.append(False)
    
    return all(results)

def test_ai_training_mode():
    """Test 5 - AI Training mode"""
    print_test_header("Test 5 - AI Training mode")
    
    print("\n[5] POST /api/ai/chat with mode='training'")
    headers = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
    body = {
        "mode": "training",
        "message": "What does WOB mean and why does it matter for milling?"
    }
    resp = requests.post(f"{BASE_URL}/ai/chat", headers=headers, json=body)
    
    if resp.status_code != 200:
        print_result(False, f"Expected 200, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        return False
    
    data = resp.json()
    response_text = data.get("response", "")
    
    if not response_text:
        print_result(False, "No response text returned")
        return False
    
    # Check for beginner-friendly explanation
    keywords = ["weight", "bit", "downhole", "force", "pressure", "milling"]
    found_keywords = [kw for kw in keywords if kw.lower() in response_text.lower()]
    
    if len(found_keywords) >= 2:
        print_result(True, f"Training mode response is beginner-friendly")
        print(f"     Response length: {len(response_text)} chars")
        print(f"     Found keywords: {found_keywords}")
        print(f"     Response snippet: {response_text[:200]}...")
        return True
    else:
        print_result(False, f"Response doesn't seem to explain WOB properly")
        print(f"     Response: {response_text[:300]}...")
        return False

def test_ai_oilfield_voice():
    """Test 6 - AI oilfield voice (spot-check)"""
    print_test_header("Test 6 - AI oilfield voice (spot-check)")
    
    print("\n[6] POST /api/ai/chat with mode='assistant'")
    headers = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
    body = {
        "mode": "assistant",
        "message": "3.5 BPM through 1.25 CT at 5200 ft, 9.5 ppg — safe?"
    }
    resp = requests.post(f"{BASE_URL}/ai/chat", headers=headers, json=body)
    
    if resp.status_code != 200:
        print_result(False, f"Expected 200, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        return False
    
    data = resp.json()
    response_text = data.get("response", "")
    
    if not response_text:
        print_result(False, "No response text returned")
        return False
    
    # Check for "Advisory only" phrase
    has_advisory = "advisory only" in response_text.lower()
    
    # Check for API/AER standard citation
    has_standard = any(std in response_text.upper() for std in ["API", "AER", "RP", "DIRECTIVE"])
    
    if has_advisory and has_standard:
        print_result(True, f"Oilfield voice response has advisory disclaimer and cites standards")
        print(f"     Response length: {len(response_text)} chars")
        print(f"     Has 'Advisory only': {has_advisory}")
        print(f"     Cites API/AER: {has_standard}")
        print(f"     Response snippet: {response_text[:250]}...")
        return True
    else:
        print_result(False, f"Response missing advisory disclaimer or standard citation")
        print(f"     Has 'Advisory only': {has_advisory}")
        print(f"     Cites API/AER: {has_standard}")
        print(f"     Response: {response_text[:300]}...")
        return False

def test_stripe_pricing():
    """Test 7 - Stripe pricing update"""
    print_test_header("Test 7 - Stripe pricing update")
    
    results = []
    
    # Test 7a: Monthly pricing ($2.99 = 299 cents)
    print("\n[7a] POST /api/payments/checkout with ct_pro_monthly")
    headers = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
    body = {
        "lookup_key": "ct_pro_monthly",
        "origin_url": "https://example.com"
    }
    resp = requests.post(f"{BASE_URL}/payments/checkout", headers=headers, json=body)
    
    if resp.status_code != 200:
        print_result(False, f"Expected 200, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        results.append(False)
    else:
        data = resp.json()
        session_id = data.get("session_id")
        checkout_url = data.get("checkout_url")
        
        if not session_id or not checkout_url:
            print_result(False, f"Missing session_id or checkout_url")
            results.append(False)
        else:
            print_result(True, f"Checkout session created: {session_id}")
            print(f"     Checkout URL: {checkout_url[:80]}...")
            
            # Verify amount in database
            print(f"     Verifying amount in payment_transactions...")
            mongo_script = f"""
use('test_database');
const tx = db.payment_transactions.findOne({{session_id: '{session_id}'}});
if (tx) {{
  print('AMOUNT:' + tx.amount);
}} else {{
  print('NOT_FOUND');
}}
"""
            result = subprocess.run(
                ["mongosh", "--quiet", "--eval", mongo_script],
                capture_output=True,
                text=True
            )
            
            if "AMOUNT:299" in result.stdout:
                print_result(True, f"Monthly price is 299 cents ($2.99)")
                results.append(True)
            else:
                print_result(False, f"Monthly price is not 299 cents")
                print(f"     MongoDB output: {result.stdout}")
                results.append(False)
    
    # Test 7b: Yearly pricing ($24.99 = 2499 cents)
    print("\n[7b] POST /api/payments/checkout with ct_pro_yearly")
    body = {
        "lookup_key": "ct_pro_yearly",
        "origin_url": "https://example.com"
    }
    resp = requests.post(f"{BASE_URL}/payments/checkout", headers=headers, json=body)
    
    if resp.status_code != 200:
        print_result(False, f"Expected 200, got {resp.status_code}")
        print(f"     Response: {resp.text}")
        results.append(False)
    else:
        data = resp.json()
        session_id = data.get("session_id")
        checkout_url = data.get("checkout_url")
        
        if not session_id or not checkout_url:
            print_result(False, f"Missing session_id or checkout_url")
            results.append(False)
        else:
            print_result(True, f"Checkout session created: {session_id}")
            print(f"     Checkout URL: {checkout_url[:80]}...")
            
            # Verify amount in database
            print(f"     Verifying amount in payment_transactions...")
            mongo_script = f"""
use('test_database');
const tx = db.payment_transactions.findOne({{session_id: '{session_id}'}});
if (tx) {{
  print('AMOUNT:' + tx.amount);
}} else {{
  print('NOT_FOUND');
}}
"""
            result = subprocess.run(
                ["mongosh", "--quiet", "--eval", mongo_script],
                capture_output=True,
                text=True
            )
            
            if "AMOUNT:2499" in result.stdout:
                print_result(True, f"Yearly price is 2499 cents ($24.99)")
                results.append(True)
            else:
                print_result(False, f"Yearly price is not 2499 cents")
                print(f"     MongoDB output: {result.stdout}")
                results.append(False)
    
    return all(results)

def main():
    print("=" * 70)
    print("CT Field Workbook - New Features Backend Testing")
    print("Testing: Feedback system, Admin whoami, AI Training, Stripe pricing")
    print("=" * 70)
    
    try:
        results = {}
        
        # Test 1: Admin whoami
        results["Test 1 - Admin whoami"] = test_admin_whoami()
        
        # Test 2: Feedback create
        feedback_passed, feedback_ids = test_feedback_create()
        results["Test 2 - Feedback create"] = feedback_passed
        
        # Test 3: Feedback list
        results["Test 3 - Feedback list"] = test_feedback_list(feedback_ids)
        
        # Test 4: Feedback update
        results["Test 4 - Feedback update"] = test_feedback_update(feedback_ids)
        
        # Test 5: AI Training mode
        results["Test 5 - AI Training mode"] = test_ai_training_mode()
        
        # Test 6: AI oilfield voice
        results["Test 6 - AI oilfield voice"] = test_ai_oilfield_voice()
        
        # Test 7: Stripe pricing
        results["Test 7 - Stripe pricing"] = test_stripe_pricing()
        
        # Summary
        print("\n" + "=" * 70)
        print("TEST SUMMARY")
        print("=" * 70)
        
        all_passed = True
        for test_name, passed in results.items():
            status = "✓ PASSED" if passed else "❌ FAILED"
            print(f"{test_name}: {status}")
            if not passed:
                all_passed = False
        
        print("=" * 70)
        
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
