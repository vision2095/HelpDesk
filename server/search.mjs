/**
 * Privacy-preserving, zero-key web search utility for LensDesk.
 * Fetches real-time search results, extracts titles, snippets, and clean URLs.
 */
export async function searchWeb(query, { maxResults = 3, fetchImpl = fetch, timeoutMs = 3500 } = {}) {
  if (!query || typeof query !== "string" || !query.trim()) return [];
  const cleanQuery = query.trim().slice(0, 300);
  
  // Quick check: if the query doesn't look like something needing search, skip
  if (cleanQuery.length < 3) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!response.ok) return [];

    const html = await response.text();
    const results = [];

    // Parse DuckDuckGo HTML results
    const linkRegex = /<a class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;

    while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
      let rawUrl = match[1];
      // DuckDuckGo redirects through /l/?uddg=URL
      if (rawUrl.includes("uddg=")) {
        try {
          rawUrl = decodeURIComponent(rawUrl.replace(/.*?uddg=([^&]+).*/, "$1"));
        } catch {}
      }

      const snippet = match[3]
        .replace(/<[^>]+>/g, "")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/<[^>]+>/g, "")
        .trim();

      const displayUrl = match[2].replace(/<[^>]+>/g, "").trim();

      if (rawUrl && snippet) {
        results.push({
          url: rawUrl,
          displayUrl,
          snippet,
        });
      }
    }

    return results;
  } catch {
    // Graceful fallback on network timeout or offline
    return [];
  } finally {
    clearTimeout(timer);
  }
}
