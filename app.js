const API_BASE = "https://accomplished-optimism-production-0e13.up.railway.app";
const SITE_KEY = "WIPPRO_INTERNAL_2026";

function $(sel) { return document.querySelector(sel); }

function setStatus(msg, isError = false) {
  const el = $("#status");
  if (!el) return;
  el.style.display = msg ? "block" : "none";
  el.textContent = msg || "";
  el.style.borderColor = isError ? "#f0c36d" : "#d9dde7";
  el.style.background = isError ? "#fff7e6" : "#f6f7f9";
}

function setOutput(text) {
  const out = $("#output");
  if (out) out.textContent = text;
}

async function postJSON(path, payload) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wippro-site-key": SITE_KEY
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let lastGenerated = {
  notes: "",
  output: ""
};

document.addEventListener("DOMContentLoaded", () => {
  const form = $("#generateForm");
  const notesEl = $("#notes");
  const toneEl = $("#tone");
  const formatEl = $("#format");
  const customerTypeEl = $("#customerType");
  const outputTypeEl = $("#outputType");

  const btnGenerate = $("#btnGenerate");
  const btnClear = $("#btnClear");
  const btnCopy = $("#btnCopy");
  const btnCorrect = $("#btnCorrect");
  const btnIncorrect = $("#btnIncorrect");

  btnClear?.addEventListener("click", () => {
    notesEl.value = "";
    setOutput("Result will appear here…");
    setStatus("");
    lastGenerated = { notes: "", output: "" };
  });

  btnCopy?.addEventListener("click", async () => {
    const text = $("#output")?.textContent || "";
    if (!text || text.includes("Result will appear here")) return alert("Nothing to copy yet.");
    await navigator.clipboard.writeText(text);
    alert("Copied ✅");
  });

  btnCorrect?.addEventListener("click", async () => {
    if (!lastGenerated.output) return alert("Generate something first.");
    try {
      await postJSON("/feedback", {
        originalNotes: lastGenerated.notes,
        outputShown: lastGenerated.output,
        wasCorrect: true,
        issueType: "none"
      });
      alert("Saved ✅");
    } catch (e) {
      alert(e.message);
    }
  });

  btnIncorrect?.addEventListener("click", async () => {
    if (!lastGenerated.output) return alert("Generate something first.");

    const issueType = prompt(
      "What’s wrong? Type one:\nwrong_part / inaccurate / too_technical / other",
      "wrong_part"
    ) || "other";

    const correctPartName = prompt("If you know the correct part name, type it (or leave blank):", "") || "";
    const correctedText = prompt("Optional: what should it say instead? (or leave blank):", "") || "";

    try {
      await postJSON("/feedback", {
        originalNotes: lastGenerated.notes,
        outputShown: lastGenerated.output,
        wasCorrect: false,
        issueType,
        correctPartName,
        correctedText
      });
      alert("Noted ✅ (logged for review)");
    } catch (e) {
      alert(e.message);
    }
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const notes = (notesEl.value || "").trim();
    if (!notes) return alert("Paste workshop notes first.");

    const payload = {
      notes,
      tone: toneEl?.value || "calm",
      format: formatEl?.value || "email",
      customerType: customerTypeEl?.value || "neutral",
      outputType: outputTypeEl?.value || "plain_vhc"
    };

    try {
      setStatus("Generating…");
      btnGenerate && (btnGenerate.disabled = true);

      const result = await postJSON("/generate", payload);

      const text = result.result || "No result returned.";
      setOutput(text);
      setStatus("Done ✅");

      lastGenerated = { notes, output: text };
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Something went wrong", true);
      alert(err.message || "Something went wrong");
    } finally {
      btnGenerate && (btnGenerate.disabled = false);
    }
  });
});
