#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
ENV_FILE="${1:-$ROOT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Populate $ROOT_DIR/.env or pass a path as the first argument." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export CALLME_PHONE_PROVIDER="${CALLME_PHONE_PROVIDER:-twilio}"
export CALLME_MCP_TRANSPORT="${CALLME_MCP_TRANSPORT:-streamable-http}"
export CALLME_MCP_HTTP_PATH="${CALLME_MCP_HTTP_PATH:-/mcp}"
export CALLME_PORT="${CALLME_PORT:-3333}"

required_vars=(
  CALLME_PHONE_ACCOUNT_SID
  CALLME_PHONE_AUTH_TOKEN
  CALLME_PHONE_NUMBER
  CALLME_USER_PHONE_NUMBER
  CALLME_OPENAI_API_KEY
  CALLME_NGROK_AUTHTOKEN
)

missing=()
for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    missing+=("$var_name")
  fi
done

if [[ "${CALLME_PHONE_PROVIDER}" != "twilio" ]]; then
  echo "This launcher is Twilio-specific. Set CALLME_PHONE_PROVIDER=twilio in $ENV_FILE." >&2
  exit 1
fi

if [[ "${CALLME_MCP_TRANSPORT}" != "streamable-http" && "${CALLME_MCP_TRANSPORT}" != "both" ]]; then
  echo "This launcher expects CALLME_MCP_TRANSPORT to be streamable-http or both." >&2
  exit 1
fi

if [[ -n "${CALLME_PUBLIC_URL:-}" ]]; then
  echo "CALLME_PUBLIC_URL is set in $ENV_FILE, which disables ngrok." >&2
  echo "Remove CALLME_PUBLIC_URL to use ngrok exposure with this launcher." >&2
  exit 1
fi

if (( ${#missing[@]} > 0 )); then
  printf 'Missing required variables in %s:\n' "$ENV_FILE" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

if [[ ! -d "$SERVER_DIR/node_modules" ]]; then
  echo "Installing server dependencies..."
  (cd "$SERVER_DIR" && bun install)
fi

cat <<EOF
Starting CallMe with:
  provider: $CALLME_PHONE_PROVIDER
  transport: $CALLME_MCP_TRANSPORT
  local port: $CALLME_PORT
  MCP path: $CALLME_MCP_HTTP_PATH

After startup:
  1. Copy the printed ngrok URL.
  2. In Twilio, point your voice webhook to: <ngrok-url>/twiml
  3. Use the MCP endpoint at: <ngrok-url>$CALLME_MCP_HTTP_PATH
EOF

cd "$SERVER_DIR"
exec bun run src/index.ts
