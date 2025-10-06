import { assertEquals, assertExists } from 'std/assert';
import { forwardToRpcEndpoint, forwardWithFallback } from "../src/rpc_client.ts";

// Mock RPC server setup for testing
let mockServerPort = 8901;

function startMockRpcServer(behavior: "success" | "error" | "timeout" | "invalid-json"): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const port = mockServerPort++;
    
    const server = Deno.serve({ port }, async (req) => {
      const body = await req.json();
      
      switch (behavior) {
        case "success":
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            result: "0x1234567890abcdef",
            id: body.id
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
          
        case "error":
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Server error" },
            id: body.id
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
          
        case "timeout":
          // Never respond to simulate timeout
          return new Promise(() => {});
          
        case "invalid-json":
          return new Response("invalid json response", {
            status: 200,
            headers: { "Content-Type": "text/plain" }
          });
      }
      
      return new Response("Internal Server Error", { status: 500 });
    });
    
    resolve({ 
      port, 
      close: () => server.shutdown()
    });
  });
}

Deno.test("RPC Client - First RPC successful (normal case)", async () => {
  const mockServer = await startMockRpcServer("success");
  
  try {
    const endpoint = {
      url: `http://localhost:${mockServer.port}`,
      authToken: undefined
    };
    
    const requestBody = {
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: ["0x1234567890abcdef", "latest"],
      id: 1
    };
    
    const result = await forwardToRpcEndpoint(endpoint, requestBody, "mainnet");
    
    assertEquals(result.success, true);
    assertExists(result.response);
    
    const responseBody = await result.response.json();
    assertEquals(responseBody.result, "0x1234567890abcdef");
    assertEquals(responseBody.id, 1);
  } finally {
    mockServer.close();
  }
});

Deno.test("RPC Client - First RPC fails, second successful (returns 2nd response)", async () => {
  const failingServer = await startMockRpcServer("error");
  const successServer = await startMockRpcServer("success");
  
  try {
    const endpoints = [
      { url: `http://localhost:${failingServer.port}` },
      { url: `http://localhost:${successServer.port}` }
    ];
    
    const requestBody = {
      jsonrpc: "2.0",
      method: "eth_getBalance", 
      params: ["0x1234567890abcdef", "latest"],
      id: 1
    };
    
    const response = await forwardWithFallback(endpoints, requestBody, "mainnet");
    
    assertEquals(response.status, 200);
    
    const responseBody = await response.json();
    assertEquals(responseBody.result, "0x1234567890abcdef");
    assertEquals(responseBody.id, 1);
  } finally {
    failingServer.close();
    successServer.close();
  }
});

Deno.test("RPC Client - First RPC hangs, second successful (returns 2nd response)", async () => {
  const timeoutServer = await startMockRpcServer("timeout");
  const successServer = await startMockRpcServer("success");
  
  try {
    const endpoints = [
      { url: `http://localhost:${timeoutServer.port}` },
      { url: `http://localhost:${successServer.port}` }
    ];
    
    const requestBody = {
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: ["0x1234567890abcdef", "latest"],  
      id: 1
    };
    
    const response = await forwardWithFallback(endpoints, requestBody, "mainnet");
    
    assertEquals(response.status, 200);
    
    const responseBody = await response.json();
    assertEquals(responseBody.result, "0x1234567890abcdef");
    assertEquals(responseBody.id, 1);
  } finally {
    timeoutServer.close();
    successServer.close();
  }
});

Deno.test("RPC Client - All RPCs fail (returns status and body of last request)", async () => {
  const failingServer1 = await startMockRpcServer("error");
  const failingServer2 = await startMockRpcServer("invalid-json");
  
  try {
    const endpoints = [
      { url: `http://localhost:${failingServer1.port}` },
      { url: `http://localhost:${failingServer2.port}` }
    ];
    
    const requestBody = {
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: ["0x1234567890abcdef", "latest"],
      id: 1
    };
    
    const response = await forwardWithFallback(endpoints, requestBody, "mainnet");
    
    // Should return error from the last failed endpoint
    assertEquals(response.status, 502);
    
    const responseText = await response.text();
    assertEquals(responseText.includes("was not valid JSON"), true);
  } finally {
    failingServer1.close();
    failingServer2.close();
  }
});

Deno.test("RPC Client - Single endpoint timeout handling", async () => {
  const timeoutServer = await startMockRpcServer("timeout");
  
  try {
    const endpoint = {
      url: `http://localhost:${timeoutServer.port}`,
      authToken: undefined
    };
    
    const requestBody = {
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: ["0x1234567890abcdef", "latest"],
      id: 1
    };
    
    const result = await forwardToRpcEndpoint(endpoint, requestBody, "mainnet");
    
    assertEquals(result.success, false);
    assertEquals(result.error?.status, 504);
    assertEquals(result.error?.body.includes("Gateway Timeout"), true);
  } finally {
    timeoutServer.close();
  }
});
