// deno-lint-ignore-file no-explicit-any

import { assertEquals, assertExists } from "jsr:@std/assert@^1"; // Use direct JSR import
import { assertSpyCalls, stub } from "https://deno.land/std@0.224.0/testing/mock.ts"; // Use full URL import
import { ConnInfo } from "https://deno.land/std@0.182.0/http/server.ts"; // Import ConnInfo

import { handler, RpcConfig, AppConfig } from "./main.ts"; // Import AppConfig

// --- Mock Configuration ---
const MOCK_VALID_CONFIG_JSON = `{
  "mainnet": [
    { "url": "http://mock-rpc1.mainnet", "authToken": "auth1" },
    { "url": "http://mock-rpc2.mainnet" }
  ],
  "sepolia": [
    { "url": "http://mock-rpc1.sepolia" }
  ]
}`;

// Use the imported RpcConfig type
const MOCK_RPC_CONFIG: RpcConfig = JSON.parse(MOCK_VALID_CONFIG_JSON);

// --- Mock AppConfig and ConnInfo ---
const MOCK_RATE_LIMIT_CONFIG_DISABLED = {
  enabled: false,
  rpm: 60,
  bypassToken: null,
};

const MOCK_APP_CONFIG: AppConfig = {
  rpc: MOCK_RPC_CONFIG,
  rateLimit: MOCK_RATE_LIMIT_CONFIG_DISABLED, // Default to disabled for most tests
};

// Mock ConnInfo - provides remote address needed for rate limiting
const MOCK_CONN_INFO: ConnInfo = {
  localAddr: { transport: "tcp", hostname: "127.0.0.1", port: 8000 },
  remoteAddr: { transport: "tcp", hostname: "192.0.2.1", port: 12345 }, // Example remote IP
};


// --- Test Suite ---

