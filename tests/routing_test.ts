import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractNetworkSlug, isNetworkConfigured } from "../src/routing.ts";

Deno.test("Routing - should extract valid network slug", () => {
  const result = extractNetworkSlug("http://localhost:8000/mainnet");
  
  assertEquals(result.slug, "mainnet");
  assertEquals(result.isValid, true);
});

Deno.test("Routing - should extract network slug from different domains", () => {
  const result = extractNetworkSlug("https://api.example.com/sepolia");
  
  assertEquals(result.slug, "sepolia");
  assertEquals(result.isValid, true);
});

Deno.test("Routing - should handle invalid URL patterns", () => {
  const result = extractNetworkSlug("http://localhost:8000/");
  
  assertEquals(result.slug, "unknown");
  assertEquals(result.isValid, false);
});

Deno.test("Routing - should handle malformed URLs", () => {
  const result = extractNetworkSlug("not-a-url");
  
  assertEquals(result.slug, "unknown");
  assertEquals(result.isValid, false);
});

Deno.test("Routing - should validate configured network", () => {
  const rpcConfig = {
    "mainnet": [{ url: "http://example.com" }],
    "sepolia": [{ url: "http://test.com" }]
  };
  
  assertEquals(isNetworkConfigured("mainnet", rpcConfig), true);
  assertEquals(isNetworkConfigured("sepolia", rpcConfig), true);
  assertEquals(isNetworkConfigured("unknown", rpcConfig), false);
});

Deno.test("Routing - should reject empty endpoint arrays", () => {
  const rpcConfig = {
    "mainnet": [],
    "sepolia": [{ url: "http://test.com" }]
  };
  
  assertEquals(isNetworkConfigured("mainnet", rpcConfig), false);
  assertEquals(isNetworkConfigured("sepolia", rpcConfig), true);
});