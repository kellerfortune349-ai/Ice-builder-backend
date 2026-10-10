
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

async function generateWithGemini(prompt, bedrockVersion) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    const error = new Error(
      "Gemini API key is missing. Check GEMINI_API_KEY in Render."
    );
    error.status = 503;
    throw error;
  }

  const systemInstructions = `
You are the AI engine for ICE BUILDER, a Minecraft Bedrock addon
development assistant.

Help users design and implement Bedrock add-ons accurately.
Respect the requested Minecraft version and available APIs.
Explain important compatibility limitations honestly.
Never claim that a file, texture, model, sound, test, or addon package
has been created unless the backend has actually created and verified it.
For coding requests, provide complete, organized implementation guidance.
If the request needs more information, ask a focused question.

Target Minecraft Bedrock version: ${bedrockVersion || "Not specified"}.
`;

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstructions }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 5000
        }
      }),
      signal: AbortSignal.timeout(60000)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(
      "Gemini API error:",
      response.status,
      data.error?.message || "No details returned"
    );

    const error = new Error(
      response.status === 429
        ? "Gemini quota or rate limit reached. Check your available quota and try again later."
        : response.status === 401 || response.status === 403
        ? "Gemini rejected the API key. Check the key and its permissions in Render."
        : "Gemini could not complete the request. Check the Render logs."
    );

    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }

  const answer = (data.candidates || [])
    .flatMap(candidate => candidate.content?.parts || [])
    .map(part => part.text || "")
    .join("\n")
    .trim();

  if (!answer) {
    const error = new Error(
      "Gemini returned no text. Try a different prompt."
    );
    error.status = 502;
    throw error;
  }

  return answer;
}

app.post("/api/build", async (req, res) => {
  const { prompt, bedrockVersion } = req.body || {};

  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({
      ok: false,
      error: "Please describe the Minecraft addon you want."
    });
  }

  if (prompt.length > 12000) {
    return res.status(413).json({
      ok: false,
      error: "The request is too long. Please shorten it."
    });
  }

  try {
    console.log("Starting Gemini generation request.");

    const output = await generateWithGemini(
      prompt.trim(),
      typeof bedrockVersion === "string"
        ? bedrockVersion.slice(0, 100)
        : "Not specified"
    );

    console.log("Gemini returned a response.");

    return res.json({
      ok: true,
      status: "completed",
      provider: "gemini",
      output,
      addonPackageCreated: false,
      message:
        "AI response generated successfully. Actual addon files and packaging are not implemented yet."
    });
  } catch (error) {
    console.error("Generation failed:", error.message);

    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || "The AI request failed."
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Endpoint not found."
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ICE BUILDER listening on port ${PORT}`);
});
