import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { createReleases as rootReleases } from '../server/cloud/releases.mjs';
import { createReleases as workspaceReleases } from '../apps/web/server/cloud/releases.mjs';

const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
for (const [label, createReleases] of [['root', rootReleases], ['workspace', workspaceReleases]]) {
  test(`${label}: macOS legacy filename and remote release routes retain their behavior`, async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lensdesk-mac-routes-'));
    fs.writeFileSync(path.join(dir, `LensDesk-${version}-macOS-Apple-Silicon-arm64.dmg`), 'arm');
    fs.writeFileSync(path.join(dir, `LensDesk-Intel.dmg`), 'intel');
    const origin = 'http://localhost';
    const releases = createReleases(dir, origin, { allowRemoteFallback: true });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    async function request(route) {
      const chunks = [];
      const res = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
      res.headers = {};
      res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
      res.writeHead = (status, headers = {}) => { res.status = status; for (const [key, value] of Object.entries(headers)) res.setHeader(key, value); };
      const done = new Promise(resolve => res.on('finish', resolve));
      await releases.serve({ method: 'GET' }, res, new URL(route, origin));
      await done;
      return { status: res.status, headers: res.headers, body: Buffer.concat(chunks).toString() };
    }
    const intel = await request('/downloads/LensDesk-Intel.dmg');
    assert.equal(intel.status, 200);
    assert.equal(intel.body, 'intel');
    assert.equal(intel.headers['cache-control'], undefined);
    const unknown = await request('/downloads/unknown');
    assert.equal(unknown.status, 302);
    assert.equal(unknown.headers.pragma, 'no-cache');
    assert.equal(unknown.headers.expires, '0');
    assert.equal((await request('/downloads/windows-missing.zip')).status, 404);
    assert.equal((await request('/releases/%bad')).status, 404);
    const fallback = await request('/releases/LensDesk.dmg');
    assert.equal(fallback.status, 302);
    assert.match(fallback.headers.location, /\/LensDesk\.dmg$/);
    assert.equal(fallback.headers['cache-control'], 'public, max-age=300');
  });
  test(`${label}: explicit disabled fallback has no macOS artifacts`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lensdesk-mac-empty-'));
    try { assert.deepEqual(await createReleases(dir, 'http://localhost', { allowRemoteFallback: false }).manifest(), {}); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