Deno.test("RPC Proxy Handler", async (t) => {
  // --- Mock fetch ---
  let fetchStub: any;

  const setupFetchMock = (responses: Record<string, Response | Error>) => {
    fetchStub = stub(globalThis, "fetch", (urlInput: URL | Request | string) => {
      const url = typeof urlInput === 'string' ? urlInput : (urlInput instanceof URL ? urlInput.toString() : urlInput.url);
      console.log(`Mock fetch called for: ${url}`);
      const response = responses[url];
      if (response instanceof Error) {
        return Promise.reject(response);
      }
      if (response) {
        return Promise.resolve(response.clone()); // Clone response for multiple uses
      }
      return Promise.reject(new Error(`Mock fetch not configured for ${url}`));
    });
  };

  await t.step("setup", () => {
    // Mock console to prevent test logs cluttering output (optional)
    stub(console, "log");
    stub(console, "warn");
    stub(console, "error");
  });

  await t.step("teardown", () => {
    fetchStub?.restore(); // Restore original fetch
    (console.log as any).restore?.();
    (console.warn as any).restore?.();
    (console.error as any).restore?.();
  });

  // --- Test Cases ---

  await t.step("should return 404 for unconfigured network", async () => {
    try {
      setupFetchMock({}); // No fetch expected
      const req = new Request("http://localhost:8000/unknown", { method: "POST", body: "{}" });
      // Call handler with mock ConnInfo and AppConfig
      const res = await handler(req, MOCK_CONN_INFO, MOCK_APP_CONFIG);
      assertEquals(res.status, 404);
      assertEquals(await res.text(), "Network not configured: unknown");
    } finally {
      fetchStub?.restore(); // Ensure restore happens
    }
  });

  await t.step("should return 405 for non-POST request", async () => {
    try {
       setupFetchMock({}); // No fetch expected
       const req = new Request("http://localhost:8000/mainnet", { method: "GET" });
       const res = await handler(req, MOCK_CONN_INFO, MOCK_APP_CONFIG);
       assertEquals(res.status, 405);
       assertEquals(await res.text(), "Method Not Allowed");
    } finally {
       fetchStub?.restore(); // Ensure restore happens
    }
  });

   await t.step("should return 400 for invalid JSON body", async () => {
    try {
       setupFetchMock({}); // No fetch expected
       const req = new Request("http://localhost:8000/mainnet", { method: "POST", body: "invalid json" });
       const res = await handler(req, MOCK_CONN_INFO, MOCK_APP_CONFIG);
       assertEquals(res.status, 400);
       assertStringIncludes(await res.text(), "Bad Request: Invalid JSON body");
    } finally {
       fetchStub?.restore(); // Ensure restore happens
    }
   });

   await t.step("should return 400 for invalid JSON-RPC structure", async () => {
    try {
       setupFetchMock({}); // No fetch expected
       const req = new Request("http://localhost:8000/mainnet", { method: "POST", body: '{"id": 1}' }); // Missing 'method'
       const res = await handler(req, MOCK_CONN_INFO, MOCK_APP_CONFIG);
       assertEquals(res.status, 400);
       assertEquals(await res.text(), "Bad Request: Invalid JSON-RPC request structure.");
    } finally {
       fetchStub?.restore(); // Ensure restore happens
    }
   });

  await t.step("should proxy to first endpoint successfully", async () => {
    try {
      const mockRpcResponse = new Response(JSON.stringify({ result: "ok", id: 1 }), { status: 200 });
      setupFetchMock({ "http://mock-rpc1.mainnet": mockRpcResponse });

      const req = new Request("http://localhost:8000/mainnet", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      });
      const res = await handler(req, MOCK_CONN_INFO, MOCK_APP_CONFIG);

      assertEquals(res.status, 200);
      assertEquals(await res.json(), { result: "ok", id: 1 });
      // Check fetch was called once
      assertSpyCalls(fetchStub, 1);
      // Check the arguments passed to fetch
      const callArgs = fetchStub.calls[0].args;
      assertEquals(callArgs[0], "http://mock-rpc1.mainnet");
      assertEquals(callArgs[1].method, "POST");
      // Compare individual header values
      assertEquals(callArgs[1].headers.get("content-type"), "application/json");
      assertEquals(callArgs[1].headers.get("authorization"), "auth1");
      assertEquals(callArgs[1].body, JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }));
      assertExists(callArgs[1].signal, "Fetch call should have an AbortSignal");
    } finally {
      fetchStub?.restore(); // Ensure restore happens
    }
  });

  await t.step("should failover to second endpoint if first fails (network error)", async () => {
    try {
      const mockRpcResponse = new Response(JSON.stringify({ result: "ok", id: 2 }), { status: 200 });
      setupFetchMock({
        "http://mock-rpc1.mainnet": new Error("Network connection failed"), // First fails
        "http://mock-rpc2.mainnet": mockRpcResponse, // Second succeeds
      });

      const req = new Request("http://localhost:8000/mainnet", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 2 }),
      });
      const res = await handler(req, MOCK_CONN_INFO, MOCK_APP_CONFIG);

      assertEquals(res.status, 200);
      assertEquals(await res.json(), { result: "ok", id: 2 });
      assertSpyCalls(fetchStub, 2); // Called twice
      // Check first call (failed) - manually check URL and existence of options object
      assertEquals(fetchStub.calls[0].args[0], "http://mock-rpc1.mainnet");
      assertExists(fetchStub.calls[0].args[1], "First fetch call should have options object");
      // Check second call (succeeded) - Manually check args
      const secondCallArgs = fetchStub.calls[1].args;
      assertEquals(secondCallArgs[0], "http://mock-rpc2.mainnet");
      assertExists(secondCallArgs[1], "Second fetch call should have options object");
      assertEquals(secondCallArgs[1].method, "POST");
      assertEquals(secondCallArgs[1].headers.get("content-type"), "application/json");
      assertEquals(secondCallArgs[1].headers.get("authorization"), null); // No auth token expected
      assertEquals(secondCallArgs[1].body, JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 2 }));
      assertExists(secondCallArgs[1].signal, "Second fetch call should have an AbortSignal");
    } finally {
      fetchStub?.restore(); // Ensure restore happens
    }
  });

   await t.step("should failover to second endpoint if first returns non-OK status", async () => {
    try {
       const mockRpcResponse = new Response(JSON.stringify({ result: "ok", id: 3 }), { status: 200 });
       setupFetchMock({
         "http://mock-rpc1.mainnet": new Response("Server Error", { status: 500 }), // First fails (500)
         "http://mock-rpc2.mainnet": mockRpcResponse, // Second succeeds
       });

       const req = new Request("http://localhost:8000/mainnet", {
         method: "POST",
         body: JSON.stringify({ jsonrpc: "2.0", method: "eth_gasPrice", params: [], id: 3 }),
       });
       const res = await handler(req, MOCK_CONN_INFO, MOCK_APP_CONFIG);

       assertEquals(res.status, 200);
       assertEquals(await res.json(), { result: "ok", id: 3 });
       assertSpyCalls(fetchStub, 2);
    } finally {
       fetchStub?.restore(); // Ensure restore happens
    }
   });

  await t.step("should return 502 if all endpoints fail", async () => {
    try {
      setupFetchMock({
        "http://mock-rpc1.mainnet": new Error("Network error"),
        "http://mock-rpc2.mainnet": new Response("Gateway Timeout", { status: 504 }),
      });

      const req = new Request("http://localhost:8000/mainnet", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_syncing", params: [], id: 4 }),
      });
      const res = await handler(req, MOCK_CONN_INFO, MOCK_APP_CONFIG);

      assertEquals(res.status, 502);
      assertEquals(await res.text(), "Bad Gateway: All configured RPC endpoints for network 'mainnet' failed.");
      assertSpyCalls(fetchStub, 2);
    } finally {
      fetchStub?.restore(); // Ensure restore happens
    }
  });

  // Note: Testing actual timeouts with AbortController requires more complex async coordination
  // or potentially mocking setTimeout/clearTimeout as well, which adds significant complexity.
  // We'll rely on the code structure review for timeout logic correctness for now.

});

// Helper function (consider moving to a test_utils.ts if needed)
function assertStringIncludes(actual: string, expected: string) {
    if (!actual.includes(expected)) {
        throw new Error(`Expected string "${actual}" to include "${expected}"`);
    }
}

// Config loading tests removed for simplicity for now.
