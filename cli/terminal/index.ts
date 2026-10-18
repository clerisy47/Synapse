import type { TerminalPort, WorkspacePort } from "../core/index.js";
import { strings } from "./strings.js";

// Escape controls visibly; application styling never comes from workspace text.
export function sanitize(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
export async function run(args: readonly string[], terminal: TerminalPort, workspace: WorkspacePort): Promise<number> {
  if (args.length === 1 && args[0] === "--help") { terminal.out(strings.help); return 0; }
  if (args.length === 1 && args[0] === "--version") { terminal.out("0.1.0\n"); return 0; }
  if (args.length !== 2 || args[0] !== "--workspace" || !args[1] || args[1].startsWith("--")) {
    terminal.error(strings.usage); return 2;
  }
  let root: string;
  try { root = await workspace.canonicalize(args[1]); }
  catch { terminal.error(strings.workspace); return 2; }
  if (!terminal.interactive) { terminal.error(strings.tty); return 2; }
  terminal.out(`Workspace: ${sanitize(root)}\n`);
  terminal.out(strings.pending);
  return 0;
}
