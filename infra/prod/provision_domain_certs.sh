#!/usr/bin/env bash
# Provision the private MQTT PKI for the production domain (idempotent: existing files are kept).
#
#   provision_domain_certs.sh            CA + server cert (SAN DNS:$MQTT_DOMAIN) + cloud-consumer client cert
#
# Rig certs afterwards: PKI_DIR=infra/prod/pki ACL_FILE=infra/mqtt/acl.conf infra/mqtt/provision_rig_cert.sh rig <org> <rig>
# Environment: MQTT_DOMAIN (default mqtt.mycoiltubingpocketsupports.tech), PKI_DIR (default ./pki), CERT_DAYS (825).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MQTT_DOMAIN="${MQTT_DOMAIN:-mqtt.mycoiltubingpocketsupports.tech}"
export PKI_DIR="${PKI_DIR:-$HERE/pki}"
export ACL_FILE="${ACL_FILE:-$HERE/../mqtt/acl.conf}"
HELPER="$HERE/../mqtt/provision_rig_cert.sh"
CERT_DAYS="${CERT_DAYS:-825}"

[[ "$MQTT_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "error: invalid MQTT_DOMAIN" >&2; exit 1; }
command -v openssl >/dev/null || { echo "error: openssl required" >&2; exit 1; }
mkdir -p "$PKI_DIR"

if [[ ! -f "$PKI_DIR/ca.key" ]]; then
  "$HELPER" init-ca
else
  echo "CA exists; keeping"
fi

# Reissue the server cert when missing, expiring within 30 days, or lacking the expected SAN.
need_server=0
if [[ ! -f "$PKI_DIR/server.crt" || ! -f "$PKI_DIR/server.key" ]]; then
  need_server=1
elif ! openssl x509 -in "$PKI_DIR/server.crt" -noout -checkend $((30 * 86400)) >/dev/null; then
  need_server=1
elif ! openssl x509 -in "$PKI_DIR/server.crt" -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:$MQTT_DOMAIN"; then
  need_server=1
fi
if [[ "$need_server" == 1 ]]; then
  CERT_DAYS="$CERT_DAYS" "$HELPER" server "$MQTT_DOMAIN"
else
  echo "server cert for $MQTT_DOMAIN is valid; keeping"
fi

if [[ ! -f "$PKI_DIR/cloud-consumer.crt" ]]; then
  CERT_DAYS="$CERT_DAYS" "$HELPER" consumer
  # The backend container runs unprivileged and mounts pki read-only.
  chmod 0644 "$PKI_DIR/cloud-consumer.key"
else
  echo "cloud-consumer cert exists; keeping"
fi

openssl x509 -in "$PKI_DIR/server.crt" -noout -subject -enddate -ext subjectAltName
