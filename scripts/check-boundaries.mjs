#!/usr/bin/env node
/**
 * Runs dependency-cruiser against DESIGN §2.2 module boundaries.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const config = path.join(ROOT, ".dependency-cruiser.cjs");

const result = spawnSync(
  "npx",
  ["dependency-cruiser", "--config", config, "src"],
  { cwd: ROOT, stdio: "inherit", shell: true },
);

process.exit(result.status ?? 1);
