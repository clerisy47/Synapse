import { err, synapseError, type Result, type RoutingSettings, type VaultPath } from "../core";
import { resolveDailyDestination } from "./contracts";

/** Only trusted clock instants, explicit ISO dates, and three exact relative tokens. */
export function routeDaily(routing: RoutingSettings, input: string | number, now: number): Result<VaultPath> {
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) return resolveDailyDestination(routing, input);
  let instant: number;
  let shift = 0;
  if (typeof input === "number") instant = input;
  else if (["today", "yesterday", "tomorrow"].includes(input)) {
    instant = now;
    shift = input === "yesterday" ? -1 : input === "tomorrow" ? 1 : 0;
  } else {
    return err(synapseError({ code: "SCHEMA_INVALID", retryable: false, message: "Choose an explicit calendar date", detail: { issueCode: "AMBIGUOUS_DATE" } }));
  }
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone: routing.timezone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", era: "short" }).formatToParts(new Date(instant));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    if (get("era") !== "AD") throw new Error("date");
    const date = `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
    const calendar = new Date(`${date}T00:00:00Z`);
    calendar.setUTCDate(calendar.getUTCDate() + shift);
    return resolveDailyDestination(routing, calendar.toISOString().slice(0, 10));
  } catch {
    return err(synapseError({ code: "SCHEMA_INVALID", retryable: false, message: "Invalid routing date or timezone", detail: { issueCode: "INVALID_DATE" } }));
  }
}
