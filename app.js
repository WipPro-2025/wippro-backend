const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -------------------- Simple in-memory “library” --------------------
// This is the “self-building library” during runtime.
// Later we can persist it to a DB or Google Sheet.
const LIBRARY = {
  // alias -> canonical
  aliases: {
    "spring link": "drop_links",
    "spring links": "drop_links",
    "drop link": "drop_links",
    "drop links": "drop_links",
    "arb link": "drop_links",
    "anti roll bar link": "drop_links",
    "anti-roll bar link": "drop_links",
    "stabiliser link": "drop_links",
    "stabilizer link": "drop_links",
  },
  // canonical -> explanation fields
  entries: {
    // Seed entry so “spring links worn” works even if AI is down
    drop_links: {
      part_name: "Drop links (spring links)",
      what_it_does:
        "These connect the suspension to the anti-roll bar, helping keep the car steady over bumps and when cornering.",
      why_attention:
        "When they wear, they develop play which can cause knocking noises and a looser feel through the suspension.",
      customer_benefit:
        "Replacing them stops the knocking, restores a tighter feel, improves stability, and helps reduce strain on nearby suspension components."
    }
  }
};

function requireSiteKey(req, res) {
  const siteKey = req.get("x-wippro-site-key");
  const expected = process.env.SITE_KEY;

  if (!expected) {
    res.status(500).json({ error: "SERVER_MISSING_SITE_KEY (set SITE_KEY in Railway Variables)" });
    return false;
  }
  if (!siteKey || siteKey !== expected) {
    res.status(401).json({ error: "Unauthorized (missing or wrong site key)" });
    return false;
  }
  return true;
}

// -------------------- Helpers --------------------
function normalize(s) {
  return String(s || "").trim().toLowerCase();
}

function splitItemsFromNotes(notesRaw) {
  // Split by newlines first; if only 1 line, also split by ; or .
  const notes = String(notesRaw || "").trim();
  if (!notes) return [];

  let lines = notes.split("\n").map(x => x.trim()).filter(Boolean);

  if (lines.length === 1) {
    lines = notes
      .split(/[;•]+/)
      .map(x => x.trim())
      .filter(x => x.length > 0);
  }

  // Filter out too-short junk lines
  lines = lines.filter(l => l.length >= 6);
  return lines.length ? lines : [notes];
}

function mapAliasToCanonical(text) {
  const t = normalize(text);
  // Direct alias hit
  if (LIBRARY.aliases[t]) return LIBRARY.aliases[t];

  // Partial/contains alias match
  for (const k of Object.keys(LIBRARY.aliases)) {
    if (t.includes(k)) return LIBRARY.aliases[k];
  }

  return null;
}

function fixedFormatBlock(entry) {
  // Locked, consistent format every time:
  return [
    `${entry.part_name}`,
    ``,
    `What this part does:`,
    `${entry.what_it_does}`,
    ``,
    `Why it needs attention:`,
    `${entry.why_attention}`,
    ``,
    `How replacing it benefits you:`,
    `${entry.customer_benefit}`
  ].join("\n");
}

function combineBlocks(blocks, multiIntro) {
  if (blocks.length === 1) return blocks[0];
  return `${multiIntro}\n\n${blocks.join("\n\n---\n\n")}`;
}

// -------------------- Routes --------------------
app.get("/", (req, res) => res.status(200).send("Wippro backend live 🚀"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

// Main generate endpoint
app.post("/generate", async (req, res) => {
  if (!requireSiteKey(req, res)) return;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "SERVER_MISSING_OPENAI_API_KEY (set OPENAI_API_KEY in Railway Variables)" });
  }

  const {
    notes,
    tone = "calm",
    format = "email",
    customerType = "neutral",
    outputType = "plain_vhc"
  } = req.body || {};

  if (!notes || String(notes).trim().length === 0) {
    return res.status(400).json({ error: "No notes provided" });
  }

  // Split into items
  const items = splitItemsFromNotes(notes);

  // Build result blocks
  const blocks = [];

  for (const item of items) {
    // If we can map via alias/library, use it immediately
    const canonical = mapAliasToCanonical(item);
    if (canonical && LIBRARY.entries[canonical]) {
      blocks.push(fixedFormatBlock(LIBRARY.entries[canonical]));
      continue;
    }

    // Otherwise ask AI to produce STRICT fields (library entry)
    const instructions = `
You are a motor trade service advisor assistant.

Your task: take a workshop note and produce a customer-friendly explanation for a non-technical person.

Rules:
- Professional motor trade language, but simple and clear.
- No jargon (avoid acronyms like ARB unless you explain them).
- No scare tactics.
- Always produce EXACTLY these 4 fields:
  part_name
  what_it_does
  why_attention
  customer_benefit

Each field should be 1–2 sentences max.

Return JSON ONLY, no extra text.
`;

    const input = `
Workshop note: "${item}"

Context:
- outputType: ${outputType}
- format: ${format}
- tone: ${tone}
- customerType: ${customerType}
`;

    try {
      const resp = await client.responses.create({
        model: "gpt-5",
        reasoning: { effort: "low" },
        instructions,
        input
      });

      const text = (resp.output_text || "").trim();

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        // Fallback if model returns slightly off JSON
        return res.status(500).json({ error: "AI_FORMAT_ERROR (model did not return valid JSON)" });
      }

      // Validate fields exist
      const required = ["part_name", "what_it_does", "why_attention", "customer_benefit"];
      for (const k of required) {
        if (!parsed[k] || String(parsed[k]).trim().length === 0) {
          return res.status(500).json({ error: `AI_MISSING_FIELD: ${k}` });
        }
      }

      // Create a canonical key from part_name (basic slug)
      const canonKey = normalize(parsed.part_name).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      // Store into in-memory library for reuse
      LIBRARY.entries[canonKey] = {
        part_name: String(parsed.part_name).trim(),
        what_it_does: String(parsed.what_it_does).trim(),
        why_attention: String(parsed.why_attention).trim(),
        customer_benefit: String(parsed.customer_benefit).trim()
      };

      blocks.push(fixedFormatBlock(LIBRARY.entries[canonKey]));
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "AI_GENERATION_FAILED" });
    }
  }

  const multiIntro =
    "A few items were identified during the inspection. Each one is explained below in simple terms so you can understand what it does and how replacing it benefits you.";

  const result = combineBlocks(blocks, multiIntro);

  return res.status(200).json({ ok: true, result });
});

// Feedback endpoint to “note incorrect”
app.post("/feedback", (req, res) => {
  if (!requireSiteKey(req, res)) return;

  const {
    originalNotes,
    outputShown,
    wasCorrect, // true/false
    issueType,  // e.g. "wrong_part" | "inaccurate" | "too_technical" | "other"
    correctPartName, // optional
    correctedText // optional
  } = req.body || {};

  // For now, we just log it (Railway logs). Later we can push this to Google Sheets or DB.
  console.log("WIPPRO_FEEDBACK", {
    time: new Date().toISOString(),
    wasCorrect,
    issueType,
    correctPartName,
    originalNotes,
    outputShown,
    correctedText
  });

  // If user supplies a corrected JSON-style entry, you can optionally update library later.
  // (We can add that next if you want.)

  return res.status(200).json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => console.log(`Backend running on port ${PORT}`));
