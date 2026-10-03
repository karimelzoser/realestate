#!/usr/bin/env python3
"""PRENEURA 6.7 English-only live allocation runtime.

This keeps the validated 6.4 transport/TTS implementation but switches the
conversation contract and deterministic fallback to English. English speech
recognition defaults to a general Faster-Whisper model instead of the
Arabic-specialized ASR path.
"""
from __future__ import annotations

import os
from typing import Any

# Set English ASR defaults before importing the validated runtime.
os.environ.setdefault("PRENEURA_ASR_BACKEND", "faster-whisper")
os.environ.setdefault("PRENEURA_ASR_FALLBACK_MODEL", "Systran/faster-whisper-large-v3-turbo")

from local_voice_agent import server64 as base  # noqa: E402

base.APP_NAME = "PRENEURA English Live Allocation Agent"
base.VERSION = "6.7.0"

# server64 delegates speech recognition to the legacy module.
base.legacy.ASR_BACKEND = "faster-whisper"
base.legacy.ASR_FALLBACK_MODEL = os.getenv("PRENEURA_ASR_FALLBACK_MODEL", "Systran/faster-whisper-large-v3-turbo")
base.legacy._asr = None
base.legacy._asr_processor = None
base.legacy._asr_backend_loaded = None

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
9. If the buyer asks for more time after a unit lock, explain that a 24-hour extended grace request must be approved by the Transaction Operator.

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
        return {"reply": "I will open the master plan so we can start from the project layout and the buildings with eligible availability.", "actions": [{"type": "navigate", "page": "b-site"}]}
    if any(x in q for x in ["cheap", "cheapest", "price", "budget"]):
        return {"reply": "I will rank the current eligible units by price while still keeping your space and bedroom preferences in view.", "actions": [{"type": "show_recommendations", "mode": "price"}, {"type": "navigate", "page": "b-unit"}]}
    if any(x in q for x in ["unit", "apartment", "recommend", "best", "option"]):
        if units:
            u = units[0]
            bits = [str(u.get("label") or u.get("id") or "the unit")]
            if u.get("area") is not None:
                bits.append(f"{u['area']} square metres")
            if u.get("floor") not in (None, ""):
                bits.append(f"floor {u['floor']}")
            uid = str(u.get("id"))
            return {"reply": "The strongest current option is " + ", ".join(bits) + ". I will highlight it so you can review it before we compare alternatives.", "actions": [{"type": "show_recommendations", "mode": "balanced"}, {"type": "focus_unit", "unit_id": uid}]}
        return {"reply": "I need to open the live exact-unit inventory first. Once it is visible, I will rank only the units that actually exist and are available.", "actions": [{"type": "navigate", "page": "b-unit"}]}
    if any(x in q for x in ["reserve", "book", "lock", "take this"]):
        return {"reply": "I will take you to the confirmation step. The final exact-unit lock must still be confirmed by you.", "actions": [{"type": "request_lock_confirmation"}]}
    if any(x in q for x in ["more time", "extension", "24 hour", "24h"]):
        return {"reply": "After the unit is locked, you can request a 24-hour extended grace period. The Transaction Operator must approve that extension before it becomes active.", "actions": []}
    if page == "b-site":
        return {"reply": "We are on the master plan. I will focus on the buildings that contain the strongest eligible options and guide you into the best one next.", "actions": [{"type": "highlight_keywords", "keywords": ["building", "tower", "block"]}]}
    return {"reply": "I can guide the master plan, compare the live available units and explain the price, area, floor and view trade-offs. Tell me what matters most to you.", "actions": []}

base._fallback_agent = fallback_agent

# run_agent in server64 reads base.SYSTEM_PROMPT and base._fallback_agent at runtime.
app = base.app
