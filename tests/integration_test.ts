import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRpcRequest } from "../src/rpc_handler.ts";
import type { AppConfig, RateLimitConfig, RpcConfig } from "../src/config.ts";

// Integration tests for the complete RPC handler
Deno.test("Integration - should handle valid RPC request with authentication", async () => {
  const mockRpcConfig: RpcConfig = {
    "mainnet": [
      { url: "https://jsonrpc.test/invalid" }, // This will fail, testing fallback
      { url: "https://httpbin.org/post" }       // This should work  
    ]
  };

  const rateLimitConfig: RateLimitConfig = {
    enabled: true,
    rpm: 60,
    bypassToken: "test-token"
  };

  const appConfig: AppConfig = {
    rpc: mockRpcConfig,
    rateLimit: rateLimitConfig
  };

  const requestBody = {
    jsonrpc: "2.0",
    method: "eth_getBalance",
    params: ["0x1234567890abcdef", "latest"],
    id: 1
  };

  const request = new Request("http://localhost:8000/mainnet", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer test-token"
    },
    body: JSON.stringify(requestBody)
  });

  const mockInfo: Deno.ServeHandlerInfo = {
    remoteAddr: {
      transport: "tcp",
      hostname: "192.168.1.100",
      port: 12345
    }
  };

  const response = await handleRpcRequest(request, mockInfo, appConfig);

  // Should succeed due to trusted auth token
  assertEquals(response.status < 500, true);
});

Deno.test("Integration - should apply rate limiting for public requests", async () => {
  const mockRpcConfig: RpcConfig = {
    "mainnet": [
      { url: "https://httpbin.org/post" }
    ]
  };

  const rateLimitConfig: RateLimitConfig = {
    enabled: true,
    rpm: 1, // Very low limit for testing
    bypassToken: "test-token"
  };

  const appConfig: AppConfig = {
    rpc: mockRpcConfig,
    rateLimit: rateLimitConfig
  };

  const requestBody = {
    jsonrpc: "2.0",
    method: "eth_getBalance",
    params: ["0x1234567890abcdef", "latest"],
    id: 1
  };

  const request = new Request("http://localhost:8000/mainnet", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
      // No auth token
    },
    body: JSON.stringify(requestBody)
  });

  const mockInfo: Deno.ServeHandlerInfo = {
    remoteAddr: {
      transport: "tcp",
      hostname: "192.168.1.100",
      port: 12345
    }
  };

  // First request should pass
  const response1 = await handleRpcRequest(request, mockInfo, appConfig);
  
  // Second request should be rate limited
  const response2 = await handleRpcRequest(request, mockInfo, appConfig);
  
  assertEquals(response2.status, 429);
});

Deno.test("Integration - should handle unknown network", async () => {
  const mockRpcConfig: RpcConfig = {
    "mainnet": [
      { url: "https://httpbin.org/post" }
    ]
  };

  const rateLimitConfig: RateLimitConfig = {
    enabled: false,
    rpm: 60,
    bypassToken: null
  };

  const appConfig: AppConfig = {
    rpc: mockRpcConfig,
    rateLimit: rateLimitConfig
  };

  const request = new Request("http://localhost:8000/unknownnet", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "test" })
  });

  const mockInfo: Deno.ServeHandlerInfo = {
    remoteAddr: {
      transport: "tcp",
      hostname: "192.168.1.100",
      port: 12345
    }
  };

  const response = await handleRpcRequest(request, mockInfo, appConfig);
  
  assertEquals(response.status, 404);
  assertEquals(await response.text(), "Network not configured: unknownnet");
});

Deno.test("Integration - should handle invalid JSON in request", async () => {
  const mockRpcConfig: RpcConfig = {
    "mainnet": [
      { url: "https://httpbin.org/post" }
    ]
  };

  const rateLimitConfig: RateLimitConfig = {
    enabled: false,
    rpm: 60,
    bypassToken: null
  };

  const appConfig: AppConfig = {
    rpc: mockRpcConfig,
    rateLimit: rateLimitConfig
  };

  const request = new Request("http://localhost:8000/mainnet", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: "invalid json"
  });

  const mockInfo: Deno.ServeHandlerInfo = {
    remoteAddr: {
      transport: "tcp",
      hostname: "192.168.1.100",
      port: 12345
    }
  };

  const response = await handleRpcRequest(request, mockInfo, appConfig);
  
  assertEquals(response.status, 400);
  assertEquals((await response.text()).includes("Invalid JSON"), true);
});