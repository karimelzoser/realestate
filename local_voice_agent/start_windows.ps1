$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Test-Path ".venv")) { py -3 -m venv .venv }
& .\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r local_voice_agent\requirements.txt
$port = if ($env:PRENEURA_VOICE_PORT) { $env:PRENEURA_VOICE_PORT } else { "8765" }
python -m uvicorn local_voice_agent.server67:app --host 127.0.0.1 --port $port
