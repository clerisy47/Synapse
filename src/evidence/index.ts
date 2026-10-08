/**
 * evidence — segmentation, ledger, display truncation (DESIGN §3 / §5.6).
 * Anchor resolution is M3-T02.
 */

export { displayQuote, QUOTE_DISPLAY_CHARS } from "./display";

export type { PromptRenderResult } from "./ledger";
export { EvidenceLedger, titleFromPath } from "./ledger";

export type { SegmentOptions } from "./segment";
export {
  EXCERPT_CHARS_MAX,
  EXCERPT_CHARS_MIN,
  headingBefore,
  headingFor,
  segment,
  splitParagraphs,
} from "./segment";
