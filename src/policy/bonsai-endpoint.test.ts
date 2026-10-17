import { expect, it } from "vitest";
import { createEndpointPolicy } from "./index";
const policy = createEndpointPolicy({ provider: "bonsai", endpointAckHost: "evil.example" });
it.each(["https://evil.example/v1", "http://192.168.1.1/v1", "http://localhost:18080/v1", "http://127.0.0.1.evil.example/v1", "http://user:secret@127.0.0.1:18080/v1", "http://127.0.0.1:18080/redirect", "http://127.0.0.1:18080/v1?target=evil", "file:///v1"])("blocks unsafe local endpoint %s despite acknowledgement", (url) => {
  expect(policy.check(url).ok).toBe(false);
  expect(() => policy.assertAllowed(url)).toThrow();
});
it("permits only loopback inference and health routes", () => {
  for (const path of ["/v1", "/health", "/v1/chat/completions"]) expect(policy.check(`http://127.0.0.1:18080${path}`).ok).toBe(true);
});
