import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

const adapterObsidian = "src/adapters/obsidian/**";
const adapterNode = "src/adapters/node/**";
const compositionRoot = "src/main.ts";

export default defineConfig([
  {
    ignores: [
      "main.js",
      "main.js.map",
      "node_modules/**",
      "spikes/**",
      "eval/reports/**",
      "scripts/**",
      "esbuild.config.mjs",
      ".dependency-cruiser.cjs",
      "vitest.config.ts",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      "obsidianmd/sample-names": "off",
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: [compositionRoot, adapterObsidian, adapterNode],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "obsidian",
              message:
                "Import obsidian only from src/main.ts or src/adapters/obsidian/** (DESIGN §2.2).",
            },
            {
              name: "electron",
              message: "Import electron only from src/adapters/obsidian/**.",
            },
          ],
          patterns: [
            {
              group: [
                "node:*",
                "fs",
                "path",
                "http",
                "https",
                "net",
                "child_process",
              ],
              message:
                "Node built-ins only in src/adapters/node/** (DESIGN §2.2).",
            },
          ],
        },
      ],
    },
  },
  {
    files: [adapterObsidian],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "fs", "http", "https", "net", "child_process"],
              message: "Node I/O belongs in src/adapters/node/**.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [adapterNode],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "obsidian",
              message: "Obsidian API only in src/adapters/obsidian/**.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/ui/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/adapters/**", "**/adapters/*"],
              message: "ui must not import adapters (DESIGN §2.2).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.property.name='innerHTML'], MemberExpression[object.property.name='outerHTML']",
          message:
            "Do not assign innerHTML/outerHTML with untrusted text (DESIGN §8.1).",
        },
      ],
    },
  },
]);
