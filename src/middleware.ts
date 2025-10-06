import { Context } from "@oak/oak";
import type { RateLimitConfig } from "./config.ts";
import { checkRateLimit } from "./rate_limiter.ts";

/**
 * Creates Oak middleware for rate limiting based on client IP and bypass tokens.
 * This middleware should be applied before the main RPC handler.
 */
export function rateLimitMiddleware(rateLimitConfig: RateLimitConfig) {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    // Check for bypass token authentication
    const authHeader = ctx.request.headers.get("Authorization");
    let isTrusted = false;
    
    if (rateLimitConfig.bypassToken && authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7); // Length of "Bearer "
      if (token === rateLimitConfig.bypassToken) {
        isTrusted = true;
        console.log(`[Auth] Trusted request via bypass token.`);
      } else {
        console.warn(`[Auth] Invalid bypass token received from ${ctx.request.ip || 'unknown'}.`);
      }
    }

    // Apply rate limiting for non-trusted requests
    if (!isTrusted && rateLimitConfig.enabled) {
      const clientIp = ctx.request.ip;
      
      if (clientIp && !checkRateLimit(clientIp, rateLimitConfig)) {
        console.warn(`[RateLimit] IP ${clientIp} exceeded limit of ${rateLimitConfig.rpm} RPM.`);

        ctx.response.status = 429;
        ctx.response.headers.set("Retry-After", "60");
        ctx.response.body = "Too Many Requests";
        return;
      } else if (!clientIp) {
        console.warn(`[RateLimit] Cannot determine client IP for rate limiting.`);
      }
    }

    // Set trust flag in context for downstream handlers
    (ctx as any).isTrusted = isTrusted;
    
    await next();
  };
}
