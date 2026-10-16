import type { StoragePort } from "./ports";
export type McpScope = "query-vault" | "submit-research";
export interface McpGrant {
    id: string;
    label: string;
    scopes: McpScope[];
    digest: string;
    generation: number;
}
export interface McpStatus {
    enabled: boolean;
    url: string | null;
    failed: boolean;
    clients: ReadonlyArray<Omit<McpGrant, "digest">>;
}
export interface McpLimits {
    bodyBytes: number;
    headerBytes: number;
    ioMs: number;
    workMs: number;
    outputBytes: number;
    clients: number;
    labelPoints: number;
    burst: number;
    perMinute: number;
    unauthPerMinute: number;
    concurrency: number;
    questionPoints: number;
    researchPoints: number;
    sources: number;
    urlChars: number;
    metaBytes: number;
}
export interface McpServerPort {
    status(): McpStatus;
    enable(): Promise<void>;
    disable(): Promise<void>;
    pair(label: string, scopes: McpScope[]): Promise<{
        id: string;
        token: string;
    }>;
    revoke(id: string): Promise<void>;
    /** Drops pending delivery and per-client initialization on policy/source/settings changes. */
    invalidate(): void;
    dispose(): void;
}
export type McpResult =
    | { status: "unavailable" | "conflict" }
    | { status: "accepted"; receipt: string }
    | { status: "answered"; answer: string; references: { id: string; label: string; excerpt: string }[] };
export interface McpServerOptions {
    storage: StoragePort;
    limits: McpLimits;
    name: string;
    version: string;
    /** R4-T03 supplies policy-aware semantic work. No internal answer forwarding. */
    invoke?: (client: Readonly<Omit<McpGrant, "digest">>, name: string, args: unknown, signal: AbortSignal) => Promise<McpResult>;
}
