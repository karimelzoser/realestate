#!/usr/bin/env python3
"""PRENEURA local Egyptian Arabic live voice agent.

Default local stack:
- ASR: CohereLabs/cohere-transcribe-arabic-07-2026
- LLM: Qwen/Qwen3-30B-A3B-Instruct-2507 via a local OpenAI-compatible server
- TTS: mohammedaly22/VoiceTut-TTS, default speaker Omnia

PRENEURA remains authoritative for queue, inventory, unit locks, payment and
contract state. This service can only recommend, explain, navigate and highlight.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import soundfile as sf
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

load_dotenv()
APP_NAME = "PRENEURA Local Egyptian Voice Agent"
ASR_MODEL = os.getenv("PRENEURA_ASR_MODEL", "CohereLabs/cohere-transcribe-arabic-07-2026")
ASR_BACKEND = os.getenv("PRENEURA_ASR_BACKEND", "cohere").lower()
ASR_FALLBACK_MODEL = os.getenv("PRENEURA_ASR_FALLBACK_MODEL", "dev-ahmedhany/whisper-large-v3-turbo-arabic-ft-ct2-int8")
TTS_MODEL = os.getenv("PRENEURA_TTS_MODEL", "mohammedaly22/VoiceTut-TTS")
TTS_SPEAKER = os.getenv("PRENEURA_TTS_SPEAKER", "Omnia")
LLM_MODEL = os.getenv("PRENEURA_LLM_MODEL", "Qwen/Qwen3-30B-A3B-Instruct-2507")
LLM_BASE_URL = os.getenv("PRENEURA_LLM_BASE_URL", "http://127.0.0.1:8000/v1").rstrip("/")
LLM_API_KEY = os.getenv("PRENEURA_LLM_API_KEY", "local")
PORT = int(os.getenv("PRENEURA_VOICE_PORT", "8765"))

SAFE_PAGES = {"b-allocation-day", "b-queue", "b-site", "b-building", "b-floor", "b-unit", "b-paymentdocs", "b-contract", "b-properties"}
SAFE_ACTIONS = {"navigate", "highlight_keywords", "focus_unit", "show_recommendations", "scroll_to", "request_lock_confirmation"}
IRREVERSIBLE_ACTION_WORDS = re.compile(r"lock|reserve|book|payment_confirm|confirm_payment|sign_contract|final_signature|price_override|queue_override", re.I)

app = FastAPI(title=APP_NAME, version="6.3.0")
origins = [x.strip() for x in os.getenv("PRENEURA_CORS_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins or ["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])

_asr: Any = None
_asr_processor: Any = None
_asr_backend_loaded: str | None = None
_tts: Any = None
_model_lock = asyncio.Lock()


class AgentRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    context: dict[str, Any] = Field(default_factory=dict)


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    speaker: str = TTS_SPEAKER
    language: str = "ar-EG"


SYSTEM_PROMPT = r"""
أنت مساعد التخصيص الصوتي المحلي داخل PRENEURA Real Estate OS.

اتكلم عربي مصري طبيعي، راقي، هادي وواضح. الجمل قصيرة عشان المحادثة تبقى live.
ساعد العميل ياخد قرار واعي من غير ما تاخد القرار مكانه. code-switching طبيعي مسموح.

أثناء Online Allocation:
1) امشي مع العميل: Master Plan → Building → Floor → Exact Unit.
2) اعتمد فقط على available_units وbuyer context المرسل. ممنوع اختراع وحدة أو سعر أو مساحة.
3) رشح أفضل 2-3 اختيارات بأسباب مرتبطة بالميزانية/المساحة/الغرف/الدور/الإطلالة/eligibility.
4) استخدم actions عشان الواجهة تنتقل أو تعمل scroll/highlight للجزء اللي بتتكلم عنه.
5) قارن مزايا وtrade-offs بين الوحدات المتاحة.
6) ممنوع تعمل unit lock أو دفع أو توقيع بنفسك. عند الحجز اطلب request_lock_confirmation فقط.

actions المسموحة فقط:
- {"type":"navigate","page":"b-site|b-building|b-floor|b-unit|b-queue|b-paymentdocs|b-contract|b-properties|b-allocation-day"}
- {"type":"highlight_keywords","keywords":["..."]}
- {"type":"focus_unit","unit_id":"ID موجود حرفياً في available_units"}
- {"type":"show_recommendations","mode":"balanced|price|area|floor"}
- {"type":"scroll_to","keywords":["..."]}
- {"type":"request_lock_confirmation","unit_id":"optional existing ID"}

