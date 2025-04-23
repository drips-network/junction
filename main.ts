import { serve, ConnInfo } from "https://deno.land/std@0.182.0/http/server.ts";
import { z } from "zod";
// Use prom-client via npm specifier - import Pushgateway as well
import client, { Pushgateway } from "npm:prom-client";

// --- Rate Limiter Types and State ---
interface RateLimitConfig {
  enabled: boolean;
  rpm: number;
  bypassToken: string | null;
}

// Store IP -> { count: number, windowStart: number }
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

// --- Metrics Definition ---
// Use prom-client (metrics are auto-registered to default client.register)
const rpcRequestsTotal = new client.Counter({
  name: "rpc_requests_total",
  help: "Total requests received by the proxy.",
  labelNames: ["network", "trusted"],
});

const rpcRequestsForwardedTotal = new client.Counter({
  name: "rpc_requests_forwarded_total",
  help: "Total attempts to forward a request to an upstream RPC.",
  labelNames: ["network", "upstream_url"],
});

const rpcUpstreamResponseTotal = new client.Counter({
  name: "rpc_upstream_response_total",
  help: "Responses received from upstream RPCs.",
  labelNames: ["network", "upstream_url", "status_code", "outcome"], // outcome: 'success', 'http_error', 'timeout', 'network_error'
});

const rpcClientResponseTotal = new client.Counter({
  name: "rpc_client_response_total",
  help: "Final responses sent back to the client.",
  labelNames: ["network", "status_code"],
});


// --- Configuration Loading and Validation ---

const RpcEndpointSchema = z.object({
  url: z.string().url(),
  authToken: z.string().optional(),
});

const RpcConfigSchema = z.record(z.string(), z.array(RpcEndpointSchema).min(1));

export type RpcConfig = z.infer<typeof RpcConfigSchema>;

// Combined config loading
export interface AppConfig {
  rpc: RpcConfig;
  rateLimit: RateLimitConfig;
}

export function loadAppConfig(): AppConfig | null {
  try {
    // Load .env file, allowing override by actual environment variables
    const configJson = Deno.env.get("RPC_CONFIG");
    const bypassToken = Deno.env.get("INTERNAL_AUTH_TOKEN") || null; // Allow empty/missing token
    const rateLimitEnabled = Deno.env.get("PUBLIC_RATE_LIMIT_ENABLED")?.toLowerCase() === "true";
    const rateLimitRpmStr = Deno.env.get("PUBLIC_RATE_LIMIT_RPM");
    let rateLimitRpm = 60; // Default RPM

    if (!configJson) {
      console.error("Error: RPC_CONFIG environment variable not set.");
      return null;
    }

    if (rateLimitEnabled) {
        if (rateLimitRpmStr) {
            const parsedRpm = parseInt(rateLimitRpmStr, 10);
            if (!isNaN(parsedRpm) && parsedRpm > 0) {
                rateLimitRpm = parsedRpm;
            } else {
                console.warn(`Warning: Invalid PUBLIC_RATE_LIMIT_RPM value "${rateLimitRpmStr}". Using default ${rateLimitRpm} RPM.`);
            }
        } else {
             console.warn(`Warning: PUBLIC_RATE_LIMIT_ENABLED is true, but PUBLIC_RATE_LIMIT_RPM is not set. Using default ${rateLimitRpm} RPM.`);
        }
        console.log(`✅ Public rate limiting enabled: ${rateLimitRpm} requests per minute per IP.`);
    } else {
        console.log("ℹ️ Public rate limiting disabled.");
    }

    if (bypassToken) {
        console.log("✅ Internal bypass token configured.");
    } else {
        console.log("ℹ️ No internal bypass token configured.");
    }


    const parsedConfig = JSON.parse(configJson);
    const validationResult = RpcConfigSchema.safeParse(parsedConfig);

    if (!validationResult.success) {
      console.error("Error: Invalid RPC_CONFIG format:");
      console.error(validationResult.error.errors);
      return null;
    }

    console.log("✅ RPC Configuration loaded and validated successfully.");
    console.log("Configured networks:", Object.keys(validationResult.data));

    return {
      rpc: validationResult.data,
      rateLimit: {
        enabled: rateLimitEnabled,
        rpm: rateLimitRpm,
        bypassToken: bypassToken,
      },
    };
  } catch (error) {
    console.error("Error loading or parsing configuration:", error);
    return null;
  }
}

// --- Rate Limiter Check ---

function checkRateLimit(ip: string, config: RateLimitConfig): boolean {
    if (!config.enabled) {
        return true; // Rate limiting disabled
    }

    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
        // Start new window
        rateLimitMap.set(ip, { count: 1, windowStart: now });
        return true;
    } else {
        // Existing window
        if (record.count < config.rpm) {
            record.count++;
            return true;
        } else {
            // Limit exceeded
            return false;
        }
    }
}

// --- Request Handler ---

const networkPattern = new URLPattern({ pathname: "/:slug" });
const RPC_TIMEOUT_MS = 10000; // 10 seconds timeout for upstream RPC calls

