import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

/* ===============================
   MIDDLEWARE
================================ */
app.use(express.json());

app.use(cors({
  origin: "https://wip-pro.netlify.app",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-wippro-site-key"],
}));

app.options("*", cors());

/* ===============================
   ROUTES
================================ */
app.get("/", (req, res) => {
  res.send("WIPpro backend running ✅");
});

app.post("/generate", (req, res) => {
  const siteKey = req.get("x-wippro-site-key");

  if (!siteKey || siteKey !== process.env.SITE_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { notes } = req.body;

  if (!notes) {
    return res.status(400).json({ error: "No notes provided" });
  }

  // TEMP RESPONSE — proves frontend ↔ backend works
  return res.json({
    result: `Backend connected successfully. Notes received: "${notes}"`
  });
});

/* ===============================
   START SERVER
================================ */
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
