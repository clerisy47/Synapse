import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { expect, it } from "vitest";
import type { NodeHttpTransport } from "../../src/adapters/node";

it("loads the bundled transport with a desktop CommonJS loader without an ESM import hook", async () => {
  const bundle = await build({
    stdin: { contents: 'export { NodeHttpTransport } from "./src/adapters/node/index.ts";', resolveDir: process.cwd() },
    bundle: true, write: false, platform: "node", format: "cjs", target: "es2020",
  });
  const pluginModule: { exports: { NodeHttpTransport?: typeof NodeHttpTransport } } = { exports: {} };
  runInNewContext(bundle.outputFiles[0]!.text, {
    module: pluginModule, exports: pluginModule.exports, require: createRequire(import.meta.url),
    URL, Buffer, setTimeout, clearTimeout,
  });
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end('{"status":"ok"}');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const transport = new pluginModule.exports.NodeHttpTransport!();
    const result = await transport.getJson(`http://127.0.0.1:${(server.address() as AddressInfo).port}/health`, { timeoutMs: 2000 });
    expect(result).toEqual({ status: 200, body: { status: "ok" } });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
