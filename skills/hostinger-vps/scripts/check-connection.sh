#!/usr/bin/env bash
set -Eeuo pipefail

credentials_file="${HOSTINGER_VPS_CREDENTIALS_FILE:-$HOME/.config/hostinger-vps/credentials.env}"
if [[ -r "$credentials_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$credentials_file"
  set +a
fi

: "${HOSTINGER_VPS_HOST:?Set HOSTINGER_VPS_HOST before running this check}"
: "${HOSTINGER_VPS_USER:?Set HOSTINGER_VPS_USER before running this check}"
: "${HOSTINGER_VPS_SSH_KEY:?Set HOSTINGER_VPS_SSH_KEY before running this check}"

if [[ ! -r "$HOSTINGER_VPS_SSH_KEY" ]]; then
  printf 'SSH key is not readable: %s\n' "$HOSTINGER_VPS_SSH_KEY" >&2
  exit 1
fi

port="${HOSTINGER_VPS_PORT:-22}"
target="${HOSTINGER_VPS_USER}@${HOSTINGER_VPS_HOST}"

ssh \
  -o BatchMode=yes \
  -o ConnectTimeout=10 \
  -o ServerAliveInterval=10 \
  -o ServerAliveCountMax=2 \
  -p "$port" \
  -i "$HOSTINGER_VPS_SSH_KEY" \
  "$target" \
  'printf "connected\n"; hostname; uname -srm; free -h; df -h /'
