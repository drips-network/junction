import { loadAppConfig } from "./src/config.ts";
import { startServer } from "./src/server.ts";


if (import.meta.main) {
  console.log("Loading application configuration...");
  const appConfig = loadAppConfig();

  if (appConfig) {
    startServer(appConfig);
  } else {
    console.error("❌ Server could not start due to configuration errors.");
    // Exit with a non-zero code to indicate failure
    Deno.exit(1);
  }
} else {
    // This block is useful if you intend to import parts of main.ts elsewhere,
    // though with the refactor, it's less likely.
    console.log("main.ts loaded as a module, not executing server start.");
}
