#!/usr/bin/env bash
set -euo pipefail
umask 027

mode="${1:-provision}"
if [[ "$mode" == "--help" ]]; then
  printf '%s\n' \
    "usage: generate-device-identity.sh [provision|renew|rotate|reset --confirm-reset]" \
    "" \
    "Environment: STATE_DIR, SECRET_DIR, SERVICE_USER, SERVICE_GROUP," \
    "DEVICE_HOSTNAME, ADVERTISED_BASE_URL, CORS_ALLOWED_ORIGINS, CERT_DAYS"
  exit 0
fi

case "$mode" in
  provision|renew|rotate) ;;
  reset)
    [[ "${2:-}" == "--confirm-reset" ]] || {
      echo "reset changes the Thing ID and credentials; pass --confirm-reset" >&2
      exit 2
    }
    ;;
  *) echo "unknown identity operation: $mode" >&2; exit 2 ;;
esac

STATE_DIR="${STATE_DIR:-/var/lib/pi-display-wot}"
SECRET_DIR="${SECRET_DIR:-/etc/pi-display-wot}"
SERVICE_USER="${SERVICE_USER:-pi-display-wot}"
SERVICE_GROUP="${SERVICE_GROUP:-pi-display-wot}"
DEVICE_HOSTNAME="${DEVICE_HOSTNAME:-$(hostname -f)}"
ADVERTISED_BASE_URL="${ADVERTISED_BASE_URL:-https://${DEVICE_HOSTNAME}}"
CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-https://${DEVICE_HOSTNAME}}"
CERT_DAYS="${CERT_DAYS:-397}"

thing_id_file="$STATE_DIR/thing-id"
key_file="$SECRET_DIR/device.key"
certificate_file="$SECRET_DIR/device.crt"
environment_file="$SECRET_DIR/runtime.env"

for command in install openssl; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
done
[[ "$CERT_DAYS" =~ ^[1-9][0-9]*$ ]] || { echo "CERT_DAYS must be a positive integer" >&2; exit 2; }
[[ "$DEVICE_HOSTNAME" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || { echo "DEVICE_HOSTNAME must be a DNS hostname" >&2; exit 2; }
[[ "$ADVERTISED_BASE_URL" == https://* && "$ADVERTISED_BASE_URL" != *$'\n'* ]] || { echo "ADVERTISED_BASE_URL must be HTTPS" >&2; exit 2; }
[[ "$CORS_ALLOWED_ORIGINS" != *$'\n'* && "$CORS_ALLOWED_ORIGINS" != *'*'* ]] || { echo "CORS_ALLOWED_ORIGINS must contain explicit origins" >&2; exit 2; }

install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$STATE_DIR"
install -d -m 0750 -o root -g "$SERVICE_GROUP" "$SECRET_DIR"

if [[ "$mode" == "reset" ]]; then
  rm -f "$thing_id_file" "$key_file" "$certificate_file" "$environment_file"
fi

if [[ ! -f "$thing_id_file" ]]; then
  random_hex="$(openssl rand -hex 16)"
  thing_id="urn:uuid:${random_hex:0:8}-${random_hex:8:4}-4${random_hex:13:3}-a${random_hex:17:3}-${random_hex:20:12}"
  printf '%s\n' "$thing_id" > "$thing_id_file"
fi

if [[ "$mode" == "rotate" ]]; then
  rm -f "$key_file" "$certificate_file" "$environment_file"
elif [[ "$mode" == "renew" ]]; then
  rm -f "$certificate_file"
fi

if [[ ! -f "$key_file" ]]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$key_file"
fi

if [[ ! -f "$certificate_file" ]]; then
  openssl req -new -x509 -sha256 -days "$CERT_DAYS" \
    -key "$key_file" -out "$certificate_file" \
    -subj "/CN=${DEVICE_HOSTNAME}" \
    -addext "subjectAltName=DNS:${DEVICE_HOSTNAME}"
fi

if [[ ! -f "$environment_file" || "$mode" == "rotate" || "$mode" == "reset" ]]; then
  password="$(openssl rand -base64 36 | tr -d '\n')"
  cat > "$environment_file" <<EOF
PI_DISPLAY_DEPLOYED=true
PI_DISPLAY_BIND_ADDRESS=127.0.0.1
PI_DISPLAY_ADVERTISED_BASE_URL=$ADVERTISED_BASE_URL
PI_DISPLAY_CORS_ALLOWED_ORIGINS=$CORS_ALLOWED_ORIGINS
PI_DISPLAY_THING_ID=$(cat "$thing_id_file")
PI_DISPLAY_USERNAME=pi-display-admin
PI_DISPLAY_PASSWORD=$password
PI_DISPLAY_TLS_CERT_PATH=$certificate_file
PI_DISPLAY_TLS_KEY_PATH=$key_file
EOF
fi

chown "$SERVICE_USER:$SERVICE_GROUP" "$thing_id_file" "$key_file" "$certificate_file" "$environment_file"
chmod 0644 "$thing_id_file" "$certificate_file"
chmod 0640 "$key_file" "$environment_file"

echo "Identity operation '$mode' complete."
echo "Persistent Thing ID: $thing_id_file (0644, $SERVICE_USER:$SERVICE_GROUP)"
echo "TLS certificate: $certificate_file (0644); private key: $key_file (0640)"
echo "Runtime credentials: $environment_file (0640); never copy this file into source control"
echo "Back up the Thing ID separately; renew preserves key and ID, rotate preserves ID, reset replaces both."