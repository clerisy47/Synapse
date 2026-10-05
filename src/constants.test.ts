import { describe, expect, it } from "vitest";
import {
  EXCLUSION_FRONTMATTER_KEY,
  IS_DESKTOP_ONLY,
  PLUGIN_ID,
  PLUGIN_NAME,
} from "./constants";

describe("constants identity", () => {
  it("freezes plugin id and desktop-only flag", () => {
    expect(PLUGIN_ID).toBe("vault-synapse");
    expect(PLUGIN_NAME).toBe("Vault Synapse");
    expect(IS_DESKTOP_ONLY).toBe(true);
    expect(EXCLUSION_FRONTMATTER_KEY).toBe(PLUGIN_ID);
  });
});
