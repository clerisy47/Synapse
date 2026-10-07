/**
 * Minimal Obsidian stub for Vitest. Production loads the real module as external.
 * Adapters under test should inject fakes; this only satisfies module resolution.
 */

export type RequestUrlParam = {
  url: string;
  method?: string;
  contentType?: string;
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
  throw?: boolean;
};

export type RequestUrlResponse = {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  json: unknown;
  text: string;
};

export function requestUrl(
  _request: RequestUrlParam | string,
): Promise<RequestUrlResponse> {
  throw new Error(
    "obsidian stub: inject requestUrl via RequestUrlTransportOptions in tests",
  );
}

export class Plugin {}
export type App = { workspace: { onLayoutReady(cb: () => void): void } };
