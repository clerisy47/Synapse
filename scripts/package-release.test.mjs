import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'synapse-release-'));
  try {
    await mkdir(path.join(root, 'scripts'));
    await copyFile(new URL('./package-release.mjs', import.meta.url), path.join(root, 'scripts/package-release.mjs'));
    for (const [name, data] of Object.entries({
      'package.json': '{"version":"0.1.0"}',
      'manifest.json': '{"version":"0.1.0","minAppVersion":"1.8.7","isDesktopOnly":true}',
      'versions.json': '{"0.1.0":"1.8.7"}',
      'main.js': 'module.exports = {};', 'styles.css': '.syn-chat {}',
      '.env': 'PRIVATE_SENTINEL',
    })) await writeFile(path.join(root, name), data);
    await run(root, (env = {}) => spawnSync(process.execPath, ['scripts/package-release.mjs'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_REF_TYPE: '', ...env },
    }));
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('packages only install files and preserves exact bytes', () => fixture(async (root, run) => {
  assert.equal(run().status, 0);
  const destination = path.join(root, 'dist/0.1.0');
  assert.deepEqual((await readdir(destination)).sort(), ['main.js', 'manifest.json', 'styles.css']);
  for (const name of await readdir(destination)) {
    assert.deepEqual(await readFile(path.join(destination, name)), await readFile(path.join(root, name)));
  }
}));
test('refuses version drift and mismatched release tags', () => fixture(async (root, run) => {
  assert.notEqual(run({ GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: '0.2.0' }).status, 0);
  await writeFile(path.join(root, 'package.json'), '{"version":"0.2.0"}');
  assert.notEqual(run().status, 0);
}));
test('refuses missing artifacts and unexpected staged files', () => fixture(async (root, run) => {
  await rm(path.join(root, 'styles.css'));
  assert.notEqual(run().status, 0);
  await writeFile(path.join(root, 'styles.css'), '.syn-chat {}');
  assert.equal(run().status, 0);
  await writeFile(path.join(root, 'dist/0.1.0/data.json'), 'PRIVATE_SENTINEL');
  assert.notEqual(run().status, 0);
}));
