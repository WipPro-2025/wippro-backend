import express from "express";
import cors from "cors";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check (VERY important)
app.get("/", (req, res) => {
  res.send("WipPro backend running ✅");
});

// Main API route
app.post("/generate", async (req, res) => {
  try {
    const { notes, format, tone, customerType } = req.body;

    if (!notes) {
      return res.status(400).json({
        error: "No workshop notes provided"
      });
    }

    // TEMP response (proves backend works)
    res.json({
      result: `Customer explanation (${format}, ${tone}):\n\n${notes}`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// 🚨 REQUIRED for Railway
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

