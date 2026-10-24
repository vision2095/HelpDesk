import { respondWithStream } from "./event-stream.mjs";
import http from "node:http";
import path from "node:path";
import { createService } from "./core.mjs";
const service = createService({
  directory: path.resolve(process.env.LENSDESK_DATA_DIR || ".data/browser"),
});
const allowedOrigins = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4319",
  "http://localhost:4319",
  "http://127.0.0.1:4318",
  "http://localhost:4318",
  ...(process.env.LENSDESK_DEV_ORIGIN ? [process.env.LENSDESK_DEV_ORIGIN] : []),
]);
const isAllowedDevOrigin = (req) => {
  const reqOrigin = req.headers.origin;
  if (!reqOrigin) return true;
  if (allowedOrigins.has(reqOrigin)) return true;
  try {
    const u = new URL(reqOrigin);
    if (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "[::1]"
    ) {
      return true;
    }
    if (req.headers.host && u.host === req.headers.host) return true;
  } catch {}
  return false;
};
import { createReleases } from "./cloud/releases.mjs";
const releases = createReleases(
  path.resolve(process.env.DOWNLOAD_DIRECTORY || "release"),
  process.env.LENSDESK_PUBLIC_URL || "http://127.0.0.1:5173",
);
http
  .createServer(async (req, res) => {
    const url = new URL(
      req.url,
      `http://${req.headers.host || "127.0.0.1:4318"}`,
    );
    if (
      ["GET", "HEAD"].includes(req.method) &&
      (await releases.serve(req, res, url))
    ) {
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "POST" || !req.url?.startsWith("/api/")) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    if (req.headers.origin && !isAllowedDevOrigin(req)) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: "Origin not allowed" }));
      return;
    }
    if (!String(req.headers["content-type"]).startsWith("application/json")) {
      res.writeHead(415);
      res.end(JSON.stringify({ error: "Use application/json" }));
      return;
    }
    try {
      let body = "",
        bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 42000000) throw new Error("Request is too large.");
        body += chunk;
      }
      const action = req.url.slice(5);
      if (action === "cloud.public") {
        try {
          const response = await fetch("http://127.0.0.1:4319/api/" + action, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}),
            },
            body,
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok) {
            const cookie = response.headers.get("set-cookie");
            if (cookie) res.setHeader("Set-Cookie", cookie);
            res.writeHead(response.status);
            res.end(await response.text());
            return;
          }
        } catch {}
        const origin =
          req.headers.origin ||
          (req.headers["x-forwarded-host"]
            ? `http://${req.headers["x-forwarded-host"]}`
            : "http://127.0.0.1:5173");
        const localReleases = createReleases(
          path.resolve(process.env.DOWNLOAD_DIRECTORY || "release"),
          origin,
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            downloads: await localReleases.manifest(),
            plans: {
              free: { requests: 5, audioSeconds: 600, tokens: 100000 },
              pro: { requests: 500, audioSeconds: 7200, tokens: 2000000 },
            },
            price: null,
            serverUrl: origin,
          }),
        );
        return;
      }
      if (/^(cloud\.|auth\.|billing\.|account\.)/.test(action)) {
        const response = await fetch("http://127.0.0.1:4319/api/" + action, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}),
          },
          body,
        });
        const cookie = response.headers.get("set-cookie");
        if (cookie) res.setHeader("Set-Cookie", cookie);
        res.writeHead(response.status);
        res.end(await response.text());
        return;
      }
      const payload = JSON.parse(body || "{}");
      if (action === "chat" && payload.stream) {
        await respondWithStream(res, (options) =>
          service.dispatch(action, payload, options),
        );
        return;
      }
      const result = await service.dispatch(action, payload);
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(error.code === "CONFLICT" ? 409 : 400);
      res.end(
        JSON.stringify({
          code: error.code,
          current: error.current,
          error:
            error.name === "ZodError"
              ? "Invalid data. Check the fields and file size."
              : error.message,
        }),
      );
    }
  })
  .listen(Number(process.env.LENSDESK_DEV_PORT || 4318), "127.0.0.1", () =>
    console.log(
      `LensDesk local API: http://127.0.0.1:${process.env.LENSDESK_DEV_PORT || 4318} (browser keys stay in memory)`,
    ),
  );
