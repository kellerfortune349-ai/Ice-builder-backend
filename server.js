
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const app = express();
const PORT = process.env.PORT || 3000;
const execFileAsync = promisify(execFile);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PROVIDERS = {
  gemini: {
    env: "GEMINI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
  },
  groq: {
    env: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile"
  },
  mistral: {
    env: "MISTRAL_API_KEY",
    url: "https://api.mistral.ai/v1/chat/completions",
    model: "mistral-small-latest"
  },
  deepseek: {
    env: "DEEPSEEK_API_KEY",
    url: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat"
  },
  openai: {
    env: "OPENAI_API_KEY",
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4.1-mini"
  }
};

function availableProviders() {
  return Object.keys(PROVIDERS).filter(
    name => Boolean(process.env[PROVIDERS[name].env])
  );
}

app.get("/", (req, res) => {
  res.json({ name: "ICE BUILDER", status: "online" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "ice-builder-backend" });
});

app.get("/api/providers", (req, res) => {
  const providers = {};
  for (const [name, config] of Object.entries(PROVIDERS)) {
    providers[name] = Boolean(process.env[config.env]);
  }
  res.json({ providers });
});

async function askAI(provider, prompt, system) {
  const config = PROVIDERS[provider];
  const key = process.env[config.env];

  if (!key) throw new Error(`${provider} is not configured`);

  let response;

  if (provider === "gemini") {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 6000 }
      }),
      signal: AbortSignal.timeout(60000)
    });
  } else {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 6000
      }),
      signal: AbortSignal.timeout(60000)
    });
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `${provider} returned HTTP ${response.status}: ${
        data.error?.message || "request failed"
      }`
    );
  }

  const text = provider === "gemini"
    ? (data.candidates || [])
        .flatMap(c => c.content?.parts || [])
        .map(p => p.text || "")
        .join("\n")
    : data.choices?.[0]?.message?.content || "";

  if (!text.trim()) throw new Error(`${provider} returned empty output`);
  return text.trim();
}

async function generateWithFallback(prompt, system, requestedProvider) {
  const configured = availableProviders();
  const order = requestedProvider && PROVIDERS[requestedProvider]
    ? [requestedProvider, ...configured.filter(p => p !== requestedProvider)]
    : ["gemini", "groq", "mistral", "deepseek", "openai"];

  const errors = [];

  for (const provider of order) {
    if (!process.env[PROVIDERS[provider].env]) continue;

    try {
      const output = await askAI(provider, prompt, system);
      return { provider, output, errors };
    } catch (error) {
      console.error(`Provider ${provider} failed:`, error.message);
      errors.push({ provider, error: error.message });
    }
  }

  const error = new Error(
    errors.length
      ? "All configured AI providers failed. Check Render logs and provider quotas."
      : "No AI provider keys are configured in Render."
  );
  error.details = errors;
  throw error;
}

function uuid() {
  return crypto.randomUUID();
}

function safeName(value) {
  return String(value || "custom_item")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "custom_item";
}

function makeManifest(name, description, moduleType, moduleUuid, dependencies = []) {
  return {
    format_version: 2,
    header: {
      name,
      description,
      uuid: uuid(),
      version: [1, 0, 0],
      min_engine_version: [1, 21, 0]
    },
    modules: [{
      type: moduleType,
      uuid: moduleUuid,
      version: [1, 0, 0]
    }],
    ...(dependencies.length ? { dependencies } : {})
  };
}

function buildItemFiles(spec) {
  const id = safeName(spec.id);
  const displayName = String(spec.name || "Custom Ice Item").slice(0, 80);
  const namespace = "ice_builder";
  const identifier = `${namespace}:${id}`;

  const bpUuid = uuid();
  const rpUuid = uuid();
  const bpModuleUuid = uuid();
  const rpModuleUuid = uuid();

  const bpManifest = makeManifest(
    "ICE BUILDER Item BP",
    "Generated by ICE BUILDER",
    "data",
    bpModuleUuid,
    [{ uuid: rpUuid, version: [1, 0, 0] }]
  );

  const rpManifest = makeManifest(
    "ICE BUILDER Item RP",
    "Generated by ICE BUILDER",
    "resources",
    rpModuleUuid
  );

  bpManifest.header.uuid = bpUuid;
  rpManifest.header.uuid = rpUuid;

  const bpItem = {
    format_version: "1.20.50",
    "minecraft:item": {
      description: {
        identifier,
        menu_category: { category: "items" }
      },
      components: {
        "minecraft:icon": { texture: id },
        "minecraft:display_name": { value: displayName },
        "minecraft:max_stack_size": 64
      }
    }
  };

  const textureData = {
    resource_pack_name: "ice_builder",
    texture_name: "atlas.items",
    texture_data: {
      [id]: { textures: `textures/items/${id}` }
    }
  };

  const lang = `item.${identifier}.name=${displayName}\n`;

  const files = {
    "BP/manifest.json": JSON.stringify(bpManifest, null, 2),
    [`BP/items/${id}.json`]: JSON.stringify(bpItem, null, 2),
    "RP/manifest.json": JSON.stringify(rpManifest, null, 2),
    "RP/textures/item_texture.json": JSON.stringify(textureData, null, 2),
    "RP/texts/en_US.lang": lang,
    "README.txt":
      `ICE BUILDER generated item: ${displayName}\n` +
      `Identifier: ${identifier}\n\n` +
      "This starter package requires an item texture PNG to display the intended icon.\n" +
      "JSON and manifest structure were generated automatically; in-game testing is not claimed.\n"
  };

  for (const [file, content] of Object.entries(files)) {
    if (file.endsWith(".json")) JSON.parse(content);
  }

  return { files, identifier, displayName };
}

