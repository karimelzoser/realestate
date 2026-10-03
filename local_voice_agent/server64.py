#!/usr/bin/env python3
"""PRENEURA 6.4 local Egyptian live allocation agent.

Quality-first local stack:
- Arabic/Egyptian ASR: reuses the validated 6.3 Cohere/Faster-Whisper pipeline.
- Agent brain: local Qwen3 OpenAI-compatible endpoint.
- TTS: Egyptian fine-tuned Qwen3-TTS custom voice (`egyptian_speaker`).

PRENEURA remains authoritative for queue, inventory, exact-unit locks, payment,
contract and audit truth. The model can explain, rank, navigate, scroll and
highlight only. Irreversible actions remain human-confirmed.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import re
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

from local_voice_agent import server as legacy

load_dotenv()

APP_NAME = "PRENEURA Egyptian Live Allocation Agent"
VERSION = "6.4.0"
LLM_MODEL = os.getenv("PRENEURA_LLM_MODEL", "Qwen/Qwen3-30B-A3B-Instruct-2507")
LLM_BASE_URL = os.getenv("PRENEURA_LLM_BASE_URL", "http://127.0.0.1:8000/v1").rstrip("/")
LLM_API_KEY = os.getenv("PRENEURA_LLM_API_KEY", "local")
TTS_MODEL = os.getenv("PRENEURA_TTS_MODEL", "itshamdi404/Egy_Arabic_Qwen3-TTS-12Hz-1.7B-Base")
TTS_SPEAKER = os.getenv("PRENEURA_TTS_SPEAKER", "egyptian_speaker")
TTS_TEMPERATURE = float(os.getenv("PRENEURA_TTS_TEMPERATURE", "0.72"))
TTS_TOP_P = float(os.getenv("PRENEURA_TTS_TOP_P", "0.88"))
PORT = int(os.getenv("PRENEURA_VOICE_PORT", "8765"))

SAFE_PAGES = legacy.SAFE_PAGES
SAFE_ACTIONS = legacy.SAFE_ACTIONS

app = FastAPI(title=APP_NAME, version=VERSION)
origins = [x.strip() for x in os.getenv("PRENEURA_CORS_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins or ["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])

_tts: Any = None
_tts_lock = asyncio.Lock()


class AgentRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    context: dict[str, Any] = Field(default_factory=dict)


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    speaker: str = TTS_SPEAKER
    language: str = "ar-EG"


SYSTEM_PROMPT = r"""
إنت مساعد التخصيص الصوتي في PRENEURA لشركة تطوير عقاري مصرية.

أسلوبك:
- اتكلم مصري قاهري طبيعي وراقي وهادي، زي مستشار مبيعات محترف واقف جنب العميل، مش مذيع ومش فصحى رسمية.
- خاطب العميل باحترام باستخدام «حضرتك» عند اللزوم، لكن ما تكررهاش في كل جملة.
- استخدم جمل قصيرة وسلسة عشان المحادثة تبقى Live: «تمام»، «بص معايا هنا»، «خليني أوريك»، «دي أنسب نقطة نبدأ منها»، «لو تحب أقارنهم لك».
- تجنب تعبيرات فصحى جامدة زي: «يرجى الاختيار»، «سوف نقوم»، «يتعين عليك». استخدم بدلها مصري طبيعي: «اختار»، «هنعمل»، «محتاجين».
- ما تبقاش عامي زيادة أو مبتذل. ممنوع «يا صاحبي» و«يا باشا» إلا لو العميل نفسه استخدمها بوضوح.
- أسماء المشروع والوحدات والمصطلحات الفنية الإنجليزي ممكن تتقال code-switching طبيعي.
- ما تقولش كل التفاصيل مرة واحدة. اشرح الحاجة اللي على الشاشة دلوقتي وبعدين خد الخطوة اللي بعدها.

هدفك في Online Allocation:
1) رحّب مرة واحدة، ووضح إنك هتساعد من غير ما تاخد قرار الحجز مكان العميل.
2) امشِ بالعميل بشكل طبيعي: Allocation Day → Master Plan → Building → Floor → Exact Unit.
3) اعتمد فقط على buyer وavailable_units وvisible_controls في CURRENT_PRENEURA_CONTEXT. ممنوع اختراع وحدة أو سعر أو مساحة أو availability.
4) رشّح بحد أقصى 3 وحدات. اشرح سبب كل ترشيح حسب الميزانية، الغرف، المساحة، الدور، الإطلالة، المبنى والـeligibility.
5) وقت ما تتكلم عن حاجة، ابعت action يعمل scroll/highlight ليها. لو الخطوة آمنة وقابلة للرجوع، ينفع تفتح الصفحة المناسبة.
6) لو العميل محتار، قارن trade-offs بشكل عملي: السعر مقابل المساحة/الدور/الإطلالة، وقل بوضوح إن الاختيار في الآخر للعميل.
7) لو العميل قال «احجز» أو «خلاص دي»، ما تعملش lock. استخدم request_lock_confirmation وخليه يراجع ويأكد بنفسه.
8) ممنوع تأكيد دفع، توقيع عقد، override سعر أو تغيير أولوية الدور.

