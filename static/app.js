/* owo playground — vanilla JS, no build step. */
const $ = (id) => document.getElementById(id);
const input = $("input"), parseBtn = $("parse-btn"), shuffleBtn = $("shuffle-btn");
const useLlm = $("use-llm"), hint = $("hint"), resultEl = $("result");
const examplesEl = $("examples"), langRow = $("lang-row");
const liveText = $("live-text"), footVer = $("foot-ver");

let EXAMPLES = [];
const LANG_ORDER = ["en", "pcm", "yo", "ha", "ig"];
const LANG_FULL = { en: "English", pcm: "Pidgin", yo: "Yorùbá", ha: "Hausa", ig: "Igbo" };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function confClass(v) { return v <= 0.5 ? "low" : v < 0.85 ? "mid" : ""; }
function gateNote(v, flags) {
  if (flags.includes("needs_llm_provider")) return "Offline heuristic abstained — attach an LLM provider or review manually.";
  if (v <= 0.5) return "Gate says NO-GO — ask the clarification question first.";
  if (v < 0.85) return "Gate says caution — confirm the mid-confidence field.";
  return "Gate says GO — every scored field is confident.";
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

/* ---------- health ---------- */
async function checkHealth() {
  try {
    const h = await api("/api/health");
    liveText.textContent = `live · owo ${h.owo_version}${h.openai_configured ? " · llm on" : ""}`;
    footVer.textContent = `owo ${h.owo_version}`;
  } catch {
    liveText.textContent = "backend offline — start server.py";
  }
}

/* ---------- examples ---------- */
function renderExamples() {
  const groups = {};
  EXAMPLES.forEach((e) => { (groups[e.lang] ||= []).push(e); });
  const order = [...LANG_ORDER, ...Object.keys(groups).filter((l) => !LANG_ORDER.includes(l))];
  examplesEl.innerHTML = "";
  order.forEach((lang) => {
    const list = groups[lang];
    if (!list) return;
    const div = document.createElement("div");
    div.className = "ex-group";
    const needsLlm = list.some((e) => e.label.includes("needs LLM"));
    div.innerHTML = `<span>${esc(lang.toUpperCase())} · ${esc(LANG_FULL[lang] || lang)}${needsLlm ? " · LLM" : ""}</span>`;
    const chips = document.createElement("div");
    chips.className = "ex-chips";
    list.forEach((e) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.innerHTML = `“${esc(e.text)}” <small>· ${esc(e.note)}</small>`;
      b.title = e.note;
      b.onclick = () => { input.value = e.text; doParse(); input.focus(); };
      chips.appendChild(b);
    });
    div.appendChild(chips);
    examplesEl.appendChild(div);
  });

  langRow.innerHTML = "";
  LANG_ORDER.forEach((lang) => {
    const first = EXAMPLES.find((e) => e.lang === lang);
    if (!first) return;
    const b = document.createElement("button");
    b.className = "lang-pill";
    b.textContent = `${lang.toUpperCase()} · ${LANG_FULL[lang]}`;
    b.onclick = () => { input.value = first.text; doParse(); document.getElementById("playground").scrollIntoView({ behavior: "smooth" }); };
    langRow.appendChild(b);
  });
}

/* ---------- parse + render ---------- */
function fieldRow(key, value, conf) {
  const pct = Math.round((conf ?? 0) * 100);
  return `<div class="field">
    <div class="k">${esc(key)}</div>
    <div class="v">${value}<span class="conf"><span class="conf-track"><span class="conf-fill ${confClass(conf ?? 0)}" style="width:${pct}%"></span></span><span class="conf-num">${pct}%</span></span></div>
  </div>`;
}

function renderResult(d) {
  const fc = d.field_confidence || {};
  const gatePct = Math.round((d.min_confidence ?? 0) * 100);
  const val = (v, fallback = "—") => (v === null || v === undefined || v === "" ? `<span style="color:var(--muted)">${fallback}</span>` : esc(v));

  const fields = [
    fieldRow("amount", d.amount_formatted ? `${esc(d.amount_formatted)} <span class="sub">raw: ${esc(d.amount)}</span>` : `<span style="color:var(--muted)">null — not determined</span>`, fc.amount ?? d.confidence_for_amount ?? 0),
    fieldRow("recipient", val(d.recipient), fc.recipient ?? 0),
    fieldRow("bank", val(d.bank, "—"), fc.bank !== undefined ? fc.bank : null),
    fieldRow("service", val(d.service, "—"), fc.service !== undefined ? fc.service : null),
    fieldRow("account #", val(d.account_number, "—"), fc.account_number !== undefined ? fc.account_number : null),
  ].join("");

  const flags = (d.flags || []).map((f) => {
    const kind = f === "needs_llm_provider" ? "info" : "bad";
    return `<li class="flag ${kind}"><code>${esc(f)}</code><span>${esc((d.flag_help || {})[f] || "")}</span></li>`;
  }).join("");

  resultEl.innerHTML = `
    <div class="badges">
      <span class="intent-badge ${esc(d.intent)}">${esc(d.intent)}</span>
      <span class="lang-badge">${esc(d.language_detected)} · ${esc(d.language_name || "")}</span>
      <span class="via-badge">via ${esc(d.via)}</span>
    </div>
    <div class="gate">
      <div class="gate-top"><span>min_confidence gate</span><b>${esc(gatePct)}%</b></div>
      <div class="gate-bar"><div class="gate-fill ${confClass(d.min_confidence ?? 0)}" style="width:${gatePct}%"></div></div>
      <div class="gate-note">${esc(gateNote(d.min_confidence ?? 0, d.flags || []))}</div>
    </div>
    <div class="fields">${fields}</div>
    ${flags ? `<ul class="flags">${flags}</ul>` : `<p style="font-size:13px;color:var(--muted)">No flags — owo is confident about every field in play.</p>`}
    ${d.clarification ? `<div class="clarify"><b>Ask the user</b><p>“${esc(d.clarification)}”</p></div>` : ""}
    ${d.llm_error ? `<div class="llm-error">⚠ ${esc(d.llm_error)}</div>` : ""}
    ${d.transcript ? `<div class="transcript-box">🎙 “${esc(d.transcript)}” <span style="font-size:12px;color:var(--muted)">(${(d.transcript_source || "")})</span></div>` : ""}
    <details class="raw"><summary>raw JSON · OwoResult</summary><pre><code>${esc(JSON.stringify(d, null, 2))}</code></pre></details>
  `;
}