// Updated handler signature to include ConnInfo and the combined AppConfig
export async function handler(req: Request, connInfo: ConnInfo, appConfig: AppConfig): Promise<Response> {
  const { rpc: rpcConfig, rateLimit: rateLimitConfig } = appConfig;

  // --- Determine Slug Early ---
  const match = networkPattern.exec(req.url);
  // Use 'unknown' if slug extraction fails, useful for metrics before returning 404 or 429
  const slug = match?.pathname?.groups?.slug ?? "unknown";

  // --- Auth & Rate Limiting ---
  let isTrusted = false;
  const authHeader = req.headers.get("Authorization");
  if (rateLimitConfig.bypassToken && authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7); // Length of "Bearer "
      if (token === rateLimitConfig.bypassToken) {
          isTrusted = true;
          console.log(`[Auth] Trusted request via bypass token.`);
      } else {
          // Log invalid token attempt but treat as untrusted for rate limiting
          console.warn(`[Auth] Invalid bypass token received from ${connInfo.remoteAddr.transport === "tcp" || connInfo.remoteAddr.transport === "udp" ? connInfo.remoteAddr.hostname : 'unknown'}.`);
      }
  }

  if (!isTrusted) {
      // Apply rate limiting for untrusted requests
      const remoteAddr = connInfo.remoteAddr;
      // Ensure we have a hostname (IP address) to key the rate limit off
      if (remoteAddr.transport === "tcp" || remoteAddr.transport === "udp") {
          const ip = remoteAddr.hostname;
          if (!checkRateLimit(ip, rateLimitConfig)) {
              console.warn(`[RateLimit] IP ${ip} exceeded limit of ${rateLimitConfig.rpm} RPM.`);
              // Increment client response counter for rate limited requests
              // Note: slug might not be known yet if rate limiting happens before slug parsing,
              // but we added default 'unknown' slug handling earlier.
              rpcClientResponseTotal.inc({ network: slug, status_code: "429" }); 
              // Add Retry-After header according to RFC 6585
              return new Response("Too Many Requests", { 
                  status: 429, 
                  headers: { "Retry-After": "60" } // Suggest retrying after 60 seconds
              });
          }
      } else {
          // Log if we can't get an IP for rate limiting (e.g., Unix sockets)
          console.warn(`[RateLimit] Cannot apply IP-based rate limit for transport type: ${remoteAddr.transport}`);
      }
  }
  // --- End Auth & Rate Limiting ---


  // Increment total requests counter early (slug is now defined)
  rpcRequestsTotal.inc({ network: slug, trusted: String(isTrusted) });

  // Check the original match result for routing logic
  if (!match?.pathname?.groups?.slug) { 
    rpcClientResponseTotal.inc({ network: slug, status_code: "404" });
    return new Response("Not found", { status: 404 });
  }

  const endpoints = rpcConfig[slug];
  if (!endpoints) {
    rpcClientResponseTotal.inc({ network: slug, status_code: "404" });
    return new Response(`Network not configured: ${slug}`, { status: 404 });
  }

  if (req.method !== "POST") {
    rpcClientResponseTotal.inc({ network: slug, status_code: "405" });
    return new Response("Method Not Allowed", { status: 405, headers: { "Allow": "POST" } });
  }

  let requestBody;
  try {
    requestBody = await req.json();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    rpcClientResponseTotal.inc({ network: slug, status_code: "400" });
    return new Response(`Bad Request: Invalid JSON body. ${message}`, { status: 400 });
  }

  // Basic check for JSON-RPC structure
  if (typeof requestBody !== 'object' || requestBody === null || !requestBody.method) {
      rpcClientResponseTotal.inc({ network: slug, status_code: "400" });
      return new Response(`Bad Request: Invalid JSON-RPC request structure.`, { status: 400 });
  }

  // Log whether the request was treated as trusted or public
  console.log(`[${slug}] ${isTrusted ? '[Trusted]' : '[Public]'} --> Method: ${requestBody.method}, ID: ${requestBody?.id ?? 'N/A'}`);

  // Log the RPC request content up to 100 characters
  const requestBodyString = JSON.stringify(requestBody);
  console.log(`[${slug}] Request Body: ${requestBodyString.substring(0, 200)}...`);

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

    try {
      const headers = new Headers({
        "Content-Type": "application/json",
      });
      // Add upstream auth token if configured for the specific endpoint
      if (endpoint.authToken) {
        headers.set("Authorization", endpoint.authToken);
      }

      // Increment forwarded requests counter
      rpcRequestsForwardedTotal.inc({ network: slug, upstream_url: endpoint.url });
      console.log(`[${slug}] Attempting RPC: ${endpoint.url}`);

      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId); // Clear timeout if fetch completes

      if (response.ok) {
        const body = await response.json();

        console.log(`[${slug}] <-- Success from ${endpoint.url} (Status: ${response.status}, Response: ${JSON.stringify(body).substring(0, 200)}...)`);
        // Increment upstream success counter
        rpcUpstreamResponseTotal.inc({ network: slug, upstream_url: endpoint.url, status_code: String(response.status), outcome: 'success' });
        // Increment client success counter before returning
        rpcClientResponseTotal.inc({ network: slug, status_code: "200" });

        return new Response(JSON.stringify(body), {
          status: response.status,
          statusText: response.statusText,
          headers: {
            'Content-Type': response.headers.get('content-type') || 'application/json',
          }
        });
      } else {
        // Increment upstream HTTP error counter
        rpcUpstreamResponseTotal.inc({ network: slug, upstream_url: endpoint.url, status_code: String(response.status), outcome: 'http_error' });
        // Log non-OK response but continue trying others
        const errorBody = await response.text();
        console.warn(`[${slug}] Failed RPC ${endpoint.url}: Status ${response.status}, Body: ${errorBody.substring(0, 100)}...`);
      }
    } catch (error) {
        clearTimeout(timeoutId); // Clear timeout on error
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (error instanceof Error && error.name === 'AbortError') {
            console.warn(`[${slug}] Failed RPC ${endpoint.url}: Timeout after ${RPC_TIMEOUT_MS}ms`);
            // Increment upstream timeout counter
            rpcUpstreamResponseTotal.inc({ network: slug, upstream_url: endpoint.url, status_code: "-1", outcome: 'timeout' });
        } else {
            console.warn(`[${slug}] Failed RPC ${endpoint.url}: Network error: ${errorMessage}`);
            // Increment upstream network error counter
            rpcUpstreamResponseTotal.inc({ network: slug, upstream_url: endpoint.url, status_code: "-1", outcome: 'network_error' });
        }
        // Continue to the next endpoint
    }
  }

  // If loop finishes, all endpoints failed
  console.error(`[${slug}] <-- All upstream RPCs failed.`);
  // Increment client bad gateway counter
  rpcClientResponseTotal.inc({ network: slug, status_code: "502" });
  return new Response(`Bad Gateway: All configured RPC endpoints for network '${slug}' failed.`, { status: 502 });
}

// --- Server Start ---

if (import.meta.main) {
  // Load combined config including RPC and rate limit settings
  const appConfig = loadAppConfig();

  if (appConfig) {
    console.log(`🚀 Starting RPC proxy server on http://localhost:8000`);
    console.log(`📊 Metrics available via scrape at http://localhost:8000/metrics`);

    // --- Pushgateway Setup ---
    const pushgatewayUrl = Deno.env.get("PROMETHEUS_URL");
    const pushIntervalMs = 15000; // Push every 15 seconds
    let pushIntervalId: number | undefined;

    if (pushgatewayUrl) {
      console.log(` Pushing metrics to Pushgateway: ${pushgatewayUrl} every ${pushIntervalMs}ms`);
      const gateway = new Pushgateway(pushgatewayUrl);
      const jobName = 'rpc-proxy'; // You might want to make this configurable

      // Define the push function with error handling
      const pushMetrics = async () => {
        try {
          // Use pushAdd to not overwrite metrics from other instances using the same job name
          await gateway.pushAdd({ jobName });
          console.log(`[Pushgateway] Metrics pushed successfully to ${pushgatewayUrl}`);
        } catch (err) {
          console.error(`[Pushgateway] Error pushing metrics to ${pushgatewayUrl}:`, err);
        }
      };

      // Initial push
      pushMetrics(); 
      // Set interval for periodic pushes
      pushIntervalId = setInterval(pushMetrics, pushIntervalMs);

      // Optional: Add graceful shutdown for the interval? Deno doesn't have SIGTERM handling built-in easily.
      // Deno.addSignalListener("SIGINT", () => {
      //   console.log("SIGINT received, stopping Pushgateway interval...");
      //   if (pushIntervalId) clearInterval(pushIntervalId);
      //   Deno.exit();
      // });
    }
    // --- End Pushgateway Setup ---
    
    serve(async (req: Request, connInfo: ConnInfo) => {
      const url = new URL(req.url);
      if (url.pathname === "/metrics") {
        // --- Protect /metrics endpoint ---
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
            console.warn(`[Metrics] Unauthorized access attempt to /metrics from ${connInfo.remoteAddr.transport === "tcp" || connInfo.remoteAddr.transport === "udp" ? connInfo.remoteAddr.hostname : 'unknown'}.`);
            return new Response("Unauthorized", { status: 401 });
        }
        // --- End protection ---

        try {
          console.log(`[Metrics] Authorized access to /metrics.`);
          // Use prom-client's default registry
          const metrics = await client.register.metrics(); 
          return new Response(metrics, {
            headers: { "Content-Type": client.register.contentType }, 
          });
        } catch (e) {
          console.error("Error generating metrics:", e);
          return new Response("Error generating metrics", { status: 500 });
        }
      }
      // Otherwise, handle as an RPC request
      return handler(req, connInfo, appConfig);
    }, { port: 8000, hostname: "[::]" });
  } else {
    console.error("❌ Server could not start due to configuration errors.");
    Deno.exit(1); // Exit if config fails
  }
}
