import type { AppConfig } from "./config.ts";
import { checkRateLimit } from "./rate_limiter.ts";
import { authenticateRequest } from "./auth.ts";
import { extractNetworkSlug, isNetworkConfigured } from "./routing.ts";
import { forwardWithFallback } from "./rpc_client.ts";


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

  // Extract network slug from URL
  const routeMatch = extractNetworkSlug(req.url);
  const slug = routeMatch.slug;

  // Handle authentication and extract client information
  const authHeader = req.headers.get("Authorization");
  const authResult = authenticateRequest(authHeader, rateLimitConfig, info.remoteAddr);

  // Apply rate limiting for non-trusted requests
  if (!authResult.isTrusted && authResult.clientIp) {
    if (!checkRateLimit(authResult.clientIp, rateLimitConfig)) {
      console.warn(`[RateLimit] IP ${authResult.clientIp} exceeded limit of ${rateLimitConfig.rpm} RPM for network ${slug}.`);

      return new Response("Too Many Requests", {
        status: 429,
        headers: { "Retry-After": "60" }
      });
    }
  } else if (!authResult.isTrusted && !authResult.clientIp) {
    // Log if we can't get an IP for rate limiting (e.g., Unix sockets)
    console.warn(`[RateLimit] Cannot apply IP-based rate limit for transport type: ${info.remoteAddr.transport}`);
  }

  // Validate routing
  if (!routeMatch.isValid) {
    console.warn(`[Routing] Request URL did not match expected pattern: ${req.url}`);
    return new Response("Not found", { status: 404 });
  }

  const validSlug = routeMatch.slug;

  // Check if network is configured
  if (!isNetworkConfigured(validSlug, rpcConfig)) {
    console.warn(`[Routing] Network not configured: ${validSlug}`);
    return new Response(`Network not configured: ${validSlug}`, { status: 404 });
  }

  const endpoints = rpcConfig[validSlug];

  // Validate HTTP method
  if (req.method !== "POST") {
    console.warn(`[${validSlug}] Method Not Allowed: ${req.method}`);
    return new Response("Method Not Allowed", { status: 405, headers: { "Allow": "POST" } });
  }

  // Parse and validate request body
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

  // Log request details
  const method = Array.isArray(requestBody) ? 'batch' : requestBody.method ?? 'unknown';
  const id = Array.isArray(requestBody) ? 'batch' : requestBody.id ?? 'N/A';
  console.log(`[${validSlug}] ${authResult.isTrusted ? '[Trusted]' : '[Public]'} --> Method: ${method}, ID: ${id}`);

  const requestBodyString = JSON.stringify(requestBody);
  console.log(`[${validSlug}] Request Body: ${requestBodyString.substring(0, 200)}${requestBodyString.length > 200 ? '...' : ''}`);

  // Forward request with fallback logic
  return await forwardWithFallback(endpoints, requestBody, validSlug);
}