Actions المسموحة فقط:
- {"type":"navigate","page":"b-site|b-building|b-floor|b-unit|b-queue|b-paymentdocs|b-contract|b-properties|b-allocation-day"}
- {"type":"highlight_keywords","keywords":["..."]}
- {"type":"focus_unit","unit_id":"ID موجود حرفياً في available_units"}
- {"type":"show_recommendations","mode":"balanced|price|area|floor"}
- {"type":"scroll_to","keywords":["..."]}
- {"type":"request_lock_confirmation","unit_id":"optional existing ID"}

أرجع JSON فقط:
{"reply_ar":"رد مصري طبيعي قصير مناسب للصوت","actions":[],"decision_note":"سبب داخلي مختصر للترشيح"}
""".strip()


def _extract_json(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I | re.S).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        a, b = text.find("{"), text.rfind("}")
        if a >= 0 and b > a:
            return json.loads(text[a : b + 1])
        raise


def _fallback_agent(message: str, context: dict[str, Any]) -> dict[str, Any]:
    q = (message or "").lower()
    units = context.get("available_units", []) or []
    page = str(context.get("page") or "")
    if any(x in q for x in ["ماستر", "مخطط", "master plan", "site plan"]):
        return {"reply_ar": "تمام، خليني أفتح الماستر بلان ونبص سوا على الأماكن اللي فيها وحدات مناسبة لملف حضرتك.", "actions": [{"type": "navigate", "page": "b-site"}]}
    if any(x in q for x in ["ارخص", "أرخص", "سعر", "ميزانية", "price", "budget"]):
        return {"reply_ar": "تمام. هرتب المتاح حسب السعر، بس هفضل مراعِي المساحة والغرف والـeligibility عشان الأرخص ما يبقاش اختيار أضعف لحضرتك.", "actions": [{"type": "show_recommendations", "mode": "price"}, {"type": "navigate", "page": "b-unit"}]}
    if any(x in q for x in ["وحدة", "شقة", "رشح", "افضل", "أفضل", "أنسب", "recommend", "best"]):
        if units:
            u = units[0]
            bits = [str(u.get("label") or u.get("id") or "الوحدة")]
            if u.get("area") is not None:
                bits.append(f"{u['area']} متر")
            if u.get("floor") not in (None, ""):
                bits.append(f"الدور {u['floor']}")
            uid = str(u.get("id"))
            return {"reply_ar": "بص معايا على الاختيار الأول. " + "، ".join(bits) + ". هظللها لحضرتك، وبعدها لو تحب نقارنها بالبديل اللي بعدها.", "actions": [{"type": "show_recommendations", "mode": "balanced"}, {"type": "focus_unit", "unit_id": uid}]}
        return {"reply_ar": "خليني أفتح الوحدات الفعلية الأول. أول ما البيانات تظهر هرتب المتاح الحقيقي وأشرح لحضرتك أفضل البدائل.", "actions": [{"type": "navigate", "page": "b-unit"}]}
    if any(x in q for x in ["احجز", "حجز", "خلاص دي", "lock", "reserve"]):
        return {"reply_ar": "تمام. هوقف عند خطوة التأكيد عشان حضرتك تراجع الوحدة والسعر مرة أخيرة. قفل الوحدة النهائي لازم يتم بتأكيدك إنت.", "actions": [{"type": "request_lock_confirmation"}]}
    if page == "b-site":
        return {"reply_ar": "إحنا دلوقتي على الماستر بلان. هركز مع حضرتك على المباني اللي فيها اختيارات مناسبة، ونفتح أقواهم واحدة واحدة.", "actions": [{"type": "highlight_keywords", "keywords": ["building", "مبنى", "عمارة"]}]}
    return {"reply_ar": "أنا مع حضرتك خطوة بخطوة. أقدر أوريك الماستر بلان، أرتب الوحدات المناسبة، وأقارن السعر والمساحة والدور والإطلالة. تحب نبدأ بالأنسب ولا بالأقل سعر؟", "actions": []}


async def run_agent(message: str, context: dict[str, Any]) -> dict[str, Any]:
    payload_context = json.dumps(context, ensure_ascii=False, separators=(",", ":"))[:28000]
    body = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"CURRENT_PRENEURA_CONTEXT={payload_context}\nUSER_SAID={message}"},
        ],
        "temperature": 0.35,
        "top_p": 0.9,
        "max_tokens": 600,
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(f"{LLM_BASE_URL}/chat/completions", headers={"Authorization": f"Bearer {LLM_API_KEY}"}, json=body)
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"]
        data = _extract_json(content)
        reply = str(data.get("reply_ar") or data.get("reply") or "").strip()
        if not reply:
            raise ValueError("LLM returned no reply")
        return {
            "reply_ar": reply[:2200],
            "actions": legacy._sanitize_actions(data.get("actions"), context),
            "decision_note": str(data.get("decision_note", ""))[:600],
            "model": LLM_MODEL,
        }
    except Exception as exc:
        print(f"[voice64] local LLM fallback: {exc}")
        data = _fallback_agent(message, context)
        data["actions"] = legacy._sanitize_actions(data.get("actions"), context)
        data["model"] = "deterministic-egyptian-fallback"
        return data


def _speech_chunks(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", (text or "").strip())
    if not text:
        return []
    parts = [x.strip() for x in re.split(r"(?<=[.!؟؛])\s+|(?<=،)\s+", text) if x.strip()]
    out: list[str] = []
    buf = ""
    for p in parts:
        candidate = (buf + " " + p).strip()
        if len(candidate) < 55:
            buf = candidate
            continue
        if len(candidate) > 180 and buf:
            out.append(buf)
            buf = p
        else:
            out.append(candidate)
            buf = ""
    if buf:
        out.append(buf)
    return out or [text]


async def _load_tts() -> Any:
    global _tts
    if _tts is not None:
        return _tts
    async with _tts_lock:
        if _tts is not None:
            return _tts
        import torch
        from qwen_tts import Qwen3TTSModel

        use_cuda = torch.cuda.is_available()
        dtype = torch.bfloat16 if use_cuda and torch.cuda.is_bf16_supported() else torch.float16 if use_cuda else torch.float32
        device_map: Any = {"": 0} if use_cuda else "cpu"
        _tts = Qwen3TTSModel.from_pretrained(TTS_MODEL, device_map=device_map, torch_dtype=dtype)
    return _tts


def _generate_sync(text: str, speaker: str) -> tuple[np.ndarray, int]:
    tts = _tts
    wavs, sr = tts.generate_custom_voice(
        text=text,
        speaker=speaker or TTS_SPEAKER,
        language="auto",
        temperature=TTS_TEMPERATURE,
        top_p=TTS_TOP_P,
    )
    arr = np.asarray(wavs[0], dtype=np.float32).squeeze()
    if arr.ndim > 1:
        arr = arr.mean(axis=-1)
    return arr, int(sr)


async def synthesize(text: str, speaker: str) -> tuple[np.ndarray, int]:
    await _load_tts()
    chunks = _speech_chunks(text)
    audio: list[np.ndarray] = []
    sr = 24000
    for chunk in chunks:
        arr, sr = await asyncio.to_thread(_generate_sync, chunk, speaker)
        audio.append(arr)
        audio.append(np.zeros(max(int(sr * 0.07), 1), dtype=np.float32))
    return (np.concatenate(audio) if audio else np.zeros(1, dtype=np.float32)), sr


async def stream_tts(websocket: WebSocket, text: str, speaker: str) -> None:
    await _load_tts()
    for chunk in _speech_chunks(text):
        arr, sr = await asyncio.to_thread(_generate_sync, chunk, speaker)
        step = max(int(sr * 0.34), 1)
        for start in range(0, len(arr), step):
            pcm = np.asarray(arr[start : start + step], dtype="<f4")
            await websocket.send_json({
                "type": "audio_chunk",
                "sample_rate": sr,
                "pcm_f32_b64": base64.b64encode(pcm.tobytes()).decode("ascii"),
            })
            await asyncio.sleep(0)
    await websocket.send_json({"type": "audio_end"})


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": APP_NAME,
        "version": VERSION,
        "models": {
            "asr": legacy.ASR_MODEL,
            "asr_fallback": legacy.ASR_FALLBACK_MODEL,
            "llm": LLM_MODEL,
            "tts": TTS_MODEL,
            "speaker": TTS_SPEAKER,
        },
        "loaded": {"asr": legacy._asr is not None, "tts": _tts is not None},
        "dialect": "Egyptian Arabic / ar-EG",
        "policy": "safe guidance only; locks, payment confirmation, signatures, price and queue authority remain in PRENEURA",
    }


@app.post("/v1/agent")
async def agent(req: AgentRequest) -> dict[str, Any]:
    return await run_agent(req.message, req.context)


@app.post("/v1/transcribe")
async def transcribe(file: UploadFile = File(...), language: str = Form("ar")) -> dict[str, Any]:
    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    with tempfile.TemporaryDirectory(prefix="preneura64-asr-") as td:
        src = Path(td) / f"input{suffix}"
        src.write_bytes(await file.read())
        if src.stat().st_size < 200:
            raise HTTPException(status_code=400, detail="Audio payload is empty")
        text = await legacy.transcribe_file(src, language)
    return {"text": text, "language": language, "model": legacy._asr_backend_loaded or legacy.ASR_BACKEND}


@app.post("/v1/tts")
async def tts(req: TTSRequest) -> Response:
    arr, sr = await synthesize(req.text, req.speaker)
    buf = io.BytesIO()
    sf.write(buf, arr, sr, format="WAV", subtype="PCM_16")
    return Response(content=buf.getvalue(), media_type="audio/wav", headers={"Cache-Control": "no-store"})


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
                with tempfile.TemporaryDirectory(prefix="preneura64-turn-") as td:
                    src = Path(td) / f"turn{ext}"
                    src.write_bytes(raw)
                    text = await legacy.transcribe_file(src, "ar")
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
    uvicorn.run("local_voice_agent.server64:app", host="127.0.0.1", port=PORT, reload=False)
