import test from "node:test";
import assert from "node:assert/strict";
import { searchWeb } from "../server/search.mjs";

test("searchWeb returns empty array for empty query or blank input", async () => {
  assert.deepEqual(await searchWeb(""), []);
  assert.deepEqual(await searchWeb("   "), []);
  assert.deepEqual(await searchWeb(null), []);
});

test("searchWeb handles network errors or timeouts gracefully without throwing", async () => {
  const failingFetch = () => Promise.reject(new Error("Network offline"));
  const res = await searchWeb("binary search tree", { fetchImpl: failingFetch });
  assert.deepEqual(res, []);
});

test("searchWeb parses HTML and extracts clean results and redirects", async () => {
  const mockHtml = `
    <div class="results">
      <a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ftwo-sum&amp;rut=1">example.com/two-sum</a>
      <a class="result__snippet" href="#">Find &lt;b&gt;two numbers&lt;/b&gt; that add up to target.</a>
    </div>
  `;
  const mockFetch = async () => ({
    ok: true,
    text: async () => mockHtml,
  });

  const results = await searchWeb("two sum", { fetchImpl: mockFetch });
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://example.com/two-sum");
  assert.equal(results[0].snippet, "Find two numbers that add up to target.");
});
