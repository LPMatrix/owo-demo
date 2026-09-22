"""owo demo backend — FastAPI server exposing the real `owo` parser.

Run:
    uv pip install -r requirements.txt
    OPENAI_API_KEY=sk-... .venv/bin/uvicorn server:app --reload --port 8000

Endpoints:
    GET  /api/health     -> status + owo version + llm/voice availability
    GET  /api/examples   -> curated multilingual fixtures grouped by language
    POST /api/parse      -> { text, use_llm } -> serialized OwoResult + UX hints
    POST /api/parse-audio -> multipart audio (or direct transcript) -> parse result
    GET  /               -> serves the static playground
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from owo import __version__ as OWO_VERSION
from owo import parse as owo_parse

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="owo demo", version="0.1.0")

# ---------------------------------------------------------------------------
# Curated examples — every one verified against the real heuristic (v0.4.0).
# The two `unknown` entries intentionally need an LLM provider.
# ---------------------------------------------------------------------------

EXAMPLES = [
    {"text": "Send 20k to Mama", "lang": "en", "label": "English · shorthand", "note": "5k / 20k → thousands"},
    {"text": "Send half a milli to Kemi", "lang": "en", "label": "English · slang", "note": "half a milli = ₦500,000"},
    {"text": "Send money to Tunde", "lang": "en", "label": "English · ambiguous", "note": "missing amount → flag, not a guess"},
    {"text": "how much is in my account", "lang": "en", "label": "English · balance", "note": "new in 0.4 — natural phrasing"},
    {"text": "hey abeg send 20k to mama", "lang": "pcm", "label": "Pidgin · leading filler", "note": "new in 0.4 — politeness stripped first"},
    {"text": "send mama 20k", "lang": "en", "label": "English · object-first", "note": "new in 0.4 — no 'to', scored lower"},
    {"text": "send 20k to mama pls", "lang": "en", "label": "English · trailing filler", "note": "new in 0.4 — 'pls' trimmed off recipient"},
    {"text": "trasfer 20k to mama", "lang": "en", "label": "English · typo", "note": "new in 0.4 — fuzzy verb correction"},
    {"text": "How much do I have?", "lang": "en", "label": "English · balance", "note": "balance_check intent"},
    {"text": "Abeg send 5k to Chidi, GTBank", "lang": "pcm", "label": "Pidgin · bank split", "note": "code-switch + ', GTBank' → bank field"},
    {"text": "Send am 5k to Ngozi", "lang": "pcm", "label": "Pidgin · send am", "note": "object-pronoun marker"},
    {"text": "How much I get?", "lang": "pcm", "label": "Pidgin · balance", "note": "balance_check in Pidgin"},
    {"text": "ran 5k si Chidi", "lang": "yo", "label": "Yoruba · transfer", "note": "rán … sí pattern"},
    {"text": "Melo ni owo mi?", "lang": "yo", "label": "Yoruba · balance", "note": "balance_check in Yoruba"},
    {"text": "Aika dubu goma zuwa ga Ahmad", "lang": "ha", "label": "Hausa · transfer", "note": "dubu goma = 10,000"},
    {"text": "Nawa ne kudin asusun?", "lang": "ha", "label": "Hausa · balance", "note": "balance_check in Hausa"},
    {"text": "Zipụ ego 5k nye Emeka", "lang": "ig", "label": "Igbo · transfer", "note": "zipụ ego … nye pattern"},
    {"text": "Ego m ole dị?", "lang": "ig", "label": "Igbo · balance", "note": "balance_check in Igbo"},
    {"text": "Buy 2GB data for 08012345678 on MTN", "lang": "en", "label": "Data · needs LLM", "note": "outside heuristic → needs_llm_provider"},
    {"text": "Pay my DSTV, smart card 1234567", "lang": "en", "label": "Bill · needs LLM", "note": "outside heuristic → needs_llm_provider"},
]

LANG_NAMES = {"en": "English", "pcm": "Pidgin", "yo": "Yoruba", "ha": "Hausa", "ig": "Igbo"}

FLAG_HELP = {
    "missing_amount": "Amount couldn't be determined. Ask the user how much before hitting the payment rail.",
    "missing_recipient": "Recipient couldn't be determined. Ask who should receive it.",
    "ambiguous_recipient": "Recipient text is ambiguous. Confirm the exact person/account.",
    "needs_llm_provider": "Outside the offline heuristic's rule set. Attach an LLM provider (or confirm manually) — the demo can try OpenAI if a key is configured.",
    "bad_provider_output": "The LLM returned unparseable output. Retry or fall back to manual review.",
}


def clarification_for(result) -> str | None:
    """Human-friendly next question the demo UI shows when flags fire."""
    flags = result.flags
    if "missing_amount" in flags:
        who = f" {result.recipient}" if result.recipient else ""
        return f"How much should I send to{who}?"
    if "missing_recipient" in flags:
        what = f"₦{result.amount:,.0f}" if result.amount else "this"
        return f"Who should receive {what}?"
    if "ambiguous_recipient" in flags:
        return f"Just to confirm — who exactly is '{result.recipient}'? (name, bank, or account number)"
    if "needs_llm_provider" in flags:
        return "I couldn't classify this offline — plug in an LLM provider or handle it as a manual review."
    if "bad_provider_output" in flags:
        return "The language model gave back something unparseable — best to retry or review manually."
    return None


def serialize(result, source_text: str, via: str) -> dict:
    return {
        "input": source_text,
        "via": via,
        "intent": result.intent.value,
        "amount": result.amount,
        "amount_formatted": f"₦{result.amount:,.2f}" if result.amount is not None else None,
        "currency": result.currency,
        "recipient": result.recipient,
        "account_number": result.account_number,
        "bank": result.bank,
        "service": result.service,
        "language_detected": result.language_detected.value,
        "language_name": LANG_NAMES.get(result.language_detected.value, result.language_detected.value),
        "field_confidence": dict(result.field_confidence),
        "min_confidence": result.min_confidence,
        "confidence_for_amount": result.confidence_for("amount"),
        "flags": list(result.flags),
        "flag_help": {f: FLAG_HELP.get(f, "See owo docs for this flag.") for f in result.flags},
        "clarification": clarification_for(result),
        "raw": result.raw,
    }


class ParseRequest(BaseModel):
    text: str
    use_llm: bool = False


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "owo_version": OWO_VERSION,
        "openai_configured": bool(os.getenv("OPENAI_API_KEY")),
        "endpoints": ["GET /api/examples", "POST /api/parse", "POST /api/parse-audio"],
    }


@app.get("/api/examples")
def examples() -> dict:
    return {"languages": LANG_NAMES, "examples": EXAMPLES}


@app.post("/api/parse")
def parse(req: ParseRequest) -> dict:
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Text must not be empty.")
    if len(text) > 500:
        raise HTTPException(status_code=422, detail="Keep demo inputs under 500 characters.")

    heuristic = owo_parse(text)
    needs_llm = "needs_llm_provider" in heuristic.flags

    if req.use_llm and needs_llm:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            out = serialize(heuristic, text, via="heuristic")
            out["llm_error"] = "OPENAI_API_KEY is not set on the server — showing the offline heuristic result. Set the key and retry to see the LLM path."
            return out
        try:
            from owo.providers.openai import OpenAIProvider

            result = owo_parse(text, provider=OpenAIProvider())
            return serialize(result, text, via="llm:openai")
        except Exception as exc:  # keep the demo honest about provider failures
            out = serialize(heuristic, text, via="heuristic")
            out["llm_error"] = f"LLM call failed ({type(exc).__name__}): {exc}"
            return out

    via = "heuristic"
    return serialize(heuristic, text, via=via)


@app.post("/api/parse-audio")
async def parse_audio(
    file: UploadFile | None = File(default=None),
    language: str | None = Form(default=None),
    transcript: str | None = Form(default=None),
    use_llm: bool = Form(default=False),
) -> dict:
    """Voice path: audio bytes -> Whisper transcript -> parse().

    For demos without a mic/key: POST just `transcript=` and it parses directly.
    """
    if transcript and (file is None or file.filename in (None, "")):
        req = ParseRequest(text=transcript, use_llm=use_llm)
        out = parse(req)
        out["transcript"] = transcript
        out["transcript_source"] = "typed-fallback"
        return out

    if file is None:
        raise HTTPException(status_code=422, detail="Upload an audio file or send `transcript` for the no-key fallback.")

    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=422, detail="Audio file is empty.")
    if len(audio) > 15 * 1024 * 1024:
        raise HTTPException(status_code=422, detail="Audio must be under 15 MB for the demo.")

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=409,
            detail="OPENAI_API_KEY is not set on the server, so live transcription is off. "
            "Use the transcript fallback field in the demo UI instead.",
        )
    try:
        from owo.providers.whisper import WhisperProvider

        kwargs = {"language": language} if language else {}
        stt = WhisperProvider(**kwargs)
        transcript_text = stt.transcribe(audio, filename=file.filename or "audio.webm")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Transcription failed ({type(exc).__name__}): {exc}") from exc

    provider = None
    via = "heuristic"
    if use_llm:
        try:
            from owo.providers.openai import OpenAIProvider

            provider = OpenAIProvider()
            via = "llm:openai"
        except Exception:
            provider = None
    from owo import parse_audio as owo_parse_audio

    try:
        # Re-parse from transcript so `via` reflects the llm choice cleanly.
        result = owo_parse(transcript_text, provider=provider) if provider else owo_parse(transcript_text)
        _ = owo_parse_audio  # keep import meaningful; transcript path is equivalent
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Parse after transcription failed: {exc}") from exc

    out = serialize(result, transcript_text, via=f"whisper+{via}")
    out["transcript"] = transcript_text
    out["transcript_source"] = "whisper"
    return out


# --- static playground (mounted last so /api/* keeps priority) ---
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")
