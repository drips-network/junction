import { RouterContext } from "@oak/oak";
import type { AppConfig } from "./config.ts";
import { isNetworkConfigured } from "./routing.ts";
import { forwardWithFallback } from "./rpc_client.ts";

/**
 * Oak-native RPC handler that uses the modular components.
 * This version is specifically designed for Oak framework contexts.
 * 
 * @param appConfig The application configuration
 * @returns Oak middleware function
 */
export function createRpcHandler(appConfig: AppConfig) {
  return async (ctx: RouterContext<"/:network">) => {
    const { rpc: rpcConfig } = appConfig;

    // Extract network slug from URL params (Oak handles this automatically)
    const networkSlug = ctx.params?.network;
    
    if (!networkSlug) {
      console.warn(`[Routing] No network slug provided in URL: ${ctx.request.url.pathname}`);
      ctx.response.status = 404;
      ctx.response.body = "Not found - network slug required";
      return;
    }

    // Check if network is configured
    if (!isNetworkConfigured(networkSlug, rpcConfig)) {
      console.warn(`[Routing] Network not configured: ${networkSlug}`);
      ctx.response.status = 404;
      ctx.response.body = `Network not configured: ${networkSlug}`;
      return;
    }

    const endpoints = rpcConfig[networkSlug];

    // Validate HTTP method
    if (ctx.request.method !== "POST") {
      console.warn(`[${networkSlug}] Method Not Allowed: ${ctx.request.method}`);
      ctx.response.status = 405;
      ctx.response.headers.set("Allow", "POST");
      ctx.response.body = "Method Not Allowed";
      return;
    }

    // Parse and validate request body
    let requestBody;
    try {
      if (!ctx.request.hasBody) {
        throw new Error("Request body is required.");
      }
      
      requestBody = await ctx.request.body.json();
      // Basic validation: check if it's an object (could be more specific)
      if (typeof requestBody !== 'object' || requestBody === null) {
        throw new Error("Request body is not a JSON object.");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[${networkSlug}] Invalid JSON body: ${message}`);
      ctx.response.status = 400;
      ctx.response.body = `Bad Request: Invalid JSON body. ${message}`;
      return;
    }

    // Log request details
    const isTrusted = (ctx as any).isTrusted || false; // Set by rate limit middleware
    const method = Array.isArray(requestBody) ? 'batch' : requestBody.method ?? 'unknown';
    const id = Array.isArray(requestBody) ? 'batch' : requestBody.id ?? 'N/A';
    console.log(`[${networkSlug}] ${isTrusted ? '[Trusted]' : '[Public]'} --> Method: ${method}, ID: ${id}`);

    const requestBodyString = JSON.stringify(requestBody);
    console.log(`[${networkSlug}] Request Body: ${requestBodyString.substring(0, 200)}${requestBodyString.length > 200 ? '...' : ''}`);

    // Forward request with fallback logic
    const response = await forwardWithFallback(endpoints, requestBody, networkSlug);
    
    // Map Response back to Oak context
    ctx.response.status = response.status;
    for (const [key, value] of response.headers) {
      ctx.response.headers.set(key, value);
    }
    
    if (response.body) {
      ctx.response.body = await response.text();
    }
  };
}
