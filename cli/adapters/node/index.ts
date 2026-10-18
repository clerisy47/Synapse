import { realpath, stat } from "node:fs/promises";
import type { WorkspacePort } from "../../core/index.js";

export const workspace: WorkspacePort = {
  async canonicalize(input) {
    const canonical = await realpath(input);
    if (!(await stat(canonical)).isDirectory()) throw new Error("workspace");
    return canonical;
  },
};
export { createReader } from "./reader.js";
export { frontmatter } from "./frontmatter.js";
