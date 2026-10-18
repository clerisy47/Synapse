import { parseDocument } from "yaml";
import type { FrontmatterPort } from "../../core/index.js";
export const frontmatter: FrontmatterPort = {
  parse(text) {
    const lines = text.split(/\r?\n/u);
    if (lines[0] !== "---") return { fields: {}, body: text, bodyLine: 1 };
    const end = lines.indexOf("---", 1);
    if (end < 0) return undefined;
    try {
      const document = parseDocument(lines.slice(1, end).join("\n"), { uniqueKeys: true, strict: true });
      if (document.errors.length) return undefined;
      const fields: unknown = document.toJS({ maxAliasCount: 0 });
      return { fields, body: lines.slice(end + 1).join("\n"), bodyLine: end + 2 };
    } catch { return undefined; }
  },
};
