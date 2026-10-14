import { err, ok, type Result } from "./result";
import { synapseError } from "./errors";
import type { ControlPaths } from "./control-contracts";
import type { VaultPath } from "./types";

function invalid(code: string): Result<never> {
  return err(synapseError({ code: "SCHEMA_INVALID", retryable: false, message: "Invalid control contract", detail: { issueCode: code } }));
}

/** No decoding or traversal cleanup: invalid input must not become an allowed path. */
export function validateVaultPath(input: string, kind: "markdown" | "folder" = "markdown"): Result<VaultPath> {
  const path = input.replace(/\\/g, "/");
  if (!path || path !== path.trim() || ([...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || /[:#?%<>|*"]/.test(path)) || path.startsWith("/") || path.endsWith("/") || path.split("/").some((part) => !part || part === "." || part === ".." || part !== part.trim()) || (kind === "markdown" && !path.endsWith(".md"))) {
    return invalid("INVALID_VAULT_PATH");
  }
  // Obsidian's configuration and hidden filesystem segments are never note destinations.
  if (path.split("/").some((part) => part.startsWith("."))) return invalid("INVALID_VAULT_PATH");
  return ok(path as VaultPath);
}

export function validateControlPaths(input: { instructions: string; security: string; research: string }): Result<ControlPaths> {
  const instructions = validateVaultPath(input.instructions);
  const security = validateVaultPath(input.security);
  const research = validateVaultPath(input.research);
  if (!instructions.ok) return instructions;
  if (!security.ok) return security;
  if (!research.ok) return research;
  const paths = [instructions.value, security.value, research.value];
  // Case-fold collision check is conservative on case-sensitive vaults and safe on macOS.
  if (new Set(paths.map((path) => path.toLowerCase())).size !== paths.length) return invalid("CONTROL_PATH_COLLISION");
  return ok({ instructions: instructions.value, security: security.value, research: research.value });
}
