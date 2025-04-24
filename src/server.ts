import { serve, ConnInfo } from "https://deno.land/std@0.182.0/http/server.ts";
import type { AppConfig } from "./config.ts";
import { handleRpcRequest } from "./rpc_handler.ts";
import { initializePushgateway, getMetrics, getMetricsContentType } from "./metrics.ts";

const SERVER_PORT = 8000;
const SERVER_HOSTNAME = "[::]"; // Listen on all interfaces (IPv4 and IPv6)

/**
 * Starts the RPC proxy server.
 *
 * @param appConfig The loaded application configuration.
 */
export function startServer(appConfig: AppConfig): void {
  console.log(`🚀 Starting RPC proxy server on http://${SERVER_HOSTNAME === "[::]" ? "localhost" : SERVER_HOSTNAME}:${SERVER_PORT}`);
  console.log(`📊 Metrics available via scrape at http://localhost:${SERVER_PORT}/metrics (requires internal auth token)`);

  // Initialize Pushgateway if configured
  initializePushgateway(appConfig);

  serve(async (req: Request, connInfo: ConnInfo) => {
    const url = new URL(req.url);

    // --- Metrics Endpoint Handling ---
    if (url.pathname === "/metrics") {
      // Protect /metrics endpoint
      const authHeader = req.headers.get("Authorization");
      const expectedToken = appConfig.rateLimit.bypassToken;
      let authorized = false;

      if (expectedToken && authHeader?.startsWith("Bearer ")) {
          const providedToken = authHeader.substring(7); // Length of "Bearer "
          if (providedToken === expectedToken) {
              authorized = true;
          }
      }

      if (!authorized) {
          const clientIp = connInfo.remoteAddr.transport === "tcp" || connInfo.remoteAddr.transport === "udp"
              ? connInfo.remoteAddr.hostname
              : 'unknown_transport';
          console.warn(`[Metrics] Unauthorized access attempt to /metrics from ${clientIp}.`);
          return new Response("Unauthorized", { status: 401 });
      }
      // --- End protection ---

      try {
        console.log(`[Metrics] Authorized access to /metrics.`);
        const metrics = await getMetrics();
        return new Response(metrics, {
          headers: { "Content-Type": getMetricsContentType() },
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("Error generating metrics:", message);
        return new Response("Error generating metrics", { status: 500 });
      }
    }

    // --- RPC Request Handling ---
    // Pass the request to the dedicated RPC handler
    return handleRpcRequest(req, connInfo, appConfig);

  }, { port: SERVER_PORT, hostname: SERVER_HOSTNAME });

  // Note: Graceful shutdown (e.g., stopping Pushgateway interval) can be added here
  // using Deno.addSignalListener if needed.
  // Deno.addSignalListener("SIGINT", () => {
  //   console.log("SIGINT received, stopping server and Pushgateway...");
  //   stopPushgateway(); // Assuming stopPushgateway is imported from metrics.ts
  //   Deno.exit(0);
  // });
}
