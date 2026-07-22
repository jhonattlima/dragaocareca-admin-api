#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Installing Node.js 18 from NodeSource..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "Installing backend worker dependencies..."
"$ROOT_DIR/scripts/install-vps-deps.sh"

echo "Installing Node.js project dependencies..."
cd "$ROOT_DIR"
npm install

cat <<'EOF'

Bootstrap complete.

You still need to provide:
- a transcription binary via EPISODE_TRANSCRIPTION_COMMAND
- a Whisper model via EPISODE_TRANSCRIPTION_MODEL_PATH
- writable data directories for the app user

Recommended next step:
- copy .env.production, fill the secrets, then run npm run build
EOF
