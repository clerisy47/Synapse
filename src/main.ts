import { Plugin } from "obsidian";

/** Composition root only — wiring lands in M1-T16. Keep load cheap and throw-free (AC-M1.3). */
export default class VaultSynapsePlugin extends Plugin {
  async onload(): Promise<void> {}

  onunload(): void {}
}
