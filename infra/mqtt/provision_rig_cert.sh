#!/usr/bin/env bash
# PKI + ACL helper for the Aegis MQTT broker (mutual TLS, one certificate per rig).
#
#   provision_rig_cert.sh init-ca                    create the private CA (pki/ca.*)
#   provision_rig_cert.sh server <hostname>          broker server certificate
#   provision_rig_cert.sh consumer                   cloud consumer client certificate (CN=cloud-consumer)
#   provision_rig_cert.sh rig <org_id> <rig_id>      per-rig client certificate + ACL entry
#   provision_rig_cert.sh revoke <org_id> <rig_id>   remove the rig's ACL entry
#
# Environment: PKI_DIR (default ./pki), ACL_FILE (default ./acl.conf), CERT_DAYS (default 825),
#              BROKER_CONTAINER (if set, SIGHUP it so Mosquitto reloads the ACL).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKI_DIR="${PKI_DIR:-$HERE/pki}"
ACL_FILE="${ACL_FILE:-$HERE/acl.conf}"
CERT_DAYS="${CERT_DAYS:-825}"
BEGIN="# --- BEGIN RIG ENTRIES ---"
END="# --- END RIG ENTRIES ---"

die() { echo "error: $*" >&2; exit 1; }
need_ca() { [[ -f "$PKI_DIR/ca.crt" && -f "$PKI_DIR/ca.key" ]] || die "CA missing; run '$0 init-ca' first"; }
check_id() { [[ "$2" =~ ^[A-Za-z0-9_-]{1,64}$ ]] || die "$1 must match [A-Za-z0-9_-]{1,64}"; }

issue() { # name cn [san]
  local name="$1" cn="$2" san="${3:-}" ext
  ext="$(mktemp)"
  { echo "basicConstraints=CA:FALSE"; echo "keyUsage=digitalSignature,keyEncipherment";
    if [[ "$name" == "server" ]]; then echo "extendedKeyUsage=serverAuth"; else echo "extendedKeyUsage=clientAuth"; fi
    [[ -n "$san" ]] && echo "subjectAltName=$san"; } > "$ext"
  umask 077
  openssl genrsa -out "$PKI_DIR/$name.key" 2048 2>/dev/null
  openssl req -new -key "$PKI_DIR/$name.key" -subj "/O=Aegis OS/CN=$cn" -out "$PKI_DIR/$name.csr"
  openssl x509 -req -in "$PKI_DIR/$name.csr" -CA "$PKI_DIR/ca.crt" -CAkey "$PKI_DIR/ca.key" \
    -CAcreateserial -days "$CERT_DAYS" -sha256 -extfile "$ext" -out "$PKI_DIR/$name.crt" 2>/dev/null
  rm -f "$ext" "$PKI_DIR/$name.csr"
  chmod 0644 "$PKI_DIR/$name.crt"
  # Mosquitto in Docker runs as an unprivileged user, so the server key must be group/world readable.
  [[ "$name" == "server" ]] && chmod 0644 "$PKI_DIR/$name.key"
  return 0
}

reload_broker() {
  if [[ -n "${BROKER_CONTAINER:-}" ]]; then docker kill -s HUP "$BROKER_CONTAINER" >/dev/null && echo "broker ACL reloaded"; fi
}

remove_acl() { # cn
  local cn="$1" tmp; tmp="$(mktemp)"
  awk -v cn="$cn" -v b="$BEGIN" -v e="$END" '
    $0==b {inside=1; print; next}
    $0==e {inside=0; print; next}
    inside && $0=="user " cn {skip=1; next}
    inside && skip && /^user / {skip=0}
    inside && skip && /^$/ {next}
    inside && skip {next}
    {print}' "$ACL_FILE" > "$tmp"
  cat "$tmp" > "$ACL_FILE"; rm -f "$tmp"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  init-ca)
    mkdir -p "$PKI_DIR"; umask 077
    [[ -f "$PKI_DIR/ca.key" ]] && die "CA already exists in $PKI_DIR"
    openssl genrsa -out "$PKI_DIR/ca.key" 4096 2>/dev/null
    openssl req -x509 -new -key "$PKI_DIR/ca.key" -sha256 -days 3650 \
      -subj "/O=Aegis OS/CN=Aegis MQTT CA" -out "$PKI_DIR/ca.crt"
    chmod 0644 "$PKI_DIR/ca.crt"; echo "CA created in $PKI_DIR" ;;
  server)
    host="${1:?usage: server <hostname>}"; need_ca
    [[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || die "invalid hostname"
    san="DNS:$host"; [[ "$host" == "localhost" ]] && san="DNS:localhost,IP:127.0.0.1"
    issue server "$host" "$san"; echo "server cert for $host written to $PKI_DIR" ;;
  consumer)
    need_ca; issue cloud-consumer "cloud-consumer"
    echo "consumer cert: $PKI_DIR/cloud-consumer.{crt,key} (set MQTT_CLIENT_CERT / MQTT_CLIENT_KEY)" ;;
  rig)
    org="${1:?usage: rig <org_id> <rig_id>}"; rig="${2:?usage: rig <org_id> <rig_id>}"
    check_id org_id "$org"; check_id rig_id "$rig"; need_ca
    cn="rig:${org}:${rig}"; name="rig-${org}-${rig}"
    issue "$name" "$cn"
    remove_acl "$cn"
    entry="$(mktemp)"
    cat > "$entry" <<ACL
user $cn
topic write aegis/$org/$rig/telemetry/events
topic write aegis/$org/$rig/telemetry/snapshots
topic write aegis/$org/$rig/telemetry/consensus
topic read aegis/$org/$rig/ack
ACL
    tmp="$(mktemp)"
    awk -v e="$END" -v f="$entry" '$0==e { while ((getline l < f) > 0) print l; print "" } {print}' "$ACL_FILE" > "$tmp"
    cat "$tmp" > "$ACL_FILE"; rm -f "$tmp" "$entry"
    reload_broker
    echo "rig cert: $PKI_DIR/$name.{crt,key}; ACL scoped to aegis/$org/$rig/#" ;;
  revoke)
    org="${1:?usage: revoke <org_id> <rig_id>}"; rig="${2:?usage: revoke <org_id> <rig_id>}"
    check_id org_id "$org"; check_id rig_id "$rig"
    remove_acl "rig:${org}:${rig}"; reload_broker; echo "ACL entry removed" ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
