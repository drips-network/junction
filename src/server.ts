import type { AppConfig } from "./config.ts";
import { handleRpcRequest } from "./rpc_handler.ts";

const SERVER_PORT = 8000;
const SERVER_HOSTNAME = "[::]"; // Listen on all interfaces (IPv4 and IPv6)

/**
 * Starts the RPC proxy server.
 *
 * @param appConfig The loaded application configuration.
 */
export function startServer(appConfig: AppConfig): void {
  console.log(`🚀 Starting RPC proxy server on http://${SERVER_HOSTNAME === "[::]" ? "localhost" : SERVER_HOSTNAME}:${SERVER_PORT}`);

  Deno.serve({ port: SERVER_PORT, hostname: SERVER_HOSTNAME }, async (req: Request, info: Deno.ServeHandlerInfo) => {
    // --- CORS Preflight Request Handling ---
    if (req.method === "OPTIONS") {
      // Handle CORS preflight requests
      return new Response(null, { // No body for 204
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*", // Allow any origin
          "Access-Control-Allow-Methods": "POST, OPTIONS", // Allow POST (for RPC) and OPTIONS (for preflight)
          "Access-Control-Allow-Headers": "Content-Type, Authorization", // Allow necessary headers
          "Access-Control-Max-Age": "86400", // Cache preflight response for 1 day
        },
      });
    }

    // --- RPC Request Handling ---
    // Pass the request to the dedicated RPC handler
    const response = await handleRpcRequest(req, info, appConfig);

    // Add CORS header to the RPC response (success or error from handler)
    response.headers.set("Access-Control-Allow-Origin", "*");

    return response;

  });

  // Note: Graceful shutdown (e.g., stopping Pushgateway interval) can be added here
  // using Deno.addSignalListener if needed.
  // Deno.addSignalListener("SIGINT", () => {
  //   console.log("SIGINT received, stopping server and Pushgateway...");
  //   stopPushgateway(); // Assuming stopPushgateway is imported from metrics.ts
  //   Deno.exit(0);
  // });
}
