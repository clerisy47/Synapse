import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReader, frontmatter, workspace } from '../../dist/cli/adapters/node/index.js';
import { Corpus } from '../../dist/cli/corpus/index.js';
import { DEFAULT_POLICY } from '../../dist/cli/core/index.js';
const note = body => `---\ndescription: sample\ntags: [test]\naliases: []\n---\n${body}`;
async function fixture(action) {
 const dir = await mkdtemp(join(tmpdir(), 'synapse-corpus-'));
 try { await action(await workspace.canonicalize(dir)); } finally { await rm(dir,{ recursive:true, force:true }); }
}
test('reader refuses traversal, absolute paths, hidden content and symlink descendants', async () => fixture(async dir => {
 await writeFile(join(dir,'ok.md'), note('needle'));
 await mkdir(join(dir,'.git')); await writeFile(join(dir,'.git','secret.md'), 'secret');
 await symlink(join(dir,'ok.md'), join(dir,'link.md'));
 await symlink(dir, join(dir,'nested'));
 const reader = createReader(dir, DEFAULT_POLICY);
 assert.deepEqual(await reader.list(), ['ok.md']);
 for (const path of ['../ok.md',join(dir,'ok.md'),'link.md','nested/ok.md','.git/secret.md','a\\ok.md','C:/ok.md']) assert.equal(await reader.read(path), undefined);
}));
test('index excludes control, folder, tags and ignore notes before retrieval', async () => fixture(async dir => {
 await mkdir(join(dir,'Synapse')); await mkdir(join(dir,'private'));
 for (const path of ['Research.md','Synapse/Instructions.md','private/secret.md','.hidden.md']) await writeFile(join(dir,path), note('classified'));
 await writeFile(join(dir,'tagged.md'), note('classified').replace('[test]','[private]'));
 await writeFile(join(dir,'ignored.md'), note('classified').replace('description:', 'vault-synapse: ignore\ndescription:'));
 await writeFile(join(dir,'public.md'), note('# Public\nvisible'));
 const policy = { ...DEFAULT_POLICY, excludedFolders:['private'], excludedTags:['private'] };
 const corpus = new Corpus(createReader(dir, policy), frontmatter, policy);
 assert.deepEqual(await corpus.search('classified'), []);
 assert.deepEqual(corpus.attention, []);
 assert.equal((await corpus.search('visible'))[0].path, 'public.md');
}));
test('metadata attention and fatal UTF-8/oversize handling do not index bodies', async () => fixture(async dir => {
 await writeFile(join(dir,'missing.md'), 'privatebody');
 await writeFile(join(dir,'malformed.md'), '---\ntags: [\n---\nprivatebody');
 await writeFile(join(dir,'duplicate.md'), '---\ntags: [x]\ntags: [y]\n---\nprivatebody');
 await writeFile(join(dir,'invalid.md'), Buffer.from([0xff]));
 await writeFile(join(dir,'large.md'), 'a'.repeat(1_000_001));
 const corpus = new Corpus(createReader(dir, DEFAULT_POLICY), frontmatter, DEFAULT_POLICY);
 assert.deepEqual(await corpus.search('privatebody'), []);
 assert.equal(corpus.attention.length, 5);
}));
test('passages use body line coordinates and become unusable after change or exclusion', async () => fixture(async dir => {
 await writeFile(join(dir,'a.md'), note('# Heading\nneedle here\nlast'));
 const corpus = new Corpus(createReader(dir, DEFAULT_POLICY), frontmatter, DEFAULT_POLICY);
 const [passage] = await corpus.search('needle');
 assert.equal(passage.startLine, 7);
 assert.equal(passage.endLine, 8);
 assert.equal(passage.text, 'needle here\nlast');
 assert.deepEqual(await corpus.resolve(passage), passage);
 await writeFile(join(dir,'a.md'), note('different'));
 assert.equal(await corpus.resolve(passage), undefined);
 assert.deepEqual(await corpus.search('needle'), []);
 await writeFile(join(dir,'a.md'), note('needle').replace('description:', 'synapse: ignore\ndescription:'));
 assert.deepEqual(await corpus.search('needle'), []);
}));
test('native watcher invalidates on a filesystem change and closes', async () => fixture(async dir => {
 const reader = createReader(dir, DEFAULT_POLICY);
 let stop;
 const changed = new Promise((resolve,reject) => {
  const timer = setTimeout(() => { stop?.(); reject(new Error('watch timeout')); }, 5000);
  stop = reader.watch(() => { clearTimeout(timer); resolve(); });
 });
 try { await writeFile(join(dir,'new.md'),note('new')); await changed; }
 finally { stop?.(); }
}));
test('links/backlinks and recent discovery stay within eligible notes', async () => fixture(async dir => {
 await writeFile(join(dir,'a.md'),note('[[b]] [private](Research.md) [remote](https://example.com)'));
 await writeFile(join(dir,'b.md'),note('target'));
 await writeFile(join(dir,'Research.md'),note('private'));
 const corpus = new Corpus(createReader(dir, DEFAULT_POLICY), frontmatter, DEFAULT_POLICY);
 assert.deepEqual(await corpus.neighbors('a.md'), ['b.md']);
 assert.deepEqual(await corpus.neighbors('b.md'), ['a.md']);
 assert.deepEqual(new Set(await corpus.recent()), new Set(['a.md','b.md']));
}));
test('directory traversal depth has a hard bound', async () => fixture(async dir => {
 let nested = dir;
 for (let depth = 0; depth < 34; depth++) { nested = join(nested,'d'); await mkdir(nested); }
 await writeFile(join(nested,'a.md'), note('deep'));
 await assert.rejects(createReader(dir, DEFAULT_POLICY).list(), /workspace-capacity/);
}));
