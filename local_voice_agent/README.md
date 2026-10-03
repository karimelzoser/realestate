# PRENEURA Local Egyptian Voice Allocation Agent

This is the fully local speech/agent runtime for the **Online Allocation** journey in PRENEURA Real Estate OS. The browser remains authoritative for buyer eligibility, queue state, live inventory, exact-unit state, price, lock, transaction and contract truth. The local AI only receives decision-relevant context and may explain, rank, compare, navigate, scroll and highlight.

## Default model stack

| Layer | Default | Role |
| --- | --- | --- |
| Speech → text | `CohereLabs/cohere-transcribe-arabic-07-2026` | Arabic/dialect ASR with local Transformers inference. |
| ASR fallback | `dev-ahmedhany/whisper-large-v3-turbo-arabic-ft-ct2-int8` | Public CTranslate2/int8 fallback when the primary gated model is unavailable. |
| Agent brain | `Qwen/Qwen3-30B-A3B-Instruct-2507` | Local multilingual instruction/tool-use model through an OpenAI-compatible endpoint. |
| Egyptian voice | `mohammedaly22/VoiceTut-TTS` | Egyptian-first TTS, Arabic/English code-switching and streaming. |
| Default speaker | `Omnia` | Female Egyptian built-in voice. Change with `PRENEURA_TTS_SPEAKER`. |

The stack is configurable. `PRENEURA_LLM_BASE_URL` can point to vLLM, llama.cpp, LM Studio or another **OpenAI-compatible local** server.

## Buyer experience

When an online allocation session starts, the agent introduces itself in Egyptian Arabic and guides:

`Allocation Day → Master Plan → Building → Floor → Exact Unit`

It can:

- read currently available PRENEURA units instead of inventing inventory;
- rank the best units using eligibility, budget, rooms, area, floor, view and building preferences;
- show the top three recommendations with reasons;
- speak about the current screen in Egyptian Arabic;
- automatically scroll to and highlight the item it is discussing;
- safely open a recommended building/floor during the guided tour;
- compare exact units and explain trade-offs;
- listen hands-free with microphone VAD and barge-in, so the buyer can interrupt it while it speaks;
- fall back to a deterministic in-browser Egyptian intent engine if the local model service is unavailable.

It **never** silently locks a unit, confirms payment, signs a contract, overrides price or changes queue priority. Those remain explicit buyer/authorized-role decisions.

## 1. Prerequisites

Install Python 3.11/3.12, `ffmpeg`, Git and, for the full-quality profile, an NVIDIA CUDA environment.

```bash
python -m venv .venv
source .venv/bin/activate            # Linux/macOS
# .venv\Scripts\Activate.ps1         # Windows PowerShell
python -m pip install --upgrade pip
```

Install the PyTorch build appropriate for your GPU/OS first, then:

```bash
pip install -r local_voice_agent/requirements.txt
```

## 2. Enable the primary Arabic ASR

The Cohere Arabic ASR repo is downloadable from Hugging Face but requires accepting its access conditions once.

1. Open `CohereLabs/cohere-transcribe-arabic-07-2026` on Hugging Face and accept the conditions.
2. Authenticate locally:

```bash
hf auth login
```

If this is not done, PRENEURA automatically tries the public Faster-Whisper Arabic fallback.

## 3. Start the local Qwen agent brain

### Best-quality profile

With vLLM installed in its own environment/process:

```bash
vllm serve Qwen/Qwen3-30B-A3B-Instruct-2507 \
  --host 127.0.0.1 \
  --port 8000 \
  --api-key local
```

The voice service calls `http://127.0.0.1:8000/v1/chat/completions`.

### Smaller-machine profile

Run a smaller multilingual Qwen model in any OpenAI-compatible local runner and set:

```bash
export PRENEURA_LLM_MODEL="your-local-model-name"
export PRENEURA_LLM_BASE_URL="http://127.0.0.1:8000/v1"
```

The browser's deterministic unit ranking and safety boundary still work when the LLM server is offline.

## 4. Start the voice service

Optional configuration:

```bash
cp local_voice_agent/.env.example .env
```

Then:

```bash
uvicorn local_voice_agent.server:app --host 127.0.0.1 --port 8765
```

Health check:

```bash
curl http://127.0.0.1:8765/health
```

The web app probes `http://127.0.0.1:8765`. When found, the advisor badge changes to **LOCAL AI • متصل**.

## Browser behavior

For microphone capture, use `http://localhost`, `http://127.0.0.1` or HTTPS. The browser requests microphone permission. Audio autoplay policies may require an initial buyer click; the allocation navigation wrapper primes Web Audio during the user's allocation navigation click so the greeting can start as early as the browser permits.

GitHub Pages cannot host GPU models. The published demo connects to this service when the visitor runs it locally. Without it, the UI remains functional through deterministic/browser fallbacks.

## API / WebSocket

- `GET /health`
- `POST /v1/agent`
- `POST /v1/transcribe`
- `POST /v1/tts`
- `WS /ws/voice`

The WebSocket accepts `text`, `audio` and `tts` turns. VoiceTut audio is returned as streaming Float32 PCM chunks so playback can begin before the full response is synthesized.

## Safety boundary

Every model-produced action is sanitized. Allowed actions are navigation, scrolling/highlighting, focusing an inventory unit, showing recommendations and requesting that the UI expose the lock-confirmation control. The LLM cannot turn a recommendation into an authoritative unit lock, payment confirmation, legal signature, price override or queue override.
