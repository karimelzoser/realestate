#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
if [[ ! -d .venv ]]; then python3 -m venv .venv; fi
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r local_voice_agent/requirements.txt
exec python -m uvicorn local_voice_agent.server:app --host 127.0.0.1 --port "${PRENEURA_VOICE_PORT:-8765}"
