# PRENEURA Local Live Allocation Agent — 6.7

This service is the local speech + AI runtime for **Online Allocation**. PRENEURA remains authoritative for queue order, buyer eligibility, live inventory, exact-unit locks, grace periods, payment, contract and audit. The AI may explain, rank, compare, navigate, scroll and highlight; it cannot silently execute irreversible transaction actions.

## Current release language

**PRENEURA 6.7 is English-only for the active buyer-facing live allocation agent.**

The earlier Egyptian Arabic runtime remains in the repository as a reusable language profile, but `start_linux.sh` and `start_windows.ps1` now launch `local_voice_agent.server67:app`.

## Current local stack

| Layer | Default | Purpose |
| --- | --- | --- |
| Speech → text | `Systran/faster-whisper-large-v3-turbo` | General English local ASR for 6.7. |
| Agent brain | `Qwen/Qwen3-30B-A3B-Instruct-2507` | Local reasoning + safe UI tools through an OpenAI-compatible runner. |
| Speech output | Existing PRENEURA local streaming TTS transport | Private/local voice output when configured. |
| Browser fallback | `speechSynthesis` with `en-US` | Presentation-safe English fallback when the local runtime is unavailable. |

The 6.7 agent prompt is deliberately concise and conversational. It behaves like a senior property advisor sitting beside the buyer rather than an IVR or generic chatbot.

## Buyer experience

When Online Allocation begins, the advisor can guide:

`Allocation Day → Master Plan → Building → Floor → Exact Unit`

It reads PRENEURA's buyer decision context and currently available units, ranks the best matches by eligibility/budget/rooms/area/floor/view/building, and can:

- speak and listen in English;
- listen hands-free with VAD and barge-in;
- show the top recommendations with reasons;
- navigate to Master Plan / Building / Floor / Unit pages;
- auto-scroll and highlight what it is talking about;
- compare exact units and explain trade-offs;
- open safe reversible choices during the guided tour;
- stop at final unit-lock confirmation and let the buyer decide;
- explain that a 24-hour extended lock grace requires Transaction Operator approval.

It **never** silently locks a unit, confirms payment, signs a legal contract, changes price or alters queue priority.

## Installation

Python 3.11/3.12, `ffmpeg`, Git and an NVIDIA CUDA environment are recommended for the full profile.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
# Install the PyTorch build appropriate for your GPU first.
pip install -r local_voice_agent/requirements.txt
```

The selected model repositories may require standard Hugging Face authentication depending on the deployment environment:

```bash
hf auth login
```

## Local Qwen agent brain

Run the local reasoning model through vLLM or another OpenAI-compatible server, for example:

```bash
vllm serve Qwen/Qwen3-30B-A3B-Instruct-2507 \
  --host 127.0.0.1 \
  --port 8000 \
  --api-key local
```

A smaller Qwen model can be used on smaller hardware by changing `PRENEURA_LLM_MODEL` and `PRENEURA_LLM_BASE_URL`. Unit ranking and safety boundaries remain deterministic in PRENEURA even when the LLM is unavailable.

## Start the 6.7 English voice service

Copy the example configuration if desired:

```bash
cp local_voice_agent/.env.example .env
```

Linux:

```bash
bash local_voice_agent/start_linux.sh
```

Windows PowerShell:

```powershell
.\local_voice_agent\start_windows.ps1
```

Direct command:

```bash
uvicorn local_voice_agent.server67:app --host 127.0.0.1 --port 8765
```

Health check:

```bash
curl http://127.0.0.1:8765/health
```

The browser probes `http://127.0.0.1:8765`. When connected the advisor reports **LOCAL AI • CONNECTED**. If the local runtime is unavailable, PRENEURA keeps the English browser-voice/text guidance active so the demo journey does not stop.

GitHub Pages can host the frontend but cannot host the local GPU models. Full local-model quality therefore requires this service on the buyer/presentation machine or a private PRENEURA inference server reachable by the frontend.

## API

- `GET /health`
- `POST /v1/agent`
- `POST /v1/transcribe`
- `POST /v1/tts`
- `WS /ws/voice`

The WebSocket supports text turns, microphone audio, actions and phrase-streamed audio playback for lower perceived latency.

## 6.7 unit-lock grace interaction

The voice advisor itself does not approve grace periods. It may explain the policy and direct the user to the appropriate screen.

- Short handoff grace begins after an exact physical unit is locked.
- Online buyers may request a 24-hour extension with a reason.
- The Transaction Operator must approve or reject that request.
- Sales Center / Offline 24-hour paperwork exceptions can be granted only by Transaction Operations.

This separation is intentional: the AI assists the buyer, while PRENEURA roles retain transactional authority.

## Commercial deployment note

Before production rollout, pin model revisions, review all third-party model licenses, run acceptance testing with the developer's target audience, and benchmark the selected GPU for transcription, first-token and first-audio latency. Keep inference private to the developer/PRENEURA environment; never expose model-control secrets in the public frontend.
