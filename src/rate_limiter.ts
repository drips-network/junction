import type { RateLimitConfig } from "./config.ts";


const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute


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
        return true;
    }

    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(ip, { count: 1, windowStart: now });
        return true;
    } else {
        if (record.count < config.rpm) {
            record.count++;
            return true;
        } else {
            return false;
        }
    }
}