app.post("/api/build", async (req, res) => {
  const { prompt, bedrockVersion, provider } = req.body || {};

  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ ok: false, error: "Describe your addon." });
  }

  if (prompt.length > 12000) {
    return res.status(413).json({ ok: false, error: "Prompt is too long." });
  }

  const system = `
You are ICE BUILDER, a Minecraft Bedrock addon planning and coding AI.
Return a concise answer and be honest about compatibility.
Do not claim that Minecraft testing has occurred.
Requested Bedrock version: ${bedrockVersion || "not specified"}.
For a simple custom-item request, explain the item design clearly.
`;

  try {
    const ai = await generateWithFallback(
      prompt.trim(),
      system,
      typeof provider === "string" ? provider.toLowerCase() : null
    );

    const wantsItem =
      /\b(custom item|ice item|custom ice|add an item|new item)\b/i.test(prompt);

    if (!wantsItem) {
      return res.json({
        ok: true,
        status: "completed",
        provider: ai.provider,
        output: ai.output,
        addonPackageCreated: false,
        message: "AI response generated. This request was not packaged as an item addon."
      });
    }

    const spec = {
      id: "glacial_ice_fragment",
      name: "Glacial Ice Fragment"
    };

    const addon = buildItemFiles(spec);
    const workDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "ice-builder-")
    );

    try {
      for (const [relative, content] of Object.entries(addon.files)) {
        const full = path.join(workDir, relative);
        await fs.promises.mkdir(path.dirname(full), { recursive: true });
        await fs.promises.writeFile(full, content, "utf8");
      }

      const outputDir = path.join(os.tmpdir(), "ice-builder-downloads");
      await fs.promises.mkdir(outputDir, { recursive: true });

      const packageId = crypto.randomUUID();
      const zipPath = path.join(outputDir, `${packageId}.mcaddon`);
      const packageRoot = path.join(workDir, "package");
      await fs.promises.mkdir(packageRoot, { recursive: true });

      for (const folder of ["BP", "RP"]) {
        const folderPath = path.join(workDir, folder);
        await fs.promises.cp(folderPath, path.join(packageRoot, folder), {
          recursive: true
        });
      }

      await execFileAsync("zip", [
        "-qr", zipPath, "BP", "RP"
      ], { cwd: packageRoot });

      const downloads = new Map();
      downloads.set(packageId, {
        file: zipPath,
        name: `${safeName(addon.displayName)}.mcaddon`
      });

      app.locals.downloads = app.locals.downloads || new Map();
      app.locals.downloads.set(packageId, {
        file: zipPath,
        name: `${safeName(addon.displayName)}.mcaddon`
      });

      return res.json({
        ok: true,
        status: "completed",
        provider: ai.provider,
        output: ai.output,
        addonPackageCreated: true,
        identifier: addon.identifier,
        downloadPath: `/api/download/${packageId}`,
        message: "Package created. Import and test it in Minecraft; a custom PNG texture is not included."
      });
    } finally {
      await fs.promises.rm(workDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.error("Build failed:", error.message);
    return res.status(502).json({
      ok: false,
      error: error.message,
      details: error.details || undefined
    });
  }
});

app.get("/api/download/:id", async (req, res) => {
  const item = app.locals.downloads?.get(req.params.id);
  if (!item) {
    return res.status(404).json({
      ok: false,
      error: "Download not found. Generate the addon again."
    });
  }
  return res.download(item.file, item.name);
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Endpoint not found." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ICE BUILDER listening on ${PORT}`);
});
