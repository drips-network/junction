import { Application, Router, Context } from "@oak/oak";
import type { AppConfig } from "./config.ts";
import { rateLimitMiddleware } from "./middleware.ts";
import { createRpcHandler } from "./rpc_handler_oak.ts";

const SERVER_PORT = 8000;

/**
 * Creates and configures CORS middleware for Oak application.
 */
function corsMiddleware() {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    if (ctx.request.method === "OPTIONS") {
      ctx.response.status = 204;
      ctx.response.headers.set("Access-Control-Allow-Origin", "*");
      ctx.response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      ctx.response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      ctx.response.headers.set("Access-Control-Max-Age", "86400");
      return;
    }
    
    await next();
    ctx.response.headers.set("Access-Control-Allow-Origin", "*");
  };
}

/**
 * Creates and configures logging middleware for Oak application.
 */
function loggingMiddleware() {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.log(`${ctx.request.method} ${ctx.request.url.pathname} - ${ctx.response.status} - ${ms}ms`);
  };
}

/**
 * Starts the RPC proxy server using Oak framework.
 *
 * @param appConfig The loaded application configuration.
 */
export function startServer(appConfig: AppConfig): void {
  const app = new Application();
  const router = new Router();

  // Add global middleware
  app.use(loggingMiddleware());
  app.use(corsMiddleware());

  // Health check endpoint
  router.get("/health", (ctx) => {
    ctx.response.status = 200;
    ctx.response.headers.set("Content-Type", "text/plain");
    ctx.response.body = "OK";
  });

  // RPC endpoints - handle any network slug with rate limiting and RPC forwarding
  router.post("/:network", 
    rateLimitMiddleware(appConfig.rateLimit),
    createRpcHandler(appConfig)
  );

  // Add router routes to app
  app.use(router.routes());
  app.use(router.allowedMethods());

  console.log(`🚀 Starting RPC proxy server with Oak on http://localhost:${SERVER_PORT}`);

  app.listen({ port: SERVER_PORT });
}