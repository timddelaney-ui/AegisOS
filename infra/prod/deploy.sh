#!/usr/bin/env bash
# Idempotent production deploy: certs -> frontend build -> compose up -d -> health wait.
# Safe to re-run. Env: SKIP_FRONTEND_BUILD=1, HEALTH_TIMEOUT (seconds, default 180).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
COMPOSE_FILE="$HERE/docker-compose.prod.yml"
ENV_FILE="$HERE/.env.prod"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

die() { echo "error: $*" >&2; exit 1; }
log() { echo "==> $*"; }

command -v docker >/dev/null || die "docker is required"
docker compose version >/dev/null 2>&1 || die "docker compose plugin is required"
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE missing; copy .env.prod.example and fill it in"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
[[ "${HITL_ENFORCE_OUTBOUND:-}" == "true" ]] || die "HITL_ENFORCE_OUTBOUND must be true in $ENV_FILE"
[[ "${APP_ENV:-}" == "production" ]] || die "APP_ENV must be production in $ENV_FILE"
[[ "${BETA_TEST_MODE:-false}" != "true" ]] || die "BETA_TEST_MODE must not be enabled in production"

log "provisioning MQTT PKI"
MQTT_DOMAIN="${MQTT_DOMAIN:-mqtt.mycoiltubingpocketsupports.tech}" "$HERE/provision_domain_certs.sh"

if [[ "${SKIP_FRONTEND_BUILD:-0}" != "1" ]]; then
  log "building frontend"
  command -v node >/dev/null || die "node is required to build the frontend (or set SKIP_FRONTEND_BUILD=1)"
  (
    cd "$ROOT/frontend"
    export REACT_APP_BACKEND_URL="${PUBLIC_API_URL:-https://mycoiltubingpocketsupports.tech}"
    if command -v yarn >/dev/null; then yarn install --frozen-lockfile && yarn build
    else npm install --legacy-peer-deps && npm run build; fi
  )
fi
[[ -f "$ROOT/frontend/build/index.html" ]] || die "frontend/build/index.html missing"

log "validating compose file"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config -q

log "starting stack"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build --remove-orphans

log "waiting for services to become healthy (timeout ${HEALTH_TIMEOUT}s)"
deadline=$((SECONDS + HEALTH_TIMEOUT))
while :; do
  bad=0
  for svc in mongo backend mosquitto; do
    cid="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q "$svc")"
    state="$([[ -n "$cid" ]] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" || echo missing)"
    [[ "$state" == "healthy" || "$state" == "running" ]] || bad=1
  done
  [[ "$bad" == 0 ]] && break
  (( SECONDS < deadline )) || { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps; die "services not healthy in time"; }
  sleep 5
done

log "verifying public endpoint"
domain="${PUBLIC_DOMAIN:-mycoiltubingpocketsupports.tech}"
until curl -fsS -o /dev/null --max-time 5 "https://$domain/api/"; do
  (( SECONDS < deadline )) || die "https://$domain/api/ not reachable (check DNS and ports 80/443)"
  sleep 5
done
log "deploy OK: https://$domain"
