import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authenticateRequest } from "../src/auth.ts";
import type { RateLimitConfig } from "../src/config.ts";

Deno.test("Auth - should identify trusted request with valid bypass token", () => {
  const rateLimitConfig: RateLimitConfig = {
    enabled: true,
    rpm: 60,
    bypassToken: "valid-secret-token"
  };

  const mockRemoteAddr: Deno.NetAddr = {
    transport: "tcp",
    hostname: "192.168.1.100",
    port: 12345
  };

  const result = authenticateRequest(
    "Bearer valid-secret-token", 
    rateLimitConfig,
    mockRemoteAddr
  );

  assertEquals(result.isTrusted, true);
  assertEquals(result.clientIp, "192.168.1.100");
});

Deno.test("Auth - should reject invalid bypass token", () => {
  const rateLimitConfig: RateLimitConfig = {
    enabled: true,
    rpm: 60,
    bypassToken: "valid-secret-token"
  };

  const mockRemoteAddr: Deno.NetAddr = {
    transport: "tcp",
    hostname: "192.168.1.100",
    port: 12345
  };

  const result = authenticateRequest(
    "Bearer invalid-token", 
    rateLimitConfig,
    mockRemoteAddr
  );

  assertEquals(result.isTrusted, false);
  assertEquals(result.clientIp, "192.168.1.100");
});

Deno.test("Auth - should handle no bypass token configured", () => {
  const rateLimitConfig: RateLimitConfig = {
    enabled: true,
    rpm: 60,
    bypassToken: null
  };

  const mockRemoteAddr: Deno.NetAddr = {
    transport: "tcp",
    hostname: "192.168.1.100",
    port: 12345
  };

  const result = authenticateRequest(
    "Bearer any-token", 
    rateLimitConfig,
    mockRemoteAddr
  );

  assertEquals(result.isTrusted, false);
  assertEquals(result.clientIp, "192.168.1.100");
});

Deno.test("Auth - should handle non-TCP transport", () => {
  const rateLimitConfig: RateLimitConfig = {
    enabled: true,
    rpm: 60,
    bypassToken: "valid-secret-token"
  };

  const mockRemoteAddr: Deno.NetAddr = {
    transport: "unix",
    hostname: "",
    port: 0
  };

  const result = authenticateRequest(
    null, 
    rateLimitConfig,
    mockRemoteAddr
  );

  assertEquals(result.isTrusted, false);
  assertEquals(result.clientIp, undefined);
});