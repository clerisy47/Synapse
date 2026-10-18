import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run, sanitize } from '../../dist/cli/terminal/index.js';
const entry = resolve('dist/cli/main.js');
const invoke = (...args) => spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
test('help/version work without accessing a workspace', () => {
  assert.equal(invoke('--help').status, 0);
  assert.match(invoke('--help').stdout, /Usage: synapse/);
  assert.equal(invoke('--version').stdout, '0.1.0\n');
});
test('invalid arguments and inaccessible roots produce content-free errors', () => {
  for (const args of [[], ['--workspace'], ['--yes'], ['--workspace','/missing-private-workspace'], ['--help','--yes']]) {
    const result = invoke(...args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /missing-private|Error:| at /);
  }
});
test('canonical root validation and redirected input refusal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'synapse-test-'));
  try {
    symlinkSync(dir, join(dir, 'alias'));
    assert.equal(invoke('--workspace', join(dir, 'alias')).status, 2);
    assert.match(invoke('--workspace', dir).stderr, /requires a terminal/);
    writeFileSync(join(dir,'file'), '');
    assert.match(invoke('--workspace', join(dir,'file')).stderr, /not a directory/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('intentional root display escapes terminal controls', async () => {
  let output = '';
  const result = await run(['--workspace','requested'], { interactive: true, out: s => { output += s; }, error: () => assert.fail() }, { canonicalize: async () => '/root/\x1b]8;;evil\x07\u202e' });
  assert.equal(result, 0);
  assert.doesNotMatch(output, /[\x1b\x07\u202e]/u);
  assert.equal(sanitize('\x1b'), '\\u001b');
});
