/**
 * EndpointPolicy — Phase A OpenRouter allowlist; Phase B loopback + ack (DESIGN §5.2 / §8.1).
 * Pure: no sockets. Transport injects assertAllowed as EndpointChecker.
 */

import type { ProviderId } from "../config";
import { TransportError } from "../core";

const DEFAULT_OPENROUTER_HOSTS = ["openrouter.ai"] as const;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export type EndpointBlockReason =
  | "not_allowlisted"
  | "non_loopback_unacked"
  | "invalid_url";

export type EndpointCheckResult =
  | { ok: true }
  | { ok: false; reason: EndpointBlockReason };

export interface EndpointPolicyOptions {
  provider: ProviderId;
  endpointAckHost: string | null;
  /** Hostname allowlist for Phase A (default: openrouter.ai + subdomains). */
  openRouterHosts?: readonly string[];
}

export interface EndpointPolicy {
  check(url: string): EndpointCheckResult;
  /** Throws TransportError { kind: "blocked" } when check fails. */
  assertAllowed(url: string): void;
  /** True for Phase A allowlisted cloud hosts (settings first-use warning). */
  requiresEgressWarning(url: string): boolean;
}

export function createEndpointPolicy(
  opts: EndpointPolicyOptions,
): EndpointPolicy {
  const openRouterHosts = opts.openRouterHosts ?? DEFAULT_OPENROUTER_HOSTS;

  function parseHostname(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      // URL.hostname may keep brackets for IPv6 (e.g. "[::1]").
      return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    } catch {
      return null;
    }
  }

  function isOpenRouterHost(hostname: string): boolean {
    for (const allowed of openRouterHosts) {
      const base = allowed.toLowerCase();
      if (hostname === base || hostname.endsWith(`.${base}`)) {
        return true;
      }
    }
    return false;
  }

  function isLoopback(hostname: string): boolean {
    return LOOPBACK_HOSTS.has(hostname);
  }

  function check(url: string): EndpointCheckResult {
    const hostname = parseHostname(url);
    if (hostname === null) {
      return { ok: false, reason: "invalid_url" };
    }

    if (opts.provider === "openrouter") {
      if (isOpenRouterHost(hostname)) {
        return { ok: true };
      }
      return { ok: false, reason: "not_allowlisted" };
    }

    // Phase B (ollama): loopback default; other hosts need acknowledgement.
    if (isLoopback(hostname)) {
      return { ok: true };
    }
    const ack = opts.endpointAckHost?.toLowerCase() ?? null;
    if (ack !== null && hostname === ack) {
      return { ok: true };
    }
    return { ok: false, reason: "non_loopback_unacked" };
  }

  function assertAllowed(url: string): void {
    const result = check(url);
    if (!result.ok) {
      throw new TransportError({
        kind: "blocked",
        message: result.reason,
      });
    }
  }

  function requiresEgressWarning(url: string): boolean {
    if (opts.provider !== "openrouter") {
      return false;
    }
    const hostname = parseHostname(url);
    if (hostname === null) {
      return false;
    }
    return isOpenRouterHost(hostname);
  }

  return { check, assertAllowed, requiresEgressWarning };
}
