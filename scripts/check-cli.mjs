import { readdirSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
function scan(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? scan(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
}
for (const path of scan("cli").filter(p => p.endsWith(".ts"))) {
  const text = readFileSync(path, "utf8");
  assert(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|node:(?:http|https|net|tls|child_process)/u.test(text), `${path}: unauthorized network/process API`);
  assert(!/\b(?:writeFile|appendFile|rename|unlink|mkdir|rm|createWriteStream)\b/u.test(text), `${path}: scaffold cannot mutate files`);
  if (path.includes("/core/")) assert(!/node:|\bprocess\b|adapters|terminal/u.test(text), `${path}: core boundary`);
  for (const match of text.matchAll(/from\s+["']([^"']+)["']/gu)) {
    assert(match[1].startsWith(".") || (path.includes("/adapters/node/") && (match[1].startsWith("node:") || match[1] === "yaml")), `${path}: import boundary`);
    assert(!match[1].includes("src/"), `${path}: legacy dependency`);
  }
}
console.log("CLI boundary, network and write checks passed; no model schemas exist yet.");
