import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRoutingSettings } from "../../src/instructions";
import { AccessContextSchema, parseSecurityRules } from "../../src/policy";
import { CONTROL_LIMITS } from "../../src/constants";

function frontmatter(name: string): unknown {
  const markdown = readFileSync(new URL(`../../assets/control-files/${name}.md`, import.meta.url), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!match) throw new Error("Missing template frontmatter");
  return JSON.parse(match[1]!);
}

describe("repository-only starter templates", () => {
  it("provides deterministic UTC daily-log routing", () => {
    const parsed = parseRoutingSettings(frontmatter("Instructions"));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.daily).toEqual({ id: "daily-log", folder: "Daily", filename: "YYYY-MM-DD.md", heading: "## Log" });
  });
  it("bounds contracts without relaxing model-output schema restrictions", () => {
    const value = { version: 1, defaults: { internal: "allow", "remote-model": "deny", "external-client": "deny" } };
    const rule = { id: "rule", recipient: "internal", operation: "read", effect: "allow", selector: {} };
    expect(parseSecurityRules({ ...value, rules: Array.from({ length: CONTROL_LIMITS.rules + 1 }, (_, i) => ({ ...rule, id: `rule-${i}` })) }).ok).toBe(false);
    const routing = frontmatter("Instructions") as Record<string, unknown>;
    expect(parseRoutingSettings({ ...routing, destinations: Array.from({ length: CONTROL_LIMITS.destinations + 1 }, (_, i) => ({ id: `note-${i}`, path: `Notes/${i}.md` })) }).ok).toBe(false);
  });
  it("validates context data without allowing arbitrary scopes or client approval", () => {
    const context = { recipient: "external-client", purpose: "query", clientId: "paired-client", capabilities: ["query-vault"], policyHash: "a".repeat(64) };
    expect(AccessContextSchema.safeParse(context).success).toBe(true);
    expect(AccessContextSchema.safeParse({ ...context, clientId: "" }).success).toBe(false);
    expect(AccessContextSchema.safeParse({ ...context, capabilities: ["apply"] }).success).toBe(false);
    expect(AccessContextSchema.safeParse({ ...context, capabilities: ["query-vault", "query-vault"] }).success).toBe(false);
    expect(AccessContextSchema.safeParse({ ...context, approved: true }).success).toBe(false);
  });
});

it("bundles the exact repository starter contents", async () => {
  const { CONTROL_STARTERS } = await import("../../src/instructions");
  expect(Object.keys(CONTROL_STARTERS)).toEqual(["instructions"]);
  expect(CONTROL_STARTERS.instructions).toBe(readFileSync(new URL("../../assets/control-files/Instructions.md", import.meta.url), "utf8"));
});