أرجع JSON فقط من غير markdown:
{"reply_ar":"الكلام اللي هيتقال للعميل بالمصري","actions":[],"decision_note":"سبب مختصر للترشيح"}
""".strip()


def _extract_json(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I | re.S).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _unit_ids(context: dict[str, Any]) -> set[str]:
    return {str(u.get("id")) for u in context.get("available_units", []) if isinstance(u, dict) and u.get("id") is not None}


def _sanitize_actions(actions: Any, context: dict[str, Any]) -> list[dict[str, Any]]:
    clean: list[dict[str, Any]] = []
    allowed_ids = _unit_ids(context)
    if not isinstance(actions, list):
        return clean
    for raw in actions[:8]:
        if not isinstance(raw, dict):
            continue
        typ = str(raw.get("type", "")).strip().lower()
        if typ not in SAFE_ACTIONS or IRREVERSIBLE_ACTION_WORDS.search(typ):
            continue
        if typ == "navigate":
            page = str(raw.get("page", ""))
            if page in SAFE_PAGES:
                clean.append({"type": typ, "page": page})
        elif typ in {"highlight_keywords", "scroll_to"}:
            words = [str(x)[:80] for x in raw.get("keywords", []) if str(x).strip()][:6]
            if words:
                clean.append({"type": typ, "keywords": words})
        elif typ == "focus_unit":
            uid = str(raw.get("unit_id", ""))
            if uid in allowed_ids:
                clean.append({"type": typ, "unit_id": uid})
        elif typ == "show_recommendations":
            mode = str(raw.get("mode", "balanced"))
            if mode not in {"balanced", "price", "area", "floor"}:
                mode = "balanced"
            clean.append({"type": typ, "mode": mode})
        elif typ == "request_lock_confirmation":
            uid = str(raw.get("unit_id", ""))
            item: dict[str, Any] = {"type": typ}
            if uid and uid in allowed_ids:
                item["unit_id"] = uid
            clean.append(item)
    return clean


def _fallback_agent(message: str, context: dict[str, Any]) -> dict[str, Any]:
    units = context.get("available_units", []) or []
    page = context.get("page")
    lower = message.lower()
    if any(k in lower for k in ["ماستر", "master", "مخطط"]):
        return {"reply_ar": "تمام، هفتحلك الماستر بلان ونبدأ نراجع المتاح المناسب ليك.", "actions": [{"type": "navigate", "page": "b-site"}]}
    if any(k in lower for k in ["وحدة", "شقة", "رشح", "أفضل", "افضل", "recommend", "best"]):
        if units:
            top = units[0]
            desc = " • ".join(str(x) for x in [top.get("label"), top.get("building"), top.get("area") and f"{top['area']} م²"] if x)
            actions: list[dict[str, Any]] = [{"type": "show_recommendations", "mode": "balanced"}]
            actions.append({"type": "navigate", "page": "b-unit"} if page != "b-unit" else {"type": "focus_unit", "unit_id": str(top.get("id"))})
            return {"reply_ar": f"أقوى اختيار ظاهر لملفك دلوقتي هو {desc}. هعرضلك أفضل البدائل وأظلللك الاختيار الأول عشان تراجع تفاصيله بنفسك.", "actions": actions}
        return {"reply_ar": "هفتحلك الوحدات الفعلية الأول، وبعدها أرتبلك المتاح حسب ملفك من غير ما أخترع أي بيانات.", "actions": [{"type": "navigate", "page": "b-unit"}]}
    if any(k in lower for k in ["احجز", "حجز", "lock", "reserve"]):
        return {"reply_ar": "هظلللك خطوة الحجز، لكن قفل الوحدة النهائي لازم تأكده إنت بنفسك بعد مراجعة السعر والوحدة.", "actions": [{"type": "request_lock_confirmation"}]}
    return {"reply_ar": "أنا معاك في التخصيص خطوة بخطوة. أقدر أفتح الماستر بلان، أقرأ المتاح، أرشحلك الأنسب وأقارن السعر والمساحة والدور، مع بقاء قرار الحجز النهائي ليك.", "actions": []}


async def run_agent(message: str, context: dict[str, Any]) -> dict[str, Any]:
    payload_context = json.dumps(context, ensure_ascii=False, separators=(",", ":"))[:24000]
    body = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"CURRENT_PRENEURA_CONTEXT={payload_context}\nUSER_SAID={message}"},
        ],
        "temperature": 0.25,
        "top_p": 0.85,
        "max_tokens": 500,
    }
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            res = await client.post(f"{LLM_BASE_URL}/chat/completions", headers={"Authorization": f"Bearer {LLM_API_KEY}"}, json=body)
            res.raise_for_status()
            content = res.json()["choices"][0]["message"]["content"]
        data = _extract_json(content)
        reply = str(data.get("reply_ar") or data.get("reply") or "").strip()
        if not reply:
            raise ValueError("LLM returned no reply")
        return {"reply_ar": reply[:2500], "actions": _sanitize_actions(data.get("actions"), context), "decision_note": str(data.get("decision_note", ""))[:600], "model": LLM_MODEL}
    except Exception as exc:
        print(f"[voice-agent] local LLM fallback: {exc}")
        data = _fallback_agent(message, context)
        data["actions"] = _sanitize_actions(data.get("actions"), context)
        data["model"] = "deterministic-local-fallback"
        return data


def _ffmpeg_to_wav(source: Path) -> Path:
    target = source.with_suffix(".wav")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        if source.suffix.lower() == ".wav":
            return source
        raise RuntimeError("ffmpeg is required to decode browser WebM/Opus audio")
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(source), "-ac", "1", "-ar", "16000", str(target)], check=True)
    return target


async def _load_asr() -> tuple[Any, Any, str]:
    global _asr, _asr_processor, _asr_backend_loaded
    if _asr is not None:
        return _asr, _asr_processor, _asr_backend_loaded or ASR_BACKEND
    async with _model_lock:
        if _asr is not None:
            return _asr, _asr_processor, _asr_backend_loaded or ASR_BACKEND
        if ASR_BACKEND == "cohere":
            try:
                import torch
                from transformers import AutoProcessor, CohereAsrForConditionalGeneration

                _asr_processor = AutoProcessor.from_pretrained(ASR_MODEL)
                dtype = torch.float16 if torch.cuda.is_available() else torch.float32
                _asr = CohereAsrForConditionalGeneration.from_pretrained(ASR_MODEL, device_map="auto", torch_dtype=dtype)
                _asr_backend_loaded = "cohere"
                return _asr, _asr_processor, _asr_backend_loaded
            except Exception as exc:
                print(f"[voice-agent] primary Cohere ASR unavailable, switching to Faster-Whisper: {exc}")
        from faster_whisper import WhisperModel
        try:
            import torch
            use_cuda = torch.cuda.is_available()
        except Exception:
            use_cuda = bool(os.getenv("CUDA_VISIBLE_DEVICES", "") not in {"", "-1"})
        _asr = WhisperModel(ASR_FALLBACK_MODEL, device="cuda" if use_cuda else "cpu", compute_type="float16" if use_cuda else "int8")
        _asr_processor = None
        _asr_backend_loaded = "faster-whisper"
        return _asr, _asr_processor, _asr_backend_loaded


async def transcribe_file(path: Path, language: str = "ar") -> str:
    model, processor, backend = await _load_asr()
    wav = _ffmpeg_to_wav(path)
    if backend == "cohere":
        import torch
        from transformers.audio_utils import load_audio
        lang = "ar" if language.startswith("ar") else "en"
        audio = load_audio(str(wav), sampling_rate=16000)
        inputs = processor(audio, sampling_rate=16000, return_tensors="pt", language=lang)
        chunk_index = inputs.get("audio_chunk_index")
        inputs.to(model.device, dtype=model.dtype)
        with torch.inference_mode():
            outputs = model.generate(**inputs, max_new_tokens=256)
        try:
            decoded = processor.decode(outputs, skip_special_tokens=True, audio_chunk_index=chunk_index, language=lang) if chunk_index is not None else processor.decode(outputs, skip_special_tokens=True)
        except TypeError:
            decoded = processor.decode(outputs, skip_special_tokens=True)
        if isinstance(decoded, list):
            return " ".join(str(x) for x in decoded).strip()
        return str(decoded).strip()
    segments, _ = model.transcribe(str(wav), language="ar", beam_size=1, vad_filter=True)
    return " ".join(s.text.strip() for s in segments if s.text.strip()).strip()


async def _load_tts() -> Any:
    global _tts
    if _tts is not None:
        return _tts
    async with _model_lock:
        if _tts is None:
            from voicetut_tts import VoiceTutTTS
            _tts = VoiceTutTTS.from_pretrained(TTS_MODEL)
    return _tts


async def synthesize_wav(text: str, speaker: str) -> bytes:
    tts = await _load_tts()
    with tempfile.TemporaryDirectory(prefix="preneura-tts-") as td:
        out = Path(td) / "speech.wav"
        await asyncio.to_thread(tts.synthesize, text, speaker=speaker or TTS_SPEAKER, speed=0.98, output=str(out))
        return out.read_bytes()


async def stream_tts(websocket: WebSocket, text: str, speaker: str) -> None:
    tts = await _load_tts()
    queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=3)
    loop = asyncio.get_running_loop()

    def producer() -> None:
        try:
            for sr, chunk in tts.stream(text, speaker=speaker or TTS_SPEAKER, speed=0.98):
                fut = asyncio.run_coroutine_threadsafe(queue.put((int(sr), np.asarray(chunk, dtype=np.float32).squeeze())), loop)
                fut.result()
        except Exception as exc:
            asyncio.run_coroutine_threadsafe(queue.put(("error", exc)), loop).result()
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(None), loop).result()

    task = asyncio.create_task(asyncio.to_thread(producer))
    streamed = False
    while True:
        item = await queue.get()
        if item is None:
            break
        if item[0] == "error":
            print(f"[voice-agent] VoiceTut stream fallback: {item[1]}")
            break
        sr, arr = item
        streamed = True
        payload = base64.b64encode(arr.astype("<f4", copy=False).tobytes()).decode("ascii")
        await websocket.send_json({"type": "audio_chunk", "sample_rate": sr, "pcm_f32_b64": payload})
    await task
    if not streamed:
        wav = await synthesize_wav(text, speaker)
        audio, sr = sf.read(io.BytesIO(wav), dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        step = max(int(sr * 0.55), 1)
        for start in range(0, len(audio), step):
            arr = np.asarray(audio[start : start + step], dtype="<f4")
            await websocket.send_json({"type": "audio_chunk", "sample_rate": int(sr), "pcm_f32_b64": base64.b64encode(arr.tobytes()).decode("ascii")})
    await websocket.send_json({"type": "audio_end"})


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True, "service": APP_NAME, "version": "6.3.0",
        "models": {"asr": ASR_MODEL, "asr_fallback": ASR_FALLBACK_MODEL, "llm": LLM_MODEL, "tts": TTS_MODEL, "speaker": TTS_SPEAKER},
        "loaded": {"asr": _asr is not None, "tts": _tts is not None},
        "policy": "recommend/navigation/highlight only; exact-unit lock, payment and legal signature require human confirmation",
    }


@app.post("/v1/agent")
async def agent(req: AgentRequest) -> dict[str, Any]:
    return await run_agent(req.message, req.context)


@app.post("/v1/transcribe")
async def transcribe(file: UploadFile = File(...), language: str = Form("ar")) -> dict[str, Any]:
    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    with tempfile.TemporaryDirectory(prefix="preneura-asr-") as td:
        src = Path(td) / f"input{suffix}"
        src.write_bytes(await file.read())
        if src.stat().st_size < 200:
            raise HTTPException(status_code=400, detail="Audio payload is empty")
        text = await transcribe_file(src, language)
    return {"text": text, "language": language, "model": _asr_backend_loaded or ASR_BACKEND}


@app.post("/v1/tts")
async def tts(req: TTSRequest) -> Response:
    wav = await synthesize_wav(req.text, req.speaker)
    return Response(content=wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.websocket("/ws/voice")
async def voice_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            msg = await websocket.receive_json()
            typ = str(msg.get("type", ""))
            context = msg.get("context") if isinstance(msg.get("context"), dict) else {}
            speaker = str(msg.get("speaker") or TTS_SPEAKER)
            if typ == "tts":
                text = str(msg.get("text") or "").strip()
                if text:
                    await websocket.send_json({"type": "status", "state": "speaking"})
                    await stream_tts(websocket, text, speaker)
                continue
            if typ == "text":
                text = str(msg.get("text") or "").strip()
                if not text:
                    continue
            elif typ == "audio":
                await websocket.send_json({"type": "status", "state": "transcribing"})
                encoded = str(msg.get("audio_b64") or "")
                if not encoded:
                    await websocket.send_json({"type": "error", "message": "missing audio"})
                    continue
                mime = str(msg.get("mime_type") or "audio/webm")
                ext = ".ogg" if "ogg" in mime else ".wav" if "wav" in mime else ".webm"
                try:
                    raw = base64.b64decode(encoded, validate=True)
                except Exception:
                    await websocket.send_json({"type": "error", "message": "invalid audio encoding"})
                    continue
                with tempfile.TemporaryDirectory(prefix="preneura-turn-") as td:
                    src = Path(td) / f"turn{ext}"
                    src.write_bytes(raw)
                    text = await transcribe_file(src, "ar")
                await websocket.send_json({"type": "transcript", "text": text})
                if not text:
                    await websocket.send_json({"type": "audio_end"})
                    continue
            else:
                continue

            await websocket.send_json({"type": "status", "state": "thinking"})
            result = await run_agent(text, context)
            await websocket.send_json({"type": "agent", "reply_ar": result["reply_ar"], "actions": result.get("actions", []), "model": result.get("model"), "audio_follows": True})
            await stream_tts(websocket, result["reply_ar"], speaker)
    except WebSocketDisconnect:
        return
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "message": str(exc)[:300]})
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=PORT, reload=False)
