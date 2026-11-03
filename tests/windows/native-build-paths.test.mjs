import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const native = path.join(root, 'apps/windows/src-native');

test('nested Windows native target resolves every CMake source in the checkout', () => {
  const cmake = fs.readFileSync(path.join(native, 'CMakeLists.txt'), 'utf8');
  const rootMatch = cmake.match(/get_filename_component\(LENSDESK_ROOT "\$\{CMAKE_CURRENT_SOURCE_DIR\}\/([^"]+)" ABSOLUTE\)/);
  assert.ok(rootMatch, 'repository root must be explicitly resolved');
  const resolvedRoot = path.resolve(native, rootMatch[1]);
  assert.equal(resolvedRoot, root);
  const sources = cmake.match(/set\(SOURCES\s+([\s\S]*?)\n\)/);
  assert.ok(sources, 'native source list must exist');
  const entries = sources[1].trim().split(/\s+/);
  assert.ok(entries.length > 20, 'expected native and vendored source files');
  for (const entry of entries) {
    const expanded = entry.replaceAll('${LENSDESK_ROOT}', resolvedRoot)
      .replaceAll('${CMAKE_CURRENT_SOURCE_DIR}', native);
    assert.ok(fs.existsSync(path.resolve(native, expanded)), `missing CMake source: ${entry}`);
  }
  assert.match(cmake, /"\$\{LENSDESK_ROOT\}\/dist"/);
  assert.match(cmake, /\$\{LENSDESK_ROOT\}\/src\/native/);
  const capture = fs.readFileSync(path.join(native, 'src/capture_service.cpp'), 'utf8');
  assert.match(capture, /#include "ocr_pipeline\.h"/);
  assert.ok(fs.existsSync(path.join(resolvedRoot, 'src/native/ocr_pipeline.h')));
});

test('nested Windows build selects the nested source and an isolated build directory', () => {
  const script = fs.readFileSync(path.join(root, 'apps/windows/scripts/build-windows-native.ps1'), 'utf8');
  const paths = Object.fromEntries([...script.matchAll(/\$(NativeSource|BuildDir) = Join-Path \$WorkspaceRoot "([^"]+)"/g)]
    .map(([, name, value]) => [name, path.resolve(root, ...value.split('\\'))]));
  assert.equal(paths.NativeSource, native);
  assert.equal(paths.BuildDir, path.join(root, 'apps/windows/build-native'));
  assert.match(script, /-S \$NativeSource -B \$BuildDir -A x64/);
  assert.match(script, /--build \$BuildDir --config Release --target RuntimeHost/);
  assert.match(script, /npm run build/);
  assert.doesNotMatch(script, /Remove-Item|Compress-Archive|build-windows-native\.ps1/i);
});
