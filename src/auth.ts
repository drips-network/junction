import type { RateLimitConfig } from "./config.ts";

export interface AuthResult {
  isTrusted: boolean;
  clientIp?: string;
}

/**
 * Handles authentication and determines if a request is from a trusted source.
 * 
 * @param authHeader The Authorization header value
 * @param rateLimitConfig Rate limit configuration containing bypass token
 * @param remoteAddr Connection information for client IP extraction
 * @returns Authentication result indicating trust level and client IP
 */
export function authenticateRequest(
  authHeader: string | null,
  rateLimitConfig: RateLimitConfig,
  remoteAddr: Deno.NetAddr
): AuthResult {
  let isTrusted = false;
  let clientIp: string | undefined;

  // Extract client IP for rate limiting
  if (remoteAddr.transport === "tcp" || remoteAddr.transport === "udp") {
    clientIp = remoteAddr.hostname;
  }

  // Check for bypass token authentication
  if (rateLimitConfig.bypassToken && authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7); // Length of "Bearer "
    if (token === rateLimitConfig.bypassToken) {
      isTrusted = true;
      console.log(`[Auth] Trusted request via bypass token.`);
    } else {
      // Log invalid token attempt but treat as untrusted for rate limiting
      console.warn(`[Auth] Invalid bypass token received from ${clientIp ?? 'unknown'}.`);
    }
  }

  return { isTrusted, clientIp };
}