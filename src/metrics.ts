// Use prom-client via npm specifier - import Pushgateway as well
import client, { Pushgateway, Counter } from "npm:prom-client";
import type { AppConfig } from "./config.ts"; // Import AppConfig for Pushgateway URL

// --- Metrics Definition ---
// Metrics are automatically registered to the default client.register

export const rpcRequestsTotal = new client.Counter({
  name: "rpc_requests_total",
  help: "Total requests received by the proxy.",
  labelNames: ["network", "trusted"], // trusted: 'true' or 'false'
});

export const rpcRequestsForwardedTotal = new client.Counter({
  name: "rpc_requests_forwarded_total",
  help: "Total attempts to forward a request to an upstream RPC.",
  labelNames: ["network", "upstream_url"],
});

export const rpcUpstreamResponseTotal = new client.Counter({
  name: "rpc_upstream_response_total",
  help: "Responses received from upstream RPCs.",
  labelNames: ["network", "upstream_url", "status_code", "outcome"], // outcome: 'success', 'http_error', 'timeout', 'network_error'
});

export const rpcClientResponseTotal = new client.Counter({
  name: "rpc_client_response_total",
  help: "Final responses sent back to the client.",
  labelNames: ["network", "status_code"], // e.g., 200, 400, 404, 429, 500, 502
});

// --- Pushgateway Setup ---

const PUSH_INTERVAL_MS = 15000; // Push every 15 seconds
let pushIntervalId: number | undefined;

/**
 * Initializes the periodic push of metrics to a Prometheus Pushgateway if configured.
 * @param config The application configuration containing the Pushgateway URL.
 */
export function initializePushgateway(config: AppConfig): void {
  if (config.pushgatewayUrl) {
    console.log(` Pushing metrics to Pushgateway: ${config.pushgatewayUrl} every ${PUSH_INTERVAL_MS}ms`);
    const gateway = new Pushgateway(config.pushgatewayUrl);
    const jobName = 'rpc-proxy'; // Consider making this configurable if needed

    // Define the push function with error handling
    const pushMetrics = async () => {
      try {
        // Use pushAdd to not overwrite metrics from other instances using the same job name
        await gateway.pushAdd({ jobName });
        console.log(`[Pushgateway] Metrics pushed successfully to ${config.pushgatewayUrl}`);
      } catch (err) {
        console.error(`[Pushgateway] Error pushing metrics to ${config.pushgatewayUrl}:`, err);
      }
    };

    // Initial push immediately
    pushMetrics();
    // Set interval for periodic pushes
    pushIntervalId = setInterval(pushMetrics, PUSH_INTERVAL_MS);

    // Note: Graceful shutdown for the interval is tricky in basic Deno.
    // Consider libraries or more complex signal handling if needed.
  } else {
    console.log("ℹ️ Pushgateway integration is disabled (PROMETHEUS_URL not set).");
  }
}

/**
 * Stops the periodic push of metrics to the Pushgateway, if it was running.
 */
export function stopPushgateway(): void {
    if (pushIntervalId !== undefined) {
        clearInterval(pushIntervalId);
        pushIntervalId = undefined;
        console.log("[Pushgateway] Stopped periodic metrics push.");
    }
}

/**
 * Retrieves the current metrics from the registry for the /metrics endpoint.
 * @returns A promise resolving to the metrics string.
 */
export async function getMetrics(): Promise<string> {
    return await client.register.metrics();
}

/**
 * Gets the content type for the metrics response.
 * @returns The content type string.
 */
export function getMetricsContentType(): string {
    return client.register.contentType;
}
