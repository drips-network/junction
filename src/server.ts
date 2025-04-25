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
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const response = await handleRpcRequest(req, info, appConfig);

    response.headers.set("Access-Control-Allow-Origin", "*");

    return response;

  });
}
