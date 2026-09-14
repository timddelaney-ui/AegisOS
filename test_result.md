#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Add monetization to CT Field Workbook: Emergent Google Auth, backend for teams + saved jobs (private/team visibility), 
  Stripe subscription ($5/month or $60/year Founder's Launch pricing). Free tier: 3 sheets (Pipe_Stretch, Sand_Cleanout, Fishing_Ops); 
  Pro unlocks all 17 sheets + Emergency SOPs.

backend:
  - task: "Emergent Google Auth (session exchange, /auth/me, /auth/logout)"
    implemented: true
    working: false
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Implemented POST /api/auth/session (exchanges Emergent session_id for cookie), GET /api/auth/me, POST /api/auth/logout. Uses httpOnly cookie + Bearer token fallback. Users collection uses custom user_id UUID field, _id excluded from responses."
        -working: false
        -agent: "testing"
        -comment: "Tested auth endpoints. GET /api/auth/me works correctly with Bearer token. BUG FOUND: POST /api/auth/logout does not delete session when using Bearer token authentication - it only checks Cookie, not Authorization header. Session remains in database after logout when using Bearer token. The logout endpoint needs to extract token from Authorization header similar to get_current_user function."

  - task: "Stripe subscription checkout ($5/mo, $60/yr)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Provisioned claimable Stripe sandbox. Created catalog with ct_pro_monthly ($5/mo) and ct_pro_yearly ($60/yr). POST /api/payments/checkout, GET /api/payments/status/{id} (with inline Stripe fallback), POST /api/stripe/webhook. On paid, sets user subscription_status=active with expires_at."
        -working: true
        -agent: "testing"
        -comment: "All Stripe endpoints working correctly. GET /api/subscription/status returns 'free' for new users. POST /api/payments/checkout creates checkout session with valid lookup_key (ct_pro_monthly), returns checkout_url and session_id. Invalid lookup_key correctly returns 500 error. GET /api/payments/status/{session_id} returns 'pending' status as expected."

  - task: "Team management (create/join/leave/get)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "POST /api/teams creates a team with 8-char uppercase invite_code. POST /api/teams/join accepts invite_code. POST /api/teams/leave. GET /api/teams/me returns team + members list. Users have team_id field."
        -working: true
        -agent: "testing"
        -comment: "All team endpoints working correctly. POST /api/teams creates team with invite_code. GET /api/teams/me returns team with correct member count. POST /api/teams/join successfully adds second user to team. Team now shows 2 members. POST /api/teams/leave successfully removes user from team."

  - task: "Saved field jobs CRUD with visibility (private/team)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "POST /api/jobs, GET /api/jobs (returns user's private + team-visible jobs), GET /api/jobs/{id}, PATCH /api/jobs/{id} (owner only), DELETE /api/jobs/{id} (owner only). visibility=team requires team_id."
        -working: true
        -agent: "testing"
        -comment: "All job endpoints working correctly with proper visibility filtering. POST /api/jobs creates jobs with private/team visibility. GET /api/jobs correctly filters: owner sees both private and team jobs, team member sees only team jobs (NOT private). PATCH /api/jobs/{id} updates job title. DELETE /api/jobs/{id} correctly returns 403 for non-owner, succeeds for owner."

frontend:
  - task: "Login page + Google OAuth flow + AuthCallback"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/Login.jsx, AuthCallback.jsx, App.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Login page with Google button. AuthCallback processes session_id from URL hash. Router detects hash synchronously (not in useEffect) to prevent race conditions. AuthProvider skips /auth/me when hash contains session_id."

  - task: "Pricing page + Payment Success/Cancel"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/Pricing.jsx, PaymentPages.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Pricing page with $5/mo and $60/yr plans, Founder's Launch banner. PaymentSuccess polls /payments/status/{id} up to 40s. PaymentCancel navigates back."

  - task: "Paywall + free/pro sheet gating"
    implemented: true
    working: "NA"
    file: "frontend/src/components/Paywall.jsx, App.js, SheetTabs.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Free sheets: Pipe_Stretch, Sand_Cleanout, Fishing_Ops. Locked sheets show Paywall component with pricing. Locked tabs have Lock icon."

  - task: "Team management page"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/TeamPage.jsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Create team, join by invite code, leave team, view members, copy invite code."

  - task: "Save/Load field jobs"
    implemented: true
    working: "NA"
    file: "frontend/src/components/SaveJobDialog.jsx, pages/JobsPage.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Save dialog with title, private/team toggle. JobsPage lists all jobs, tap to load into sheet, delete owner-only."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 2
  run_ui: false

test_plan:
  current_focus:
    - "Emergent Google Auth (session exchange, /auth/me, /auth/logout)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

## Status History
- 2026-09-14: Fixed logout to accept Bearer token as fallback to cookie.

agent_communication:
    -agent: "testing"
    -message: "All backend endpoints tested. Only bug: logout didn't clear session with Bearer token. FIXED by main agent - logout now checks Authorization header as fallback to cookie."
    -agent: "main"
    -message: |
      Built full backend for CT Field Workbook monetization. Please test all backend endpoints listed in test_plan.
      Auth uses Emergent Google OAuth. Use /app/auth_testing.md instructions to create a test user + session token.
      Stripe is in test mode (sandbox). Use card 4242 4242 4242 4242 for checkout tests, but you can test
      the checkout endpoint without actually completing payment - just verify a checkout_url is returned.
      For jobs, verify private vs team visibility filtering. For teams, verify invite_code flow works end-to-end.
    -agent: "testing"
    -message: |
      Backend testing completed. Created comprehensive test suite in /app/backend_test.py.
      
      RESULTS:
      ✓ TEAMS: All endpoints working (create, join, leave, get with member list)
      ✓ JOBS: All CRUD operations working with correct visibility filtering (private/team)
      ✓ SUBSCRIPTION/STRIPE: All endpoints working (status, checkout, payment status)
      ❌ AUTH: Logout bug found - does not delete session when using Bearer token
      
      BUG DETAILS:
      The POST /api/auth/logout endpoint only extracts session_token from Cookie parameter, but does not check the Authorization header for Bearer tokens. When testing with Bearer token authentication, the session remains in the database after logout and subsequent /api/auth/me calls still succeed. The logout function needs to extract the token from the Authorization header similar to how get_current_user does it (lines 82-91 in server.py).
      
      Fix needed in server.py line 212:
      - Add authorization: Optional[str] = Header(None) parameter
      - Extract token from Authorization header if Cookie is None
      - Delete session using the extracted token
