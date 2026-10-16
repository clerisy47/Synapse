import { randomBytes } from "node:crypto";
/** 128 bits; no persistent reference resolver or authority. */
export const opaqueMcpId = () => randomBytes(16).toString("base64url");
