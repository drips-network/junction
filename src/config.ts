import { z } from "zod";


const RpcEndpointSchema = z.object({
  url: z.string().url(),
  authToken: z.string().optional(),
});

const RpcConfigSchema = z.record(z.string(), z.array(RpcEndpointSchema).min(1));

export type RpcConfig = z.infer<typeof RpcConfigSchema>;

export interface RateLimitConfig {
  enabled: boolean;
  rpm: number;
  bypassToken: string | null;
}

export interface AppConfig {
  rpc: RpcConfig;
  rateLimit: RateLimitConfig;
}


export function loadAppConfig(): AppConfig | null {
  try {
    // Load .env file, allowing override by actual environment variables
    // Note: Deno's std/dotenv load() is often used, but Deno also loads .env automatically in recent versions.
    // Relying on Deno.env.get() is generally sufficient.
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
