/** Standalone composition root; not part of the production plugin build. */
import { createGateBPlugin } from "../../src/adapters/obsidian";
import { GATE_B } from "../../src/ui";

export default createGateBPlugin(GATE_B);
