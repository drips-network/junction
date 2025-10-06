import { loadAppConfig } from "./src/config.ts";

// Support both server implementations for compatibility
const useOak = Deno.env.get("USE_OAK_SERVER") === "true";

if (import.meta.main) {
  console.log("Loading application configuration...");
  const appConfig = loadAppConfig();

  if (appConfig) {
    if (useOak) {
      console.log("Starting Oak-based server...");
      const { startServer } = await import("./src/server_oak.ts");
      startServer(appConfig);
    } else {
      console.log("Starting original Deno.serve-based server...");
      const { startServer } = await import("./src/server.ts");
      startServer(appConfig);
    }
  } else {
    console.error("❌ Server could not start due to configuration errors.");
    Deno.exit(1);
  }
}