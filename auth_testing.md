# Auth-Gated App Testing Playbook (CT Field Workbook)

## Step 1: Create Test User & Session
```bash
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  team_id: null,
  subscription_status: 'free',
  subscription_plan: null,
  subscription_expires_at: null,
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Step 2: Backend API Endpoints to Test
- `GET  /api/auth/me` — returns user (Bearer token or cookie)
- `POST /api/auth/session` — exchange session_id for cookie
- `POST /api/auth/logout` — clears session
- `GET  /api/subscription/status` — returns status/plan/expires_at
- `POST /api/payments/checkout` — body `{lookup_key, origin_url}`
- `GET  /api/payments/status/{session_id}` — poll
- `POST /api/teams` — body `{name}`, creates team
- `POST /api/teams/join` — body `{invite_code}`
- `POST /api/teams/leave`
- `GET  /api/teams/me`
- `POST /api/jobs` — body `{sheet_key, title, unit_system, values, visibility}`
- `GET  /api/jobs` — list user + team jobs
- `GET  /api/jobs/{id}`
- `PATCH /api/jobs/{id}`
- `DELETE /api/jobs/{id}`

## Step 3: Pricing keys
- `ct_pro_monthly` — $5/month
- `ct_pro_yearly` — $60/year

## Free Sheets (no subscription needed)
- `Pipe_Stretch`, `Sand_Cleanout`, `Fishing_Ops`

All other 14 sheets + Emergency_SOPs require `subscription_status: "active"`.

## Test Card
`4242 4242 4242 4242` — any future date, any CVC.
