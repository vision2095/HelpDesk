import http from 'node:http';
import path from 'node:path';
import { createReleases } from '../server/cloud/releases.mjs';

const host = process.env.DOWNLOAD_HOST || '127.0.0.1';
const port = Number(process.env.DOWNLOAD_PORT || 4320);
const origin = `http://${host}:${port}`;
const releases = createReleases(path.resolve('release'), origin);
const labels = { windows: 'Windows x64 · MSI', 'mac-arm64': 'Mac · Apple Silicon', 'mac-x64': 'Mac · Intel' };
const server = http.createServer(async (req, res) => {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const url = new URL(req.url, origin);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    if (url.pathname.startsWith('/downloads/')) {
      await releases.serve(req, res, url);
      return;
    }
    if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }
    const manifest = await releases.manifest();
    const cards = Object.entries(labels).map(([key, label]) => {
      const file = manifest[key];
      const resolvedLabel = key === 'windows' && file
        ? (file.name.toLowerCase().endsWith('.msi') ? 'Windows x64 · MSI' : 'Windows x64 · ZIP')
        : label;
      return file ? `<article><h2>${resolvedLabel}</h2><p>${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB</p><a href="/downloads/${key}">Download</a><details><summary>SHA-256 checksum</summary><code>${file.sha256}</code></details></article>` : '';
    }).join('');
    const windowsHint = manifest.windows
      ? (manifest.windows.name.toLowerCase().endsWith('.msi')
        ? 'Windows: run the LensDesk MSI installer, then open LensDesk from the Start menu.'
        : 'Windows: extract the complete ZIP and open RuntimeHost.exe. Keep all extracted runtime files together.')
      : '';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Download LensDesk</title><style>body{margin:0;background:#101218;color:#eef0f7;font:16px/1.6 system-ui,sans-serif}main{max-width:850px;margin:60px auto;padding:24px}h1{font-size:42px;margin-bottom:8px}p{color:#b6bdcd}article{border:1px solid #343a49;border-radius:16px;padding:24px;margin:20px 0;background:#191d27}a{display:inline-block;background:#b8e9d0;color:#11251c;border-radius:8px;padding:10px 22px;font-weight:650;text-decoration:none}h2{margin:0}details{margin-top:18px;color:#b6bdcd}code{display:block;overflow-wrap:anywhere;margin-top:10px;font-size:12px}</style></head><body><main><h1>Download LensDesk</h1><p>Windows and macOS · version 1.3.6</p>${cards}<p>${windowsHint}</p><p>Mac: open the DMG and copy LensDesk to Applications. These development builds are not notarized by Apple.</p><p>This download page is available on this local network while the host Mac and server are running. It provides downloads only; it does not expose account or workspace data.</p></main></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) res.writeHead(500);
    res.end('Download unavailable.');
  }
});
server.listen(port, process.env.DOWNLOAD_BIND || host, () => console.log(`LensDesk network downloads: ${origin}`));
process.on('SIGTERM', () => server.close());
