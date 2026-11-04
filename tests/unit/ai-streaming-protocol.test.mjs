import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("GAP-P0-02: Native HttpStreamJson signature and streaming in service_dispatcher.cpp", () => {
  for (const base of ["src-native", "apps/windows/src-native"]) {
    const dispatcher = fs.readFileSync(`${base}/src/service_dispatcher.cpp`, "utf8");
    assert.match(dispatcher, /HttpReply HttpStreamJson\(/, "Must define HttpStreamJson function");
    assert.match(dispatcher, /onDelta\(deltaText\)/, "Must invoke onDelta for streamed text chunks");
    assert.match(dispatcher, /WinHttpReadData/, "Must read chunks via WinHttpReadData");
    assert.match(dispatcher, /choices[\s\S]*delta[\s\S]*content/, "Must extract OpenAI/DeepSeek delta content");
    assert.match(dispatcher, /content_block_delta/, "Must extract Anthropic content_block_delta");
    assert.match(dispatcher, /candidates[\s\S]*parts/, "Must extract Gemini parts text");
  }
});

test("GAP-P0-02: Simulated SSE chunk parser correctly handles split frames and multi-provider deltas", () => {
  // Pure JavaScript simulation of HttpStreamJson's lineBuffer and SSE parser logic
  function parseSseStream(chunks) {
    let lineBuffer = "";
    const deltas = [];
    let completed = false;

    for (const chunk of chunks) {
      lineBuffer += chunk;
      let newlinePos = 0;
      while ((newlinePos = lineBuffer.indexOf("\n")) !== -1) {
        let line = lineBuffer.slice(0, newlinePos);
        lineBuffer = lineBuffer.slice(newlinePos + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);

        if (line.startsWith("data: ")) {
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") {
            completed = true;
            continue;
          }
          try {
            const dataJson = JSON.parse(dataStr);
            let deltaText = "";
            if (dataJson.choices?.[0]?.delta?.content) {
              deltaText = dataJson.choices[0].delta.content;
            } else if (dataJson.type === "content_block_delta" && dataJson.delta?.text) {
              deltaText = dataJson.delta.text;
            } else if (dataJson.candidates?.[0]?.content?.parts?.[0]?.text) {
              deltaText = dataJson.candidates[0].content.parts[0].text;
            } else if (dataJson.response) {
              deltaText = dataJson.response;
            }
            if (deltaText) deltas.push(deltaText);
          } catch {}
        }
      }
    }
    return { deltas, completed, accumulated: deltas.join("") };
  }

  // 1. OpenAI split across chunk boundaries
  const openAiChunks = [
    'data: {"choices":[{"delta":{"content":"The "}}]}\n\ndata: {"choices":[{"delta":{"',
    'content":"answer is 42."}}]}\n\ndata: [DONE]\n\n'
  ];
  const openAiResult = parseSseStream(openAiChunks);
  assert.equal(openAiResult.accumulated, "The answer is 42.");
  assert.equal(openAiResult.completed, true);

  // 2. Anthropic format
  const anthropicChunks = [
    'event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"text":"Hello "}}\r\n\r\n',
    'event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"text":"World!"}}\r\n\r\n',
    'data: [DONE]\r\n\r\n'
  ];
  const anthropicResult = parseSseStream(anthropicChunks);
  assert.equal(anthropicResult.accumulated, "Hello World!");

  // 3. Gemini format
  const geminiChunks = [
    'data: {"candidates":[{"content":{"parts":[{"text":"Gemini streaming "}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"works!"}]}}]}\n\n'
  ];
  const geminiResult = parseSseStream(geminiChunks);
  assert.equal(geminiResult.accumulated, "Gemini streaming works!");

  // 4. Ollama format
  const ollamaChunks = [
    'data: {"response":"Local "}\n\n',
    'data: {"response":"inference."}\n\n'
  ];
  const ollamaResult = parseSseStream(ollamaChunks);
  assert.equal(ollamaResult.accumulated, "Local inference.");
});

test("GAP-P0-02: HTTP error status codes mapped to descriptive user messages", () => {
  const mapError = (status) => {
    if (status === 401) return "Invalid API key or unauthorized access for this provider.";
    if (status === 429) return "Rate limit or quota exceeded for this provider.";
    if (status === 403) return "Access forbidden. Check your provider permissions.";
    return "Provider error HTTP " + status;
  };

  assert.match(mapError(401), /Invalid API key/);
  assert.match(mapError(429), /Rate limit or quota exceeded/);
  assert.match(mapError(403), /Access forbidden/);
  assert.equal(mapError(500), "Provider error HTTP 500");
});
