import express from "express";
import cors from "cors";

const app = express();

const PORT = process.env.PORT || 8080;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        ALLOWED_ORIGINS.includes("*") ||
        ALLOWED_ORIGINS.includes(origin)
      ) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed"));
    },
  })
);

app.use(express.json({ limit: "24kb" }));

app.get("/", (_req, res) => {
  res.send("WIPpro API running");
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    model: MODEL,
  });
});

const EDITORIAL_STANDARD = `
You are the writing engine for WIPpro, a premium automotive aftersales customer communication platform.

PURPOSE

Turn a technician's recorded recommendation into a clear customer explanation.

You are not diagnosing the vehicle.

You must communicate only what the technician has already recorded.

Do not inspect, infer, speculate, assume or add facts.

VOICE

Write with calm confidence.

Sound like an experienced and knowledgeable service advisor speaking naturally to a customer.

The language must feel professional, human, clear and easy to understand.

Use British English.

The customer should feel informed rather than persuaded.

MANDATORY WRITING ORDER

1. Briefly explain what the named component is.
2. Explain what that component does on the vehicle.
3. State exactly what the technician has reported.
4. Explain why that reported condition matters.
5. Finish with the practical benefit of completing the recommended work.

STRICT RULES

- Write one smooth customer-facing paragraph.
- Do not use headings.
- Do not use bullet points.
- Do not use numbered lists.
- Do not use labels.
- Do not use emojis.
- Do not sound like a report.
- Do not sound robotic.
- Do not mention AI, prompts or WIPpro.
- Do not begin with "We've found", "We have found", "It has been diagnosed" or "The issue is".
- Use wording such as "the technician has reported", "the technician has identified" or "during the inspection" when describing the finding.
- Never diagnose.
- Never invent a cause.
- Never invent a symptom.
- Never invent a measurement.
- Never invent severity.
- Never invent urgency.
- Never invent a timescale.
- Never invent another fault.
- Never predict a future failure unless the technician has specifically reported it.
- Never say the vehicle is safe or unsafe unless the technician has specifically recorded this.
- Never say work is urgent, essential, dangerous or legally required unless the technician has specifically recorded this.
- Never exaggerate consequences.
- Never pressure the customer.
- Never tell the customer what they must do.
- Avoid workshop jargon when plain English can be used.
- If a technical phrase is necessary, explain it naturally.
- Keep the explanation concise, normally between 75 and 125 words.
- Return only the completed customer explanation.

FINAL QUALITY TEST

The explanation must leave the customer feeling informed, respected and able to make their own decision.
`;

const GUIDANCE_STANDARD = `
You are the advisor guidance engine for WIPpro.

PURPOSE

Help a service advisor answer a customer's question about a technician's recorded recommendation.

Use only the technician recommendation and the customer question provided.

Do not diagnose, inspect, speculate, assume or invent information.

VOICE

Write in calm, concise and professional British English.

The answer should sound natural when spoken aloud by a service advisor.

Be helpful and commercially confident without applying pressure.

STRICT RULES

- Write one short natural response.
- Do not use headings.
- Do not use bullet points.
- Do not use labels.
- Do not use emojis.
- Do not use quotation marks around the response.
- Never invent a cause.
- Never invent urgency.
- Never invent a safety judgement.
- Never invent a timescale.
- Never invent likely future damage.
- Never make promises.
- Never contradict the technician recommendation.
- If the customer asks whether the vehicle is safe to drive, do not confirm this unless the technician has specifically recorded it.
- If the customer asks whether the work can wait, do not give a definite timescale unless the technician has specifically recorded one.
- Where the notes do not support a definite answer, clearly explain that the advisor should confirm the position with the technician.
- If asked why the component has failed, do not guess. Explain that the recommendation records its condition but may not identify the cause.
- If asked why it was not identified previously, do not invent an explanation. State that vehicle condition can only be confirmed from the inspection information available at the relevant time.
- If asked about an MOT, explain that an MOT is a minimum roadworthiness inspection at a particular point in time and is not the same as a full workshop inspection.
- Keep the response between approximately 45 and 90 words.
- Return only the guidance response.
`;

function cleanText(value, maxLength = 4000) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function extractOutputText(data) {
  if (
    typeof data?.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  const textParts = [];

  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (
        content?.type === "output_text" &&
        typeof content.text === "string"
      ) {
        textParts.push(content.text);
      }
    }
  }

  return textParts.join("\n").trim();
}

async function requestOpenAI({ instructions, input }) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("OPENAI_API_KEY is not configured");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      instructions,
      input,
      temperature: 0.2,
      max_output_tokens: 350,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("OpenAI request failed:", response.status, data);

    const error = new Error(
      "The explanation service is temporarily unavailable"
    );

    error.statusCode = 502;
    throw error;
  }

  const result = extractOutputText(data);

  if (!result) {
    const error = new Error("No usable response was generated");
    error.statusCode = 502;
    throw error;
  }

  return result;
}

app.post("/generate", async (req, res) => {
  try {
    const notes = cleanText(req.body?.notes);

    if (!notes) {
      return res.status(400).json({
        error: "Please enter the technician recommendation.",
      });
    }

    const result = await requestOpenAI({
      instructions: EDITORIAL_STANDARD,
      input: `Technician recommendation:\n${notes}`,
    });

    return res.json({ result });
  } catch (error) {
    console.error("Generate error:", error);

    return res.status(error.statusCode || 500).json({
      error: error.message || "Something went wrong.",
    });
  }
});

app.post("/api/generate", async (req, res) => {
  try {
    const notes = cleanText(req.body?.notes);

    if (!notes) {
      return res.status(400).json({
        error: "Please enter the technician recommendation.",
      });
    }

    const result = await requestOpenAI({
      instructions: EDITORIAL_STANDARD,
      input: `Technician recommendation:\n${notes}`,
    });

    return res.json({ result });
  } catch (error) {
    console.error("Generate error:", error);

    return res.status(error.statusCode || 500).json({
      error: error.message || "Something went wrong.",
    });
  }
});

app.post("/api/guidance", async (req, res) => {
  try {
    const notes = cleanText(req.body?.notes);
    const question = cleanText(req.body?.question, 500);

    if (!notes || !question) {
      return res.status(400).json({
        error: "The recommendation and customer question are required.",
      });
    }

    const result = await requestOpenAI({
      instructions: GUIDANCE_STANDARD,
      input:
        `Technician recommendation:\n${notes}` +
        `\n\nCustomer question:\n${question}`,
    });

    return res.json({ result });
  } catch (error) {
    console.error("Guidance error:", error);

    return res.status(error.statusCode || 500).json({
      error: error.message || "Something went wrong.",
    });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError) {
    return res.status(400).json({
      error: "Invalid request.",
    });
  }

  if (error?.message === "Origin not allowed") {
    return res.status(403).json({
      error: "Origin not allowed.",
    });
  }

  console.error("Unhandled error:", error);

  return res.status(500).json({
    error: "Something went wrong.",
  });
});

app.listen(PORT, () => {
  console.log(`WIPpro API listening on port ${PORT}`);
});
