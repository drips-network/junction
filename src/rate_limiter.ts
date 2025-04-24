import type { RateLimitConfig } from "./config.ts"; // Import the type

// --- Rate Limiter State ---

// Store IP -> { count: number, windowStart: number }
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

// --- Rate Limiter Check Function ---

/**
 * Checks if a request from a given IP is allowed based on the rate limit configuration.
 * Updates the rate limit count for the IP if the request is allowed.
 *
 * @param ip The IP address of the client.
 * @param config The rate limit configuration.
 * @returns True if the request is allowed, false otherwise.
 */
export function checkRateLimit(ip: string, config: RateLimitConfig): boolean {
    if (!config.enabled) {
        return true; // Rate limiting disabled
    }

    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
        // Start new window or first request
        rateLimitMap.set(ip, { count: 1, windowStart: now });
        // console.log(`[RateLimit] New window for IP ${ip}. Count: 1`); // Debug logging
        return true;
    } else {
        // Existing window
        if (record.count < config.rpm) {
            record.count++;
            // console.log(`[RateLimit] IP ${ip} allowed. Count: ${record.count}/${config.rpm}`); // Debug logging
            return true;
        } else {
            // Limit exceeded
            // console.warn(`[RateLimit] IP ${ip} blocked. Count: ${record.count}/${config.rpm}`); // Debug logging
            return false;
        }
    }
}
