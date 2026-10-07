/**
 * Pure settings viewmodel (AC-M8.2 / DESIGN §4.5 / §8.1).
 * Derives warning flags via EndpointPolicy; never embeds API key material in
 * warning/notice strings. Composition root (M1-T16) owns Obsidian Setting UI.
 */

import type { Settings, TransportMode } from "../../config";
import { createEndpointPolicy } from "../../policy";
import { ACTIONS, SETTINGS } from "../strings/en";

/** Keys whose change must invalidate health (DESIGN §4.5). */
export const HEALTH_INVALIDATING_KEYS = [
  "endpoint",
  "model",
  "numCtx",
] as const satisfies ReadonlyArray<keyof Settings>;

export type HealthInvalidatingKey = (typeof HEALTH_INVALIDATING_KEYS)[number];

export type SettingsFieldKey =
  | "endpoint"
  | "apiKey"
  | "model"
  | "numCtx"
  | "provider"
  | "transport"
  | "excludedFolders"
  | "excludedTags"
  | "endpointAckHost";

export interface SettingsFieldVm {
  key: SettingsFieldKey;
  label: string;
  description: string;
  /** Display/edit value for text-like fields (apiKey may be raw for binding). */
  value: string;
  /** Dropdown options when the field is a select. */
  options?: ReadonlyArray<{ value: string; label: string }>;
}

export interface SettingsWarningVm {
  kind: "egress" | "non_loopback" | "endpoint_blocked" | "degraded_transport";
  text: string;
  cssModifier: string;
}

export interface SettingsVm {
  fields: ReadonlyArray<SettingsFieldVm>;
  warnings: ReadonlyArray<SettingsWarningVm>;
  showEgressWarning: boolean;
  showNonLoopbackWarning: boolean;
  showEndpointBlocked: boolean;
  showDegradedTransport: boolean;
  missingApiKey: boolean;
  /** Phase B ack action label when non-loopback warning is shown. */
  acknowledgeLabel: string | null;
  /** True when any telemetry-like control would appear — always false in v1. */
  hasTelemetryToggle: boolean;
}

export interface SettingsChangeEffects {
  invalidatesHealth: boolean;
}

const HEALTH_KEY_SET: ReadonlySet<string> = new Set(HEALTH_INVALIDATING_KEYS);

const TRANSPORT_OPTIONS: ReadonlyArray<{
  value: TransportMode;
  label: string;
}> = [
  { value: "auto", label: SETTINGS.transportAuto },
  { value: "node", label: SETTINGS.transportNode },
  { value: "requestUrl", label: SETTINGS.transportRequestUrl },
];

function joinLines(values: readonly string[]): string {
  return values.join("\n");
}

/**
 * Which settings keys invalidate the health fingerprint when changed.
 */
export function settingsChangeEffects(
  changedKeys: ReadonlyArray<string>,
): SettingsChangeEffects {
  for (const key of changedKeys) {
    if (HEALTH_KEY_SET.has(key)) {
      return { invalidatesHealth: true };
    }
  }
  return { invalidatesHealth: false };
}

/**
 * Map a settings snapshot to display fields and AC-M8.2 warning state.
 */
export function toSettingsVm(settings: Settings): SettingsVm {
  const policy = createEndpointPolicy({
    provider: settings.provider,
    endpointAckHost: settings.endpointAckHost,
  });
  const endpointCheck = policy.check(settings.endpoint);
  const showEgressWarning = policy.requiresEgressWarning(settings.endpoint);
  const showNonLoopbackWarning =
    settings.provider === "ollama" &&
    !endpointCheck.ok &&
    endpointCheck.reason === "non_loopback_unacked";
  const showEndpointBlocked = !endpointCheck.ok && !showNonLoopbackWarning;
  const showDegradedTransport = settings.transport === "requestUrl";
  const missingApiKey =
    settings.provider === "openrouter" &&
    (settings.apiKey === null || settings.apiKey.length === 0);

  const warnings: SettingsWarningVm[] = [];
  if (showEgressWarning) {
    warnings.push({
      kind: "egress",
      text: SETTINGS.egressWarning,
      cssModifier: "egress",
    });
  }
  if (showNonLoopbackWarning) {
    warnings.push({
      kind: "non_loopback",
      text: SETTINGS.nonLoopbackWarning,
      cssModifier: "non-loopback",
    });
  }
  if (showEndpointBlocked) {
    warnings.push({
      kind: "endpoint_blocked",
      text: SETTINGS.endpointBlocked,
      cssModifier: "blocked",
    });
  }
  if (showDegradedTransport) {
    warnings.push({
      kind: "degraded_transport",
      text: SETTINGS.degradedTransport,
      cssModifier: "degraded",
    });
  }

  const fields: SettingsFieldVm[] = [
    {
      key: "endpoint",
      label: SETTINGS.endpoint,
      description: SETTINGS.endpointDesc,
      value: settings.endpoint,
    },
    {
      key: "apiKey",
      label: SETTINGS.apiKey,
      description: missingApiKey
        ? `${SETTINGS.apiKeyDesc} ${SETTINGS.apiKeyMissing}`
        : SETTINGS.apiKeyDesc,
      value: settings.apiKey ?? "",
    },
    {
      key: "model",
      label: SETTINGS.model,
      description: SETTINGS.modelDesc,
      value: settings.model,
    },
    {
      key: "numCtx",
      label: SETTINGS.numCtx,
      description: SETTINGS.numCtxDesc,
      value: String(settings.numCtx),
    },
    {
      key: "provider",
      label: SETTINGS.provider,
      description: SETTINGS.providerDesc,
      value: settings.provider,
      options: [
        { value: "openrouter", label: "OpenRouter" },
        { value: "ollama", label: "Ollama (Phase B)" },
      ],
    },
    {
      key: "transport",
      label: SETTINGS.transport,
      description: SETTINGS.transportDesc,
      value: settings.transport,
      options: [...TRANSPORT_OPTIONS],
    },
    {
      key: "excludedFolders",
      label: SETTINGS.excludedFolders,
      description: SETTINGS.excludedFoldersDesc,
      value: joinLines(settings.excludedFolders),
    },
    {
      key: "excludedTags",
      label: SETTINGS.excludedTags,
      description: SETTINGS.excludedTagsDesc,
      value: joinLines(settings.excludedTags),
    },
    {
      key: "endpointAckHost",
      label: SETTINGS.endpointAckHost,
      description: SETTINGS.endpointAckHostDesc,
      value: settings.endpointAckHost ?? "",
    },
  ];

  return {
    fields,
    warnings,
    showEgressWarning,
    showNonLoopbackWarning,
    showEndpointBlocked,
    showDegradedTransport,
    missingApiKey,
    acknowledgeLabel: showNonLoopbackWarning
      ? ACTIONS.acknowledgeEndpoint
      : null,
    hasTelemetryToggle: false,
  };
}
