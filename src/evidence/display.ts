/**
 * Quote display truncation (DESIGN §4.1 / OQ-12).
 */

/** Max quote chars shown in UI. Mirrors QUOTE_DISPLAY_CHARS in constants. */
export const QUOTE_DISPLAY_CHARS = 300;

/**
 * Truncate quote text for UI display. Does not alter stored excerpts.
 */
export function displayQuote(text: string, maxChars = QUOTE_DISPLAY_CHARS): string {
  if (maxChars <= 0) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
}
