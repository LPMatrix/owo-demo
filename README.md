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

## Deploy on Vercel

Yes — this is already Vercel-ready. `server.py` exposes a top-level `app`
(FastAPI entrypoint Vercel auto-detects), deps are in `requirements.txt`
(Python 3.12 default), and the `/assets` `StaticFiles` mount gets promoted to
Vercel's CDN. `vercel.json` sets the function timeout; `.vercelignore` keeps
`.venv/` out of the bundle.

```bash
vercel            # preview deploy
vercel --prod     # ship it
```

Or push to GitHub → Vercel dashboard → Import Project (zero config).

Set `OPENAI_API_KEY` in the project settings (Environment Variables) to enable
the LLM fallback + Whisper voice path. Without it, the offline heuristic and
the transcript-paste fallback still work.

Two platform limits to know:
- **Audio uploads**: Vercel caps request bodies at ~4.5 MB on Hobby, so keep
  voice clips short. The transcript-paste box in the UI bypasses this entirely.
- **Cold starts**: the first hit after idle can take a few seconds (Whisper +
  OpenAI imports are lazy, so plain parsing stays fast).

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