import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();

// ===== CONFIG =====
const AI_ENABLED = true; // Set false to disable AI instantly
const PORT = process.env.PORT || 8080;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("WipPro backend running ✅");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ===== OPENAI CLIENT =====
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ===== MAIN GENERATE ROUTE =====
app.post("/generate", async (req, res) => {
  try {
    const { notes, format, tone, customerType } = req.body || {};

    if (!notes || !notes.trim()) {
      return res.status(400).json({
        error: "No workshop notes provided"
      });
    }

    // ===== FALLBACK MODE (NO AI) =====
    if (!AI_ENABLED) {
      return res.json({
        result: `Customer explanation:\n\n${notes}`
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY on server"
      });
    }

    // ===== SIMPLE EXPLAIN PROMPT =====
    const systemPrompt = `
You explain car faults to someone who knows NOTHING about cars.

Speak like this:
- Very simple
- Very direct
- No introductions
- No greetings
- No "I" or "we"
- No corporate or formal language

START IMMEDIATELY WITH THE EXPLANATION.

FOR EACH FAULT, USE THIS STRUCTURE EXACTLY:

• What the part is and what it does (in the simplest possible words)
• What is wrong with it
• Why it needs replacing (what could happen if it isn’t fixed)
• What replacing it fixes

RULES:
- Assume the person knows zero mechanical information.
- Use short sentences.
- One idea per sentence.
- If a technical word is used, explain it immediately.
- No promises about cost or time.
- No filler or waffle.
- No reassurance phrases.
- No names, VRN, VIN, phone numbers, or emails.

FORMAT RULES:
- verbal → bullet points
- email → short paragraphs, no greeting
- sms → 1–2 very short lines only

EXAMPLE STYLE:

"The spring is part of the suspension. It holds the car up.
The spring has snapped, so it cannot support the car properly.
If it is not replaced, the car can handle badly and wear tyres unevenly.
Replacing it restores safe handling and ride height."

DO NOT ADD EXTRA WORDING.
`;

    // ===== USER PROMPT =====
    const userPrompt = `
FORMAT: ${format || "verbal"}

Explain this as if talking to someone who knows nothing about cars.
Be blunt, simple, and clear.
Start immediately with the explanation.

Split the notes into separate faults.
Explain each fault using:
- what it is
- what’s wrong
- why replace
- what fixing it does

WORKSHOP NOTES:
${notes}
`;

    // ===== OPENAI REQUEST =====
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3
    });

    const aiText =
      completion.choices?.[0]?.message?.content?.trim() ||
      "No response generated.";

    res.json({ result: aiText });

  } catch (err) {
    console.error("AI error:", err);
    res.status(500).json({
      error: "AI generation failed"
    });
  }
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
