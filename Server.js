
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const providers = {
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY"
};

app.get("/", (req, res) => {
  res.json({
    name: "ICE BUILDER",
    status: "online",
    message: "ICE BUILDER backend is running."
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "ice-builder-backend",
    time: new Date().toISOString()
  });
});

app.get("/api/providers", (req, res) => {
  const configured = {};

  for (const [name, envName] of Object.entries(providers)) {
    configured[name] = Boolean(process.env[envName]);
  }

  res.json({ providers: configured });
});

app.post("/api/build", (req, res) => {
  const { prompt, bedrockVersion } = req.body || {};

  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({
      error: "Please describe the Minecraft addon you want."
    });
  }

  if (prompt.length > 12000) {
    return res.status(413).json({
      error: "The request is too long. Please shorten it."
    });
  }

  res.status(202).json({
    accepted: true,
    status: "received",
    prompt: prompt.trim(),
    bedrockVersion: bedrockVersion || "not specified",
    message: "Request received. AI generation is not connected yet."
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ICE BUILDER listening on port ${PORT}`);
});
