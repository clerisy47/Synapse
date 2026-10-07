import { describe, expect, it } from "vitest";

import { TransportError } from "../core";
import {
  createEndpointPolicy,
  type EndpointPolicy,
} from "./index";

function openRouterPolicy(
  overrides?: Partial<{
    endpointAckHost: string | null;
    openRouterHosts: readonly string[];
  }>,
): EndpointPolicy {
  return createEndpointPolicy({
    provider: "openrouter",
    endpointAckHost: overrides?.endpointAckHost ?? null,
    ...(overrides?.openRouterHosts !== undefined
      ? { openRouterHosts: overrides.openRouterHosts }
      : {}),
  });
}

function ollamaPolicy(
  endpointAckHost: string | null = null,
): EndpointPolicy {
  return createEndpointPolicy({
    provider: "ollama",
    endpointAckHost,
  });
}

describe("createEndpointPolicy Phase A (openrouter)", () => {
  it("allows openrouter.ai API URLs", () => {
    const p = openRouterPolicy();
    expect(p.check("https://openrouter.ai/api/v1")).toEqual({ ok: true });
    expect(
      p.check("https://openrouter.ai/api/v1/chat/completions"),
    ).toEqual({ ok: true });
  });

  it("allows OpenRouter subdomains", () => {
    const p = openRouterPolicy();
    expect(p.check("https://api.openrouter.ai/api/v1")).toEqual({ ok: true });
  });

  it("blocks non-allowlisted hosts", () => {
    const p = openRouterPolicy();
    expect(p.check("https://evil.example/api")).toEqual({
      ok: false,
      reason: "not_allowlisted",
    });
  });

  it("blocks loopback under Phase A", () => {
    const p = openRouterPolicy();
    expect(p.check("http://127.0.0.1:11434")).toEqual({
      ok: false,
      reason: "not_allowlisted",
    });
    expect(p.check("http://localhost:11434")).toEqual({
      ok: false,
      reason: "not_allowlisted",
    });
  });

  it("blocks invalid URLs", () => {
    const p = openRouterPolicy();
    expect(p.check("not a url")).toEqual({
      ok: false,
      reason: "invalid_url",
    });
    expect(p.check("ftp://openrouter.ai/x")).toEqual({
      ok: false,
      reason: "invalid_url",
    });
  });

  it("assertAllowed throws TransportError blocked", () => {
    const p = openRouterPolicy();
    expect(() => p.assertAllowed("https://evil.example")).toThrow(
      TransportError,
    );
    try {
      p.assertAllowed("https://evil.example");
    } catch (e) {
      expect(e).toBeInstanceOf(TransportError);
      expect((e as TransportError).kind).toBe("blocked");
    }
    expect(() =>
      p.assertAllowed("https://openrouter.ai/api/v1"),
    ).not.toThrow();
  });

  it("requiresEgressWarning for allowlisted cloud hosts only", () => {
    const p = openRouterPolicy();
    expect(p.requiresEgressWarning("https://openrouter.ai/api/v1")).toBe(
      true,
    );
    expect(p.requiresEgressWarning("https://evil.example")).toBe(false);
    expect(p.requiresEgressWarning("not a url")).toBe(false);
  });
});

describe("createEndpointPolicy Phase B stub (ollama)", () => {
  it("allows loopback", () => {
    const p = ollamaPolicy();
    expect(p.check("http://127.0.0.1:11434")).toEqual({ ok: true });
    expect(p.check("http://localhost:11434/api/chat")).toEqual({ ok: true });
    expect(p.check("http://[::1]:11434")).toEqual({ ok: true });
  });

  it("blocks non-loopback until endpointAckHost matches", () => {
    const blocked = ollamaPolicy(null);
    expect(blocked.check("https://remote.example:11434")).toEqual({
      ok: false,
      reason: "non_loopback_unacked",
    });

    const acked = ollamaPolicy("remote.example");
    expect(acked.check("https://remote.example:11434")).toEqual({ ok: true });
    expect(acked.check("https://other.example")).toEqual({
      ok: false,
      reason: "non_loopback_unacked",
    });
  });

  it("does not require egress warning for ollama", () => {
    const p = ollamaPolicy();
    expect(p.requiresEgressWarning("http://127.0.0.1:11434")).toBe(false);
  });
});
