import type { AppConfig } from "./config.ts";
import { checkRateLimit } from "./rate_limiter.ts";


const networkPattern = new URLPattern({ pathname: "/:slug" });
const RPC_TIMEOUT_MS = 10000; // 10 seconds timeout for upstream RPC calls


/**
 * Handles an incoming JSON-RPC request, performing authentication, rate limiting,
 * forwarding to upstream providers, and recording metrics.
 *
 * @param req The incoming request object.
 * @param info Connection information (including remote address).
 * @param appConfig The application configuration.
 * @returns A promise resolving to the Response object.
 */
export async function handleRpcRequest(req: Request, info: Deno.ServeHandlerInfo, appConfig: AppConfig): Promise<Response> {
  const { rpc: rpcConfig, rateLimit: rateLimitConfig } = appConfig;

  // Use 'unknown' if slug extraction fails, useful for metrics before returning 404 or 429
  const url = new URL(req.url); // Need URL object for pattern matching
  const match = networkPattern.exec(url);
  const slug = match?.pathname?.groups?.slug ?? "unknown";

  let isTrusted = false;
  const authHeader = req.headers.get("Authorization");
  if (rateLimitConfig.bypassToken && authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7); // Length of "Bearer "
      if (token === rateLimitConfig.bypassToken) {
          isTrusted = true;
          console.log(`[Auth] Trusted request via bypass token.`);
      } else {
          // Log invalid token attempt but treat as untrusted for rate limiting
          const clientIp = info.remoteAddr.transport === "tcp" || info.remoteAddr.transport === "udp"
              ? info.remoteAddr.hostname
              : 'unknown_transport';
          console.warn(`[Auth] Invalid bypass token received from ${clientIp}.`);
      }
  }

  if (!isTrusted) {
      const remoteAddr = info.remoteAddr;
      // Ensure we have a hostname (IP address) to key the rate limit off
      if (remoteAddr.transport === "tcp" || remoteAddr.transport === "udp") {
          const ip = remoteAddr.hostname;
          if (!checkRateLimit(ip, rateLimitConfig)) {
              console.warn(`[RateLimit] IP ${ip} exceeded limit of ${rateLimitConfig.rpm} RPM for network ${slug}.`);

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

  if (!match?.pathname?.groups?.slug) {
    // This case should ideally not be hit if slug was 'unknown' before,
    // but keep it as a safeguard if pattern matching fails unexpectedly.
    console.warn(`[Routing] Request URL did not match expected pattern: ${req.url}`);
    return new Response("Not found", { status: 404 });
  }

  const validSlug = match.pathname.groups.slug;

  const endpoints = rpcConfig[validSlug];
  if (!endpoints) {
    console.warn(`[Routing] Network not configured: ${validSlug}`);
    return new Response(`Network not configured: ${validSlug}`, { status: 404 });
  }

  if (req.method !== "POST") {
    console.warn(`[${validSlug}] Method Not Allowed: ${req.method}`);
    return new Response("Method Not Allowed", { status: 405, headers: { "Allow": "POST" } });
  }

  let requestBody;
  try {
    requestBody = await req.json();
    // Basic validation: check if it's an object (could be more specific)
    if (typeof requestBody !== 'object' || requestBody === null) {
        throw new Error("Request body is not a JSON object.");
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[${validSlug}] Invalid JSON body: ${message}`);
    return new Response(`Bad Request: Invalid JSON body. ${message}`, { status: 400 });
  }

  const method = Array.isArray(requestBody) ? 'batch' : requestBody.method ?? 'unknown';
  const id = Array.isArray(requestBody) ? 'batch' : requestBody.id ?? 'N/A';
  console.log(`[${validSlug}] ${isTrusted ? '[Trusted]' : '[Public]'} --> Method: ${method}, ID: ${id}`);

  const requestBodyString = JSON.stringify(requestBody);
  console.log(`[${validSlug}] Request Body: ${requestBodyString.substring(0, 200)}${requestBodyString.length > 200 ? '...' : ''}`);

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

    try {
      const headers = new Headers({
        "Content-Type": "application/json",
        // Consider adding other headers like User-Agent if needed
      });
      if (endpoint.authToken) {
        headers.set("Authorization", endpoint.authToken);
      }

      console.log(`[${validSlug}] Attempting RPC: ${endpoint.url}`);

      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(requestBody), // Use the parsed and validated body
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseBodyText = await response.text(); // Read body once

      if (response.ok) {
        let responseBodyJson;
        try {
            responseBodyJson = JSON.parse(responseBodyText);
        } catch (parseError) {
            const message = parseError instanceof Error ? parseError.message : String(parseError);
            console.error(`[${validSlug}] Failed to parse JSON response from ${endpoint.url}: ${message}. Body: ${responseBodyText.substring(0, 200)}...`);
            continue;
        }

        console.log(`[${validSlug}] <-- Success from ${endpoint.url} (Status: ${response.status}, Response: ${responseBodyText.substring(0, 200)}${responseBodyText.length > 200 ? '...' : ''})`);

        return new Response(JSON.stringify(responseBodyJson), {
          status: response.status, // Use original status
          // Copy relevant headers from upstream? Be selective.
          headers: { 'Content-Type': 'application/json' } // Ensure correct content type
        });
      } else {
        console.warn(`[${validSlug}] Failed RPC ${endpoint.url}: Status ${response.status}, Body: ${responseBodyText.substring(0, 100)}...`);
      }
    } catch (error) {
        clearTimeout(timeoutId);
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (error instanceof Error && error.name === 'AbortError') {
            console.warn(`[${validSlug}] Failed RPC ${endpoint.url}: Timeout after ${RPC_TIMEOUT_MS}ms`);
        } else {
            console.warn(`[${validSlug}] Failed RPC ${endpoint.url}: Network/Fetch error: ${errorMessage}`);
            // outcome remains 'network_error'
        }

    }
  }

  console.error(`[${validSlug}] <-- All upstream RPCs failed.`);

  return new Response(`Bad Gateway: All configured RPC endpoints for network '${validSlug}' failed.`, { status: 502 });
}
