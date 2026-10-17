import type { ContentHash, PolicySnapshot } from "../core";

/** Implementation version binds approvals; no vault file grants access.
 * Provider selection, exclusions, MCP scopes and local approval remain separate gates. */
export const DEFAULT_ACCESS_POLICY: PolicySnapshot = Object.freeze({
  version: 1,
  hash: "b3ef6ff99059597eea3d98435b6ff072ffe92a7eba6c53ac61184a0cd30a1bfa" as ContentHash,
  rules: Object.freeze({ version: 1, defaults: Object.freeze({ internal: "allow", "remote-model": "allow", "external-client": "allow" }),
    rules: Object.freeze([
      { id: "reviewed-create", recipient: "internal", operation: "create", effect: "allow", selector: {} },
      { id: "reviewed-update", recipient: "internal", operation: "update", effect: "allow", selector: {} },
      { id: "scoped-inbox", recipient: "external-client", operation: "append-research", effect: "allow", selector: {} },
    ] as const),
  }),
});
