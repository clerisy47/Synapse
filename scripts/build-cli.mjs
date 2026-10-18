import { execFileSync } from "node:child_process";
import { chmodSync, rmSync } from "node:fs";
rmSync(new URL("../dist/cli", import.meta.url), { recursive: true, force: true });
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "cli/tsconfig.json"], { stdio: "inherit" });
chmodSync(new URL("../dist/cli/main.js", import.meta.url), 0o755);
