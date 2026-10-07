/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-no-outward-deps",
      comment: "core/ imports nothing outside core (DESIGN §2.2)",
      severity: "error",
      from: { path: "^src/core/", pathNot: "\\.test\\.ts$" },
      to: { pathNot: "^src/core/" },
    },
    {
      name: "obsidian-only-adapters-and-main",
      comment: "obsidian only in adapters/obsidian and main.ts",
      severity: "error",
      from: { pathNot: "^(src/adapters/obsidian/|src/main\\.ts$)" },
      to: { path: "node_modules/obsidian" },
    },
    {
      name: "electron-only-adapters",
      comment: "electron only in adapters/obsidian",
      severity: "error",
      from: { pathNot: "^src/adapters/obsidian/" },
      to: { path: "node_modules/electron" },
    },
    {
      name: "ui-no-adapters",
      comment: "ui never imports adapters",
      severity: "error",
      from: { path: "^src/ui/" },
      to: { path: "^src/adapters/" },
    },
    {
      name: "no-deep-module-imports",
      comment: "Import via module index.ts only (not main.ts)",
      severity: "error",
      from: {
        path: "^src/",
        pathNot:
          "^src/main\\.ts$|^src/(config|state|policy|evidence|jobs|llm|pdf|corpus|tools|compare|agent|contradiction|resurface|core|adapters|ui)/",
      },
      to: {
        path: "^src/(config|state|policy|evidence|jobs|llm|pdf|corpus|tools|compare|agent|contradiction|resurface|core|adapters|ui)/",
        pathNot: "/index\\.(ts|tsx|js)$",
      },
    },
    {
      name: "ui-deps",
      comment: "ui may import core, jobs, constants; never adapters (separate rule)",
      severity: "error",
      from: { path: "^src/ui/" },
      to: {
        path: "^src/",
        pathNot: "^(src/core/|src/jobs/|src/constants\\.ts$|src/ui/)",
      },
    },
    {
      name: "config-deps",
      comment: "config may import core and constants",
      severity: "error",
      from: { path: "^src/config/" },
      to: {
        path: "^src/",
        pathNot: "^(src/core/|src/config/|src/constants\\.ts$)",
      },
    },
    {
      name: "state-deps",
      comment: "state may import core, config, and constants",
      from: { path: "^src/state/" },
      to: {
        path: "^src/",
        pathNot: "^(src/core/|src/config/|src/state/|src/constants\\.ts$)",
      },
    },
    {
      name: "policy-deps",
      from: { path: "^src/policy/" },
      to: {
        path: "^src/",
        pathNot: "^(src/core/|src/config/|src/policy/)",
      },
    },
    {
      name: "evidence-deps",
      from: { path: "^src/evidence/" },
      to: {
        path: "^src/",
        pathNot: "^(src/core/|src/evidence/)",
      },
    },
    {
      name: "jobs-deps",
      from: { path: "^src/jobs/" },
      to: {
        path: "^src/",
        pathNot: "^(src/core/|src/jobs/)",
      },
    },
    {
      name: "llm-deps",
      from: { path: "^src/llm/" },
      to: {
        path: "^src/",
        pathNot: "^(src/core/|src/config/|src/llm/|src/constants\\.ts$)",
      },
    },
    {
      name: "pdf-deps",
      from: { path: "^src/pdf/" },
      to: {
        path: "^src/",
        pathNot: "^(src/core/|src/pdf/)",
      },
    },
    {
      name: "corpus-deps",
      from: { path: "^src/corpus/" },
      to: {
        path: "^src/",
        pathNot: "^(src/core/|src/policy/|src/evidence/|src/corpus/)",
      },
    },
    {
      name: "tools-deps",
      from: { path: "^src/tools/" },
      to: {
        path: "^src/",
        pathNot: "^(src/core/|src/evidence/|src/tools/)",
      },
    },
    {
      name: "compare-deps",
      from: { path: "^src/compare/" },
      to: {
        path: "^src/",
        pathNot: "^(src/core/|src/evidence/|src/llm/|src/compare/)",
      },
    },
    {
      name: "agent-deps",
      from: { path: "^src/agent/" },
      to: {
        path: "^src/",
        pathNot:
          "^(src/core/|src/evidence/|src/tools/|src/llm/|src/jobs/|src/agent/)",
      },
    },
    {
      name: "contradiction-deps",
      from: { path: "^src/contradiction/" },
      to: {
        path: "^src/",
        pathNot:
          "^(src/core/|src/evidence/|src/tools/|src/compare/|src/state/|src/contradiction/)",
      },
    },
    {
      name: "resurface-deps",
      from: { path: "^src/resurface/" },
      to: {
        path: "^src/",
        pathNot:
          "^(src/core/|src/evidence/|src/compare/|src/state/|src/resurface/)",
      },
    },
    {
      name: "adapters-deps",
      from: { path: "^src/adapters/" },
      to: {
        path: "^src/",
        pathNot: "^(src/core/|src/adapters/)",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
  },
};
