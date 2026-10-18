import { readFile, mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const [pkg, manifest, versions] = await Promise.all([
  json('package.json'), json('manifest.json'), json('versions.json'),
]);
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || pkg.version !== manifest.version ||
    versions[manifest.version] !== manifest.minAppVersion || manifest.isDesktopOnly !== true) {
  throw new Error('Release version, minimum host version or desktop identity mismatch');
}
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
if (tag && tag !== manifest.version) throw new Error('Release tag must equal manifest version');
const names = ['main.js', 'manifest.json', 'styles.css'];
for (const name of names) {
  const info = await stat(path.join(root, name));
  if (!info.isFile() || info.size === 0) throw new Error(`Missing or empty artifact: ${name}`);
}
const destination = path.join(root, 'dist', manifest.version);
await mkdir(destination, { recursive: true });
const unexpected = (await readdir(destination)).filter((name) => !names.includes(name));
if (unexpected.length) throw new Error('Unexpected files in release directory; inspect and remove them before packaging');
for (const name of names) await copyFile(path.join(root, name), path.join(destination, name));
console.log(`Release dry run: ${manifest.version}; exactly ${names.join(', ')} in dist/${manifest.version}`);
