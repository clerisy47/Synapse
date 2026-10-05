#!/usr/bin/env node
/**
 * AC-M8.5 prep: vault write APIs banned in src/ (DESIGN §2.2).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

const PATTERNS = [
  { name: "vault.modify", re: /\bvault\.modify\s*\(/ },
  { name: "vault.create", re: /\bvault\.create\s*\(/ },
  { name: "vault.delete", re: /\bvault\.delete\s*\(/ },
  { name: "vault.rename", re: /\bvault\.rename\s*\(/ },
  { name: "vault.trash", re: /\bvault\.trash\s*\(/ },
  { name: "processFrontMatter", re: /\bprocessFrontMatter\b/ },
  { name: "vault.adapter.write", re: /\.adapter\.write\b/ },
  { name: "vault.adapter.append", re: /\.adapter\.append\b/ },
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (/\.(ts|tsx|js|mjs)$/.test(ent.name)) {
      files.push(full);
    }
  }
  return files;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

const violations = [];

for (const file of await walk(SRC)) {
  const relative = rel(file);
  const text = await readFile(file, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) {
        violations.push({ relative, line: i + 1, api: name, snippet: trimmed.slice(0, 80) });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("check-no-writes: forbidden vault write API in src/:\n");
  for (const v of violations) {
    console.error(`  ${v.relative}:${v.line} [${v.api}] ${v.snippet}`);
  }
  process.exit(1);
}

console.log("check-no-writes: ok");