function setBusy(busy) {
  parseBtn.disabled = busy;
  parseBtn.textContent = busy ? "Parsing…" : "Parse →";
}

async function doParse() {
  const text = input.value.trim();
  if (!text) { hint.textContent = "Type something first — e.g. Abeg send 5k to Chidi, GTBank"; hint.className = "hint-line warn"; return; }
  setBusy(true);
  hint.textContent = "POST /api/parse → owo.parse() …";
  hint.className = "hint-line";
  try {
    const d = await api("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, use_llm: useLlm.checked }),
    });
    renderResult(d);
    hint.textContent = `✓ ${d.intent} · ${d.language_detected} · min_conf ${Math.round((d.min_confidence ?? 0) * 100)}% · via ${d.via}`;
    hint.className = "hint-line ok";
  } catch (e) {
    hint.textContent = "✕ " + e.message;
    hint.className = "hint-line warn";
  } finally {
    setBusy(false);
  }
}

parseBtn.onclick = doParse;
input.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") doParse();
});
shuffleBtn.onclick = () => {
  if (!EXAMPLES.length) return;
  const e = EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)];
  input.value = e.text;
  doParse();
};

/* ---------- voice ---------- */
const recBtn = $("rec-btn"), recLabel = $("rec-label"), recTimer = $("rec-timer");
const audioFile = $("audio-file"), voiceLang = $("voice-lang");
const voiceTranscript = $("voice-transcript"), voiceParseBtn = $("voice-parse-btn");
const voiceHint = $("voice-hint"), voiceBox = $("voice-transcript-box");
let mediaRecorder = null, chunks = [], timerId = null, startedAt = 0;

function setVoiceHint(msg, warn = false) {
  voiceHint.textContent = msg;
  voiceHint.className = "hint-line" + (warn ? " warn" : "");
}
async function sendAudio(blob, filename) {
  const fd = new FormData();
  fd.append("file", blob, filename);
  if (voiceLang.value) fd.append("language", voiceLang.value);
  fd.append("use_llm", useLlm.checked ? "true" : "false");
  setVoiceHint("Uploading → Whisper → owo.parse() …");
  try {
    const d = await api("/api/parse-audio", { method: "POST", body: fd });
    voiceBox.hidden = false;
    voiceBox.textContent = `“${d.transcript}”`;
    renderResult(d);
    document.getElementById("playground").scrollIntoView({ behavior: "smooth", block: "nearest" });
    setVoiceHint(`✓ transcript (${d.transcript_source}) → ${d.intent} · min_conf ${Math.round((d.min_confidence ?? 0) * 100)}%`);
  } catch (e) {
    setVoiceHint("✕ " + e.message, true);
  }
}
recBtn.onclick = async () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timerId);
      recTimer.textContent = "";
      recBtn.classList.remove("recording");
      recLabel.textContent = "Record";
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
      if (blob.size) sendAudio(blob, "voice-note.webm");
    };
    mediaRecorder.start();
    startedAt = Date.now();
    recBtn.classList.add("recording");
    recLabel.textContent = "Stop";
    timerId = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      recTimer.textContent = `● ${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    }, 500);
    setVoiceHint("Recording… press Stop when done.");
  } catch {
    setVoiceHint("Mic blocked — allow microphone access or use Upload / transcript fallback.", true);
  }
};
audioFile.onchange = () => {
  const f = audioFile.files[0];
  if (f) sendAudio(f, f.name);
  audioFile.value = "";
};
voiceParseBtn.onclick = async () => {
  const t = voiceTranscript.value.trim();
  if (!t) { setVoiceHint("Paste a transcript first (e.g. Abeg send 5k to Chidi).", true); return; }
  const fd = new FormData();
  fd.append("transcript", t);
  fd.append("use_llm", useLlm.checked ? "true" : "false");
  setVoiceHint("Parsing transcript (no audio needed) …");
  try {
    const d = await api("/api/parse-audio", { method: "POST", body: fd });
    voiceBox.hidden = false;
    voiceBox.textContent = `“${d.transcript}”`;
    renderResult(d);
    setVoiceHint(`✓ transcript fallback → ${d.intent}`);
  } catch (e) {
    setVoiceHint("✕ " + e.message, true);
  }
};

/* ---------- boot ---------- */
(async function boot() {
  checkHealth();
  try {
    const data = await api("/api/examples");
    EXAMPLES = data.examples || [];
    renderExamples();
  } catch {
    examplesEl.innerHTML = `<p style="font-size:13px;color:var(--clay)">Could not load examples — is the backend running?</p>`;
  }
  doParse();
})();
