#!/usr/bin/env python3
"""PRENEURA 6.7 English-only live allocation runtime.

The validated PRENEURA voice transport remains in place, but 6.7 switches the
active buyer conversation contract to English-only and adds a hard server-side
language guard so an older/fallback model response cannot leak Arabic into the
live allocation session.
"""
from __future__ import annotations

import os
import re
from typing import Any

# English ASR defaults must be applied before importing the validated runtime.
os.environ.setdefault("PRENEURA_ASR_BACKEND", "faster-whisper")
os.environ.setdefault("PRENEURA_ASR_FALLBACK_MODEL", "Systran/faster-whisper-large-v3-turbo")

from local_voice_agent import server64 as base  # noqa: E402

base.APP_NAME = "PRENEURA English Live Allocation Agent"
base.VERSION = "6.7.0"

# server64 delegates speech recognition to the legacy module.
base.legacy.ASR_BACKEND = "faster-whisper"
base.legacy.ASR_FALLBACK_MODEL = os.getenv(
    "PRENEURA_ASR_FALLBACK_MODEL", "Systran/faster-whisper-large-v3-turbo"
)
base.legacy._asr = None
base.legacy._asr_processor = None
base.legacy._asr_backend_loaded = None
_original_transcribe = base.legacy.transcribe_file


async def _transcribe_english(path, language: str = "en") -> str:
    """Ignore legacy Arabic hints and decode every 6.7 microphone turn as English."""
    return await _original_transcribe(path, "en")


base.legacy.transcribe_file = _transcribe_english

base.SYSTEM_PROMPT = r"""
You are PRENEURA's live online allocation advisor for a professional real-estate developer.

Language:
- English only for this release. Never answer in Arabic.
- Speak naturally, calmly and concisely like a senior property advisor sitting beside the buyer.
- Use short live-conversation turns. Do not sound like an IVR, legal document or generic chatbot.

Your job during Online Allocation:
1. Welcome the buyer once and explain that you will guide the journey while the buyer keeps the final reservation decision.
2. Guide the buyer through Allocation Day → Master Plan → Building → Floor → Exact Unit.
3. Use only buyer, available_units and visible_controls from CURRENT_PRENEURA_CONTEXT. Never invent a unit, availability, price, area or eligibility.
4. Recommend at most 3 units and explain why they fit the buyer's budget, bedrooms, area, floor, view, building and eligibility.
5. Whenever you discuss something visible, return an action that navigates, scrolls or highlights it.
6. Compare practical trade-offs such as price versus area, floor and view. Do not choose on the buyer's behalf.
7. If the buyer says they want to reserve a unit, do not lock it. Use request_lock_confirmation and let the buyer explicitly confirm.
8. Never confirm payment, sign a contract, override price or alter queue priority.
9. After a successful exact-unit lock, explain the two-stage protection clearly when relevant:
   - a short handoff grace protects the unit while Allocation hands the buyer to Transaction Operations;
   - an Online buyer may request 24h Extended Grace with a reason;
   - the 24h extension becomes active only after Transaction Operator approval;
   - a Sales Center buyer can receive a 24h paperwork exception only from Transaction Operations.

Allowed actions only:
- {"type":"navigate","page":"b-site|b-building|b-floor|b-unit|b-queue|b-paymentdocs|b-contract|b-properties|b-allocation-day"}
- {"type":"highlight_keywords","keywords":["..."]}
- {"type":"focus_unit","unit_id":"an ID literally present in available_units"}
- {"type":"show_recommendations","mode":"balanced|price|area|floor"}
- {"type":"scroll_to","keywords":["..."]}
- {"type":"request_lock_confirmation","unit_id":"optional existing ID"}

Return JSON only:
{"reply":"short natural English voice response","actions":[],"decision_note":"short internal recommendation rationale"}
""".strip()


def fallback_agent(message: str, context: dict[str, Any]) -> dict[str, Any]:
    q = (message or "").lower()
    units = context.get("available_units", []) or []
    page = str(context.get("page") or "")
    if any(x in q for x in ["master plan", "site plan", "map"]):
        return {
            "reply": "I will open the master plan so we can start from the project layout and the buildings with eligible availability.",
            "actions": [{"type": "navigate", "page": "b-site"}],
        }
    if any(x in q for x in ["cheap", "cheapest", "price", "budget"]):
        return {
            "reply": "I will rank the current eligible units by price while still keeping your space and bedroom preferences in view.",
            "actions": [
                {"type": "show_recommendations", "mode": "price"},
                {"type": "navigate", "page": "b-unit"},
            ],
        }
    if any(x in q for x in ["unit", "apartment", "recommend", "best", "option"]):
        if units:
            u = units[0]
            bits = [str(u.get("label") or u.get("id") or "the unit")]
            if u.get("area") is not None:
                bits.append(f"{u['area']} square metres")
            if u.get("floor") not in (None, ""):
                bits.append(f"floor {u['floor']}")
            uid = str(u.get("id"))
            return {
                "reply": "The strongest current option is " + ", ".join(bits) + ". I will highlight it so you can review it before we compare alternatives.",
                "actions": [
                    {"type": "show_recommendations", "mode": "balanced"},
                    {"type": "focus_unit", "unit_id": uid},
                ],
            }
        return {
            "reply": "I need to open the live exact-unit inventory first. Once it is visible, I will rank only the units that actually exist and are available.",
            "actions": [{"type": "navigate", "page": "b-unit"}],
        }
    if any(x in q for x in ["reserve", "book", "lock", "take this"]):
        return {
            "reply": "I will take you to the confirmation step. The final exact-unit lock must still be confirmed by you.",
            "actions": [{"type": "request_lock_confirmation"}],
        }
    if any(x in q for x in ["more time", "extension", "24 hour", "24h"]):
        return {
            "reply": "After the unit is locked, the short handoff grace protects it while Transaction Operations starts the transaction. If you need more time, you can request 24-hour Extended Grace. It becomes active only after the Transaction Operator approves it.",
            "actions": [],
        }
    if page == "b-site":
        return {
            "reply": "We are on the master plan. I will focus on the buildings that contain the strongest eligible options and guide you into the best one next.",
            "actions": [{"type": "highlight_keywords", "keywords": ["building", "tower", "block"]}],
        }
    return {
        "reply": "I can guide the master plan, compare the live available units and explain the price, area, floor and view trade-offs. Tell me what matters most to you.",
        "actions": [],
    }


base._fallback_agent = fallback_agent
_original_run_agent = base.run_agent
_ARABIC = re.compile(r"[\u0600-\u06ff]")


async def _run_agent_english(message: str, context: dict[str, Any]) -> dict[str, Any]:
    """Guarantee the response text consumed by both REST and WebSocket is English."""
    result = await _original_run_agent(message, context)
    reply = str(result.get("reply") or result.get("reply_en") or result.get("reply_ar") or "").strip()
    if not reply or _ARABIC.search(reply):
        safe = fallback_agent(message, context)
        reply = str(safe["reply"])
        result = {
            "actions": base.legacy._sanitize_actions(safe.get("actions"), context),
            "decision_note": "English-only deterministic fallback",
            "model": "deterministic-english-fallback",
        }
    result["reply"] = reply[:2200]
    # Keep the legacy transport key populated because server64's WebSocket route
    # expects it. The value is English in 6.7 despite the historical key name.
    result["reply_ar"] = result["reply"]
    return result


base.run_agent = _run_agent_english
app = base.app
