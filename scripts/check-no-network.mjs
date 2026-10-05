#!/usr/bin/env node
/**
 * AC-M8.3: network APIs only in allowlisted transport files (DESIGN §2.2).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

/** Paths relative to repo root. Transport files may not exist yet. */
const ALLOWLIST = new Set([
  "src/adapters/node/http-transport.ts",
  "src/adapters/obsidian/request-url-transport.ts",
]);

const PATTERNS = [
  { name: "fetch", re: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
  { name: "WebSocket", re: /\bWebSocket\b/ },
  { name: "EventSource", re: /\bEventSource\b/ },
  { name: "sendBeacon", re: /\bsendBeacon\s*\(/ },
  { name: "requestUrl", re: /\brequestUrl\b/ },
  { name: "import node:http", re: /\bfrom\s+["']node:(https?|net)["']/ },
  { name: "require http", re: /\brequire\s*\(\s*["'](https?|net)["']\s*\)/ },
  { name: "import http module", re: /\bfrom\s+["'](https?|net)["']/ },
  { name: "dynamic import http", re: /\bimport\s*\(\s*["'](https?|net)["']\s*\)/ },
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
  if (ALLOWLIST.has(relative)) continue;

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
  console.error("check-no-network: forbidden network API usage outside allowlist:\n");
  for (const v of violations) {
    console.error(`  ${v.relative}:${v.line} [${v.api}] ${v.snippet}`);
  }
  process.exit(1);
}

console.log("check-no-network: ok");
