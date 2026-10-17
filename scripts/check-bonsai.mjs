/** Synthetic production Bonsai provider smoke; never reads a vault.
 * Start the Bonsai 4B llama-server on 127.0.0.1:18080, then:
 * node scripts/check-bonsai.mjs
 */
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: 'export { MODEL_OUTPUT_SCHEMAS, MODEL_OUTPUT_JSON_SCHEMAS } from "./src/llm/index.ts"; export { BonsaiClient, OpenRouterHealthChecker } from "./src/llm/index.ts"; export { NodeHttpTransport } from "./src/adapters/node/index.ts"; export { createEndpointPolicy } from "./src/policy/index.ts"; export { createJobQueue } from "./src/jobs/index.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, platform: "node", format: "esm",
});
const { MODEL_OUTPUT_SCHEMAS: schemas, createJobQueue, BonsaiClient, NodeHttpTransport, createEndpointPolicy } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const cases = [
  ["health", 'Return {"ok":true}.', v => v.ok === true],
  ["qa.plan", 'Plan a search for the launch date of Project Cedar. Use search_text, terms ["Cedar"], empty phrases, null tag and days, expand_graph false.',
    v => v.searches.some(s => s.tool === "search_text" && s.terms.includes("Cedar"))],
  ["qa.select", 'The question asks when Cedar launches. Excerpt e1 contains its launch date. Select e1 and set enough true.',
    v => v.enough && v.read.length === 1 && v.read[0] === "e1"],
  ["qa.answer", 'Question: When does Cedar launch? Evidence e1: Cedar launches on 2030-04-12. Answer with one claim citing e1 and null followup.',
    v => v.status === "answered" && v.claims.length === 1 && v.claims[0].text.includes("2030-04-12") && v.claims[0].sources.length === 1 && v.claims[0].sources[0] === "e1"],
  ["qa.answer", 'Question: What is the launch budget? No evidence is available. Return insufficient, empty claims and null followup.',
    v => v.status === "insufficient" && v.claims.length === 0],
  ["research.propose", 'Draft one change for destinationId d1 using evidence e1: Cedar launches on 2030-04-12. Include that date in markdown. Use only these IDs.',
    v => v.changes.length === 1 && v.changes[0].destinationId === "d1" && v.changes[0].markdown.includes("2030-04-12") && v.changes[0].evidenceIds.length === 1 && v.changes[0].evidenceIds[0] === "e1"],
];
const transport = new NodeHttpTransport({ checkEndpoint: createEndpointPolicy({ provider: "bonsai", endpointAckHost: null }).assertAllowed });
const model = new BonsaiClient({ transport, endpoint: "http://127.0.0.1:18080/v1", model: "bonsai-2-4b" });
const queue = createJobQueue({ clock: {
  now: () => Date.now(), mono: () => performance.now(),
  todayLocal: () => new Date().toLocaleDateString("en-CA"),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  yieldNow: () => new Promise(resolve => setTimeout(resolve, 0)),
} });
let failures = 0;
try {
  for (const [index, [kind, prompt, check]] of cases.entries()) {
    const started = performance.now();
    const result = await queue.submit({
      kind: kind === "research.propose" ? "research" : "qa", label: "Synthetic Bonsai trial",
      async run(ctx) {
        const response = await model.generate({ kind, instructions: prompt, input: "{}", schema: schemas[kind], numPredict: 1024 }, ctx.signal);
        if (!response.ok) return response;
        return { ok: true, value: { schemaValid: true, correct: check(response.value.value), ...(index === 3 ? { expectedDate: response.value.value.claims?.[0]?.text.includes("2030-04-12"), oneClaim: response.value.value.claims?.length === 1, expectedSource: response.value.value.claims?.[0]?.sources?.[0] === "e1" } : {}), tokens: response.value.usage.outputTokens } };
      },
    }).result;
    const metrics = result.ok ? result.value : { schemaValid: false, correct: false, error: result.error.code };
    if (!metrics.correct) failures++;
    console.log(JSON.stringify({ case: index + 1, kind, ...metrics, elapsedMs: Math.round(performance.now() - started) }));
  }
} finally {
  queue.dispose();
}
process.exitCode = failures ? 1 : 0;
