import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { createApiRouter } from "./api.js";
import { envNumber } from "../env.js";

/**
 * The demo panel.
 *
 * A deliberately plain single-page app: the interesting part of this project is
 * what the agents do, not the interface. It reads the same policy, database and
 * agent identities the agents use, so what it shows is the system's real state
 * rather than a mock-up.
 *
 *   npx tsx src/web/server.ts   →  http://localhost:4100
 */

export const WEB_PORT = envNumber("WEB_PORT", 4100);

const here = dirname(fileURLToPath(import.meta.url));

export function createWebApp() {
  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.sendFile(join(here, "index.html"));
  });

  app.use("/api", createApiRouter());

  return app;
}

export function startWebServer(port: number = WEB_PORT) {
  return createWebApp().listen(port, () => {
    console.log(`Demo panel on http://localhost:${port}`);
  });
}

// Only start listening when run directly, so a test can own the lifecycle.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startWebServer();
}
