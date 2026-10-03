# PRENEURA Local Egyptian Live Allocation Agent — 6.4

This service is the local speech + AI runtime for **Online Allocation**. PRENEURA remains authoritative for queue order, buyer eligibility, live inventory, exact-unit locks, payment, contract and audit. The AI may explain, rank, compare, navigate, scroll and highlight; it cannot silently execute irreversible transaction actions.

## Quality-first local stack

| Layer | Default | Purpose |
| --- | --- | --- |
| Speech → text | `CohereLabs/cohere-transcribe-arabic-07-2026` | Arabic/dialect ASR. |
| ASR fallback | `dev-ahmedhany/whisper-large-v3-turbo-arabic-ft-ct2-int8` | Public local fallback. |
| Agent brain | `Qwen/Qwen3-30B-A3B-Instruct-2507` | Multilingual local reasoning + safe UI tools through an OpenAI-compatible runner. |
| Egyptian voice | `itshamdi404/Egy_Arabic_Qwen3-TTS-12Hz-1.7B-Base` | Egyptian Arabic Qwen3-TTS fine-tune. |
| Speaker | `egyptian_speaker` | Egyptian custom voice embedded in that model. |

The 6.4 agent prompt is deliberately **Egyptian, polite and conversational**: short Cairo-Egyptian phrases, natural code switching, no stiff MSA sales script, and no over-familiar slang. The assistant speaks about the exact UI element currently on screen and advances one decision at a time.

## Buyer experience

When Online Allocation begins, the advisor can guide:

`Allocation Day → Master Plan → Building → Floor → Exact Unit`

It reads PRENEURA's authoritative buyer context and currently available units, ranks the best matches by eligibility/budget/rooms/area/floor/view/building, and can:

- speak naturally in Egyptian Arabic;
- listen hands-free with VAD and barge-in;
- show the top recommendations with reasons;
- navigate to Master Plan / Building / Floor / Unit pages;
- auto-scroll and highlight what it is talking about;
- compare exact units and explain trade-offs;
- open safe reversible choices during the guided tour;
- stop at final unit-lock confirmation and let the buyer decide.

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

For the primary Arabic ASR, accept the Hugging Face model conditions once and authenticate:

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

A smaller multilingual Qwen model can be used on smaller hardware by changing `PRENEURA_LLM_MODEL` and `PRENEURA_LLM_BASE_URL`. Unit ranking and safety boundaries remain deterministic in PRENEURA even when the LLM is unavailable.

## Start the voice service

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
uvicorn local_voice_agent.server64:app --host 127.0.0.1 --port 8765
```

Health check:

```bash
curl http://127.0.0.1:8765/health
```

The browser probes `http://127.0.0.1:8765`. When connected the advisor reports **LOCAL AI • متصل**. GitHub Pages can host the frontend but cannot host the local GPU models; the full-quality voice requires this service on the buyer's machine or a private PRENEURA inference server reachable by the frontend.

## API

- `GET /health`
- `POST /v1/agent`
- `POST /v1/transcribe`
- `POST /v1/tts`
- `WS /ws/voice`

The WebSocket supports text turns, microphone audio, actions and phrase-streamed Float32 PCM playback for lower perceived latency.

## Commercial deployment note

Before production rollout, pin model revisions, review all third-party model licenses, run Arabic/Egyptian acceptance testing with the developer's target audience, and benchmark the selected GPU for first-audio latency. Keep inference private to the developer/PRENEURA environment; never expose model-control secrets in the public frontend.
