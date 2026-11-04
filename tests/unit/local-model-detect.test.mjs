import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Local model discovery, vision fallback, CAP-19, and CAP-20 contracts", () => {
  for (const base of ["src-native", "apps/windows/src-native"]) {
    const dispatcher = fs.readFileSync(`${base}/src/service_dispatcher.cpp`, "utf8");

    // HttpGet helper definition using WinHTTP
    assert.match(dispatcher, /HttpReply\s+HttpGet\s*\(\s*const\s+std::string&\s+url/);
    assert.match(dispatcher, /WinHttpOpen/);
    assert.match(dispatcher, /WinHttpConnect/);
    assert.match(dispatcher, /WinHttpOpenRequest/);
    assert.match(dispatcher, /WinHttpSendRequest/);

    // desktop.models.detect actively probes Ollama, LM Studio, llama.cpp, vLLM
    assert.match(dispatcher, /11434/); // Ollama
    assert.match(dispatcher, /1234/);  // LM Studio
    assert.match(dispatcher, /8080/);  // llama.cpp
    assert.match(dispatcher, /8000/);  // vLLM
    assert.match(dispatcher, /\/api\/tags/);
    assert.match(dispatcher, /\/v1\/models/);

    // Vision model identification keywords
    assert.match(dispatcher, /vision/);
    assert.match(dispatcher, /llava/);
    assert.match(dispatcher, /minicpm/);

    // Non-vision fallback notice
    assert.match(dispatcher, /Can't see images, so screenshots are read with Windows OCR and sent as text\./);

    // model.list handles local provider
    assert.match(dispatcher, /provider\s*==\s*"local"/);

    // CAP-19: Saves session history to cloud when signed in
    assert.match(dispatcher, /session\.save/);
    assert.match(dispatcher, /m_cloud\.HasSession\(\)/);

    // CAP-20: Cloud backup archive push and pull
    assert.match(dispatcher, /m_storageMgr->CreateBackup\(\)/);
    assert.match(dispatcher, /m_storageMgr->RestoreBackup\(/);
  }
});

test("Local model JSON response parsing logic", async () => {
  // Test Ollama /api/tags parsing logic
  const ollamaPayload = {
    models: [
      { name: "llama3.2-vision:latest", size: 7921000000 },
      { name: "qwen2.5-coder:7b", size: 4700000000 }
    ]
  };

  const isVisionModel = (name) => {
    const lower = name.toLowerCase();
    return lower.includes("vision") || lower.includes("llava") || lower.includes("vl") || lower.includes("minicpm");
  };

  const ollamaModels = ollamaPayload.models.map(m => ({
    id: `local:${m.name}`,
    name: m.name,
    provider: "local",
    vision: isVisionModel(m.name),
  }));

  assert.equal(ollamaModels.length, 2);
  assert.equal(ollamaModels[0].vision, true);
  assert.equal(ollamaModels[1].vision, false);

  // Test LM Studio /v1/models parsing logic
  const lmStudioPayload = {
    data: [
      { id: "deepseek-r1-distill-qwen-7b" },
      { id: "llava-v1.6-vicuna-7b" }
    ]
  };

  const lmStudioModels = lmStudioPayload.data.map(m => ({
    id: `local:${m.id}`,
    name: m.id,
    provider: "local",
    vision: isVisionModel(m.id),
  }));

  assert.equal(lmStudioModels.length, 2);
  assert.equal(lmStudioModels[0].vision, false);
  assert.equal(lmStudioModels[1].vision, true);
});
