# RCA — Custom domain mycoiltubingpocketsupports.tech "not showing latest build"

## Summary
No defect on the custom domain. `https://mycoiltubingpocketsupports.tech` points at the latest deployment (active run `eced1a83-afca-4e8e-b335-709d8d9dd6e1`, completed 2026-10-21T09:16:18Z, all steps green) and serves the current backend + frontend. No stale edge/CDN cache of index.html or the JS bundle. The reported symptom was the deploy being mid-flight at report time; it has since completed and promoted. Any remaining "old UI" is local browser cache.

## Evidence (custom domain specifically)

### Latest deploy completed (not failed)
- Run `eced1a83…` type=redeploy, status=success. Steps: wakeup_environment, build, mongodb_migrate, manage_secrets, deploy, health_check — all success.
- Build (AWS CodeBuild) state SUCCEEDED; image rotated to `sha256:08f66…` (was `sha256:83e01…`). dnd-kit deps present in run source `frontend/package.json` (@dnd-kit/core ^6.3.1, @dnd-kit/sortable ^10.0.0, @dnd-kit/utilities ^3.2.2); build succeeded so yarn install resolved them. New backend `plugs_module.py` endpoints are mounted (see 401 below).

### Domain points at the latest deployment
- `list_domains`: `mycoiltubingpocketsupports.tech` verified=true, provider=cloudflare, **ssl_status=active**, root_redirect_enabled=true. `www.` subdomain verified=false, **ssl_status=pending_validation**.
- `check_domain_status`: both apex and www linked=true (DNS resolves to us).
- `GET https://mycoiltubingpocketsupports.tech/` and `/live-ops` → 200, both reference the SAME current bundle `/static/js/main.94c972ac.js` as the default `*.emergent.host` URL (= latest build, not an older one).

### Frontend bundle is the latest (verified by content)
- Live production bundle `main.94c972ac.js` (2.26 MB) contains: "Main Operator View", "Enterprise Demo", "CoilAegis OS", "/live-ops/classic", "plug-runs", "operator-layout" — all the new /live-ops Operator View features. (Identifiers `MainOperatorScreen`/`OperatorPage` and the `dnd-kit` package string are minified/stripped, so their literal absence is expected and not meaningful.)

### Backend is the latest on the custom domain
- `GET https://mycoiltubingpocketsupports.tech/api/team/channel-config` → **401** `{"detail":"Not authenticated"}` (not 404) = new `plugs_module.py` router is live.

### No stale CDN/edge cache
- index.html on both apex and www: `Cache-Control: no-cache, no-store, must-revalidate`, `CF-Cache-Status: None` (not edge-cached), `Server: cloudflare`. Returning clients revalidate index.html every load and get the current hashed bundle reference. Static JS is content-hashed (`main.94c972ac.js`), so a new build changes the filename — no way to serve a stale bundle under the same name.

## Root cause
None on the server/domain side. The custom domain already serves the latest build end-to-end (new backend 401, new frontend bundle). The report coincided with the deploy still running (pre-promote), when prod served the prior build. Any persistent "old UI" now is the end user's own browser holding the previously-loaded SPA/page.

## Minor note (not the cause of the symptom)
- `www.mycoiltubingpocketsupports.tech` SSL is `pending_validation` (HTTP validation not yet complete). The apex is active and serving fine. If the user wants `www` to work reliably over HTTPS for all clients, the HTTP validation needs to finish — ensure the www DNS record points at us and let Cloudflare complete cert issuance.

## Fix / Next actions
- **User (test_and_verify):** Site is current. Hard-refresh (Cmd/Ctrl+Shift+R) or open incognito on `https://mycoiltubingpocketsupports.tech` to drop any locally-cached old page; you should see the new CoilAegis OS Main Operator View on /live-ops.
- **User (domain, optional):** `www` subdomain SSL is still pending_validation — complete DNS/HTTP validation if www-over-HTTPS is needed. Apex is unaffected.
- No Code or Platform action required.
