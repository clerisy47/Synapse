#!/usr/bin/env node
import { workspace } from "./adapters/node/index.js";
import { run } from "./terminal/index.js";

process.exitCode = await run(process.argv.slice(2), {
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  out: text => { process.stdout.write(text); },
  error: text => { process.stderr.write(text); },
}, workspace);
