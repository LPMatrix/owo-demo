# owo demo — say it like you'd say it

Live playground for `[LPMatrix/owo](https://github.com/LPMatrix/owo)`, the
Nigerian-language financial intent parser. 

stack owo

## What you get

- **Parser playground** — type any phrase → intent, entities, per-field
confidence bars, `min_confidence` go/no-go gate, flags, clarification
prompt, and raw `OwoResult` JSON.
- **Multilingual fixtures** — one-click examples in English, Pidgin, Yoruba,
Hausa, Igbo (plus two `unknown` cases that need an LLM).
- **Ambiguity handling** — `Send money to Tunde` → `missing_amount` + the exact
question to ask the user, driven by per-field confidence.
- **Voice input** — record/upload audio → Whisper → `parse_audio()`. A
transcript-paste fallback works with no API key.



## Run it

```bash
uv venv .venv --python /opt/homebrew/bin/python3.12  # any Python ≥ 3.11
uv pip install --python .venv/bin/python -r requirements.txt

# offline heuristic only (no key needed)
.venv/bin/uvicorn server:app --port 8000

# full power: LLM fallback + Whisper voice
OPENAI_API_KEY=sk-... .venv/bin/uvicorn server:app --reload --port 8000
```

Open **[http://localhost:8000](http://localhost:8000)**.

## API


| Method | Path               | Body                                                       | Notes                                             |
| ------ | ------------------ | ---------------------------------------------------------- | ------------------------------------------------- |
| `GET`  | `/api/health`      | —                                                          | owo version, key status                           |
| `GET`  | `/api/examples`    | —                                                          | curated fixtures grouped by language              |
| `POST` | `/api/parse`       | `{"text": "...", "use_llm": false}`                        | heuristic first; LLM only on `needs_llm_provider` |
| `POST` | `/api/parse-audio` | multipart `file` (+`language`, +`use_llm`) or `transcript` | Whisper → parse; transcript-only works keyless    |


```bash
curl -s localhost:8000/api/parse \
  -H 'Content-Type: application/json' \
  -d '{"text":"Abeg send 5k to Chidi, GTBank"}' | python3 -m json.tool
```



## Layout

```
owo-demo/
├── server.py          # FastAPI: /api/* + serves static/
├── requirements.txt
└── static/
    ├── index.html     # playground UI
    ├── styles.css     # "Naija ledger" editorial theme
    └── app.js         # fetch + render, no build step
```



## Design notes

Warm paper + ink + owo green, Fraunces serif for the voice of the user,
Space Grotesk for UI, JetBrains Mono for JSON. Confidence is always shown
per-field (never one vague number), and the demo never fills in missing
fields — it asks, exactly like the library does.