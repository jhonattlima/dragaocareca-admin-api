#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Installing OS packages required by the backend workers..."
sudo apt-get update
sudo apt-get install -y ffmpeg python3 python3-pip python3-venv build-essential curl

echo "Upgrading pip and installing Python worker dependencies..."
python3 -m pip install --upgrade pip
python3 -m pip install -r "$ROOT_DIR/requirements-vps.txt"

cat <<'EOF'

This helper does not install Node.js. Use scripts/bootstrap-vps.sh for a full machine setup.

Next manual steps:
- Install a transcription binary and set EPISODE_TRANSCRIPTION_COMMAND.
- Download a Whisper model and set EPISODE_TRANSCRIPTION_MODEL_PATH.
- Ensure the process can write to data/database/, data/media/, and data/generated/.
EOF
