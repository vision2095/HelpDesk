import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Levenshtein distance algorithm (dynamic programming)
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return dp[m][n];
}

function calculateCer(reference, hypothesis) {
  const refChars = Array.from(reference);
  const hypChars = Array.from(hypothesis);
  if (refChars.length === 0) return hypChars.length === 0 ? 0 : 1;
  const distance = levenshteinDistance(refChars, hypChars);
  return distance / refChars.length;
}

function calculateWer(reference, hypothesis) {
  const refWords = reference.trim().split(/\s+/).filter(Boolean);
  const hypWords = hypothesis.trim().split(/\s+/).filter(Boolean);
  if (refWords.length === 0) return hypWords.length === 0 ? 0 : 1;
  const distance = levenshteinDistance(refWords, hypWords);
  return distance / refWords.length;
}

test("GAP-P0-05: CER and WER calculation metrics validation", () => {
  const ref = "The quick brown fox jumps over the lazy dog";
  
  // Exact match
  assert.equal(calculateCer(ref, ref), 0);
  assert.equal(calculateWer(ref, ref), 0);

  // Single character substitution ('fox' -> 'fix')
  const hypSub = "The quick brown fix jumps over the lazy dog";
  const cerSub = calculateCer(ref, hypSub);
  const werSub = calculateWer(ref, hypSub);
  assert.ok(cerSub > 0 && cerSub < 0.05, `CER should be < 5%, got ${(cerSub * 100).toFixed(2)}%`);
  assert.ok(werSub > 0 && werSub <= 0.15, `WER should be <= 15%, got ${(werSub * 100).toFixed(2)}%`);

  // Multiple distortions
  const empty = "";
  assert.equal(calculateCer(empty, empty), 0);
  assert.equal(calculateWer(empty, empty), 0);
});

test("GAP-P0-05: synthetic CER and WER arithmetic on text pairs (no OCR)", () => {
  const groundTruthSamples = [
    {
      name: "Code snippet",
      ref: "function calculateTax(subtotal, rate) { return subtotal * rate; }",
      hyp: "function calculateTax(subtotal, rate) { return subtotal * rate; }"
    },
    {
      name: "User interview query",
      ref: "Can you explain the difference between a mutex and a binary semaphore?",
      hyp: "Can you explain the difference between a mutex and a binary semaphore?"
    },
    {
      name: "System error dialog",
      ref: "Error 0x80070005: Access is denied. Please contact your system administrator.",
      hyp: "Error 0x80070005: Access is denied. Please contact your system administrator."
    }
  ];

  for (const sample of groundTruthSamples) {
    const cer = calculateCer(sample.ref, sample.hyp);
    const wer = calculateWer(sample.ref, sample.hyp);
    assert.equal(cer, 0, `${sample.name} must have 0% CER on clean recognition`);
    assert.equal(wer, 0, `${sample.name} must have 0% WER on clean recognition`);
  }
});

test("GAP-P0-05: Native OCR pipeline invariants in ocr_pipeline.cpp and capture_service.cpp", () => {
  const ocrPipelineSrc = fs.readFileSync("src/native/ocr_pipeline.cpp", "utf8");
  const captureServiceSrc = fs.readFileSync("src-native/src/capture_service.cpp", "utf8");

  // Bilinear downscaling with max dimension 2600 px
  assert.match(ocrPipelineSrc, /kMaxOcrDimension\s*=\s*2600/);
  assert.match(ocrPipelineSrc, /FitForOcr/);
  assert.match(ocrPipelineSrc, /Bilinear sampling preserves glyph edges/);

  // MTA apartment initialization on dedicated worker thread
  assert.match(ocrPipelineSrc, /winrt::init_apartment\(winrt::apartment_type::multi_threaded\)/);

  // Top-down 32-bit DIB specification
  assert.match(ocrPipelineSrc, /biHeight\s*=\s*-physicalHeight/);

  // HintLens reference prompt prefix
  assert.match(ocrPipelineSrc, /The screen content below was extracted from the user's screenshot\(s\) by OCR/);

  // WIC 32bpp BGRA pixel format converter
  assert.match(captureServiceSrc, /GUID_WICPixelFormat32bppBGRA/);
});
