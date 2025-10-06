import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadAppConfig } from "../src/config.ts";

Deno.test("Config - should load valid configuration", () => {
  // Set up environment variables for testing
  const originalConfig = Deno.env.get("RPC_CONFIG");
  const originalToken = Deno.env.get("INTERNAL_AUTH_TOKEN");
  const originalRateLimit = Deno.env.get("PUBLIC_RATE_LIMIT_ENABLED");
  
  try {
    // Set test configuration
    Deno.env.set("RPC_CONFIG", JSON.stringify({
      "mainnet": [
        { "url": "https://eth-mainnet.example.com" },
        { "url": "https://backup-mainnet.example.com", "authToken": "Bearer secret" }
      ],
      "sepolia": [
        { "url": "https://eth-sepolia.example.com" }
      ]
    }));
    Deno.env.set("INTERNAL_AUTH_TOKEN", "test-bypass-token");
    Deno.env.set("PUBLIC_RATE_LIMIT_ENABLED", "true");
    
    const config = loadAppConfig();
    
    assertEquals(config !== null, true);
    assertEquals(Object.keys(config!.rpc).length, 2);
    assertEquals(config!.rateLimit.bypassToken, "test-bypass-token");
    assertEquals(config!.rateLimit.enabled, true);
  } finally {
    // Restore original environment
    if (originalConfig) {
      Deno.env.set("RPC_CONFIG", originalConfig);
    } else {
      Deno.env.delete("RPC_CONFIG");
    }
    if (originalToken) {
      Deno.env.set("INTERNAL_AUTH_TOKEN", originalToken);
    } else {
      Deno.env.delete("INTERNAL_AUTH_TOKEN");
    }
    if (originalRateLimit) {
      Deno.env.set("PUBLIC_RATE_LIMIT_ENABLED", originalRateLimit);
    } else {
      Deno.env.delete("PUBLIC_RATE_LIMIT_ENABLED");
    }
  }
});

Deno.test("Config - should reject invalid configuration", () => {
  const originalConfig = Deno.env.get("RPC_CONFIG");
  
  try {
    // Set invalid configuration (missing required fields)
    Deno.env.set("RPC_CONFIG", JSON.stringify({
      "mainnet": [
        { "invalidField": "not-a-url" }  // Missing 'url' field
      ]
    }));
    
    const config = loadAppConfig();
    
    assertEquals(config, null);
  } finally {
    if (originalConfig) {
      Deno.env.set("RPC_CONFIG", originalConfig);
    } else {
      Deno.env.delete("RPC_CONFIG");
    }
  }
});