import { describe, expect, it } from "vitest";
import { parseRoutingSettings, resolveDailyDestination } from "./index";

const settings = { version: 1, timezone: "UTC", destinations: [], daily: { id: "daily-log", folder: "Daily", filename: "YYYY-MM-DD.md", heading: "## Log" } };

describe("routing contracts", () => {
  it.each(["UTC", "Asia/Kathmandu", "America/New_York", "America/Port-au-Prince", "Etc/GMT+5"])("accepts IANA timezone %s", (timezone) => expect(parseRoutingSettings({ ...settings, timezone }).ok).toBe(true));
  it.each([
    null, { ...settings, version: 2 }, { ...settings, timezone: "Local" }, { ...settings, timezone: "+05:45" }, { ...settings, timezone: "Invalid/Unknown" },
    { ...settings, policy: "allow-all" }, { ...settings, daily: { ...settings.daily, filename: "{model-path}" } },
    { ...settings, daily: { ...settings.daily, folder: "../Private" } },
    { ...settings, daily: { ...settings.daily, heading: "Log\n# Secret" } },
    { ...settings, destinations: [{ id: "daily-log", path: "Notes/One.md" }] },
    { ...settings, destinations: [{ id: "one", path: "Notes/One.md" }, { id: "two", path: "notes/one.md" }] },
    { ...settings, destinations: [{ id: "one", path: "Notes/One.pdf" }] },
  ])("rejects conflicting, malformed or unsupported routing %#", (value) => expect(parseRoutingSettings(value).ok).toBe(false));
  it("constructs canonical paths only from explicit calendar dates", () => {
    const parsed = parseRoutingSettings({ ...settings, daily: { ...settings.daily, folder: "Journal\\Daily" } });
    if (!parsed.ok) throw new Error("Invalid fixture");
    expect(resolveDailyDestination(parsed.value, "2024-02-29")).toEqual({ ok: true, value: "Journal/Daily/2024-02-29.md" });
    for (const date of ["2023-02-29", "2026-04-31", "2026-13-01", "0000-01-01", "10/14/26", "tomorrow", "2026-10-14T12:00:00Z", "../../private"]) expect(resolveDailyDestination(parsed.value, date).ok).toBe(false);
  });
});
