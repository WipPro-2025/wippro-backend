import express from "express";
import cors from "cors";

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("WIPpro backend running V2 tyre skip fixed ✅");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "V2 tyre skip fixed",
    routes: ["/generate", "/api/generate"]
  });
});

async function handleGenerate(req, res) {
  try {
    const { notes, context } = req.body;

    if (!notes || !notes.trim()) {
      return res.status(400).json({ error: "No notes provided" });
    }

    const cleanNotes = notes.toLowerCase();
    const cleanContext = (context || "").toLowerCase();

    const isTyreSkip =
      cleanNotes.includes("tyre skip") ||
      cleanNotes.includes("tire skip") ||
      cleanNotes.includes("tyre scrub") ||
      cleanNotes.includes("tire scrub") ||
      cleanNotes.includes("tyre judder") ||
      cleanNotes.includes("tire judder") ||
      cleanNotes.includes("tyre hop") ||
      cleanNotes.includes("tire hop") ||
      cleanNotes.includes("full lock") ||
      cleanNotes.includes("skipping") ||
      cleanNotes.includes("skip when turning");

    const isCharacteristic =
      cleanContext.includes("characteristic") ||
      cleanContext.includes("no fault");

    if (isTyreSkip && isCharacteristic) {
      return res.json({
        result:
          "This can feel unusual, but it is a known characteristic of the vehicle rather than a fault. At low speeds, especially when manoeuvring on full lock, the front wheels naturally turn at slightly different angles. In colder weather the tyre rubber is firmer, so the tyres can momentarily skip or scrub across the surface instead of rolling smoothly. It can be noticeable and a bit off-putting, but the vehicle is safe to drive and no repair or adjustment is required."
      });
    }

    const systemPrompt = `
You are an automotive service advisor communication assistant.

Write the response as ONE smooth, natural paragraph.

Do not use bullet points.
Do not use numbered lists.
Do not use headings.
Do not write like a report.
Do not sound robotic.

The explanation should sound like a service advisor speaking directly to a customer in plain English.

Use simple everyday language, as if explaining to a non-technical person.

Use this flow:
First explain what has been found.
Then explain what it means in simple terms.
Then explain why it matters.
Then explain the benefit of resolving it, without directly asking for the sale.

Never guess or speculate.
Only say a repair is required if the technician notes clearly confirm it.
Do not invent causes.
Do not exaggerate risk.
Do not create unnecessary urgency.

The advisor selects the context. Follow it exactly.

If the context is RED:
Explain clearly that work has been identified and needs doing. Explain the consequence of leaving it and the benefit of fixing it.

If the context is AMBER:
Explain that the item has been advised, is not urgent now, but may worsen over time. Keep the tone calm and non-pushy.

If the context is CHARACTERISTIC:
Explain that it is normal vehicle behaviour, not a fault. Confirm the vehicle is safe to drive. Confirm no repair, adjustment, monitoring, or investigation is required.

Return only the final customer-facing explanation as one natural paragraph.
`;

    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: `Technician notes: ${notes}\nContext: ${context}`
          }
        ],
        temperature: 0.2
      })
    });

    const data = await openAiResponse.json();

    if (!openAiResponse.ok) {
      console.error("OpenAI error:", data);
      return res.status(500).json({ error: "OpenAI request failed" });
    }

    return res.json({
      result: data.output_text || "No explanation generated."
    });

  } catch (error) {
    console.error("WIPpro backend error:", error);
    return res.status(500).json({ error: "Something went wrong" });
  }
}

app.post("/generate", handleGenerate);
app.post("/api/generate", handleGenerate);

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`WIPpro backend running V2 on port ${PORT}`);
});