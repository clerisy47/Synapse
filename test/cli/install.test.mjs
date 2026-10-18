import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('allowlisted tarball installs and runs outside the repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'synapse-install-'));
  const exec = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    const [packed] = JSON.parse(exec('npm', ['pack','--json','--ignore-scripts','--pack-destination',dir], process.cwd()));
    const names = packed.files.map(f => f.path);
    assert(names.includes('dist/cli/main.js'));
    assert(names.every(p => p.startsWith('dist/cli/') || ['package.json','README.md','LICENSE'].includes(p)), names.join('\n'));
    exec('npm', ['install','--prefix',dir,'--ignore-scripts','--omit=dev','--no-audit','--no-fund',join(dir,packed.filename)], dir);
    assert.equal(exec(join(dir,'node_modules/.bin/synapse'), ['--version'], dir), '0.1.0\n');
    assert.match(exec(join(dir,'node_modules/.bin/synapse'), ['--help'], dir), /Usage: synapse/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
