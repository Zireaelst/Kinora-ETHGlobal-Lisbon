import "dotenv/config";
import express from "express";
import { envNumber, envString } from "./env.js";
import { assertStartupConfig } from "./startup-check.js";

/**
 * All three services on one port, for a hosted deployment.
 *
 *   npm start
 *
 * Locally the seller agent, the licence endpoint and the panel each get their
 * own port (`npm run dev`). A platform like Railway or Render exposes exactly
 * one port per service, so this composes the same three Express apps into one.
 *
 * They can share a port because their paths do not overlap:
 *
 *   /.well-known/agent-card.json, /negotiate/jsonrpc   seller agent
 *   /catalog, /licence/grant                     x402 licence endpoint
 *   /, /api/*                                    demo panel
 *
 * One process rather than three services is also required, not merely tidy:
 * the policy saved in the panel lives in the seller agent's memory, so a panel
 * in a separate process would only be talking to itself.
 */

const PORT = envNumber("PORT", 8080);

async function main(): Promise<void> {
  // Before anything else, and before the imports below. Those modules read
  // their configuration as they load and throw on the first thing missing, so
  // a static import here would crash on one variable at a time — five missing
  // settings, five redeploys. This reports the whole set and stops.
  assertStartupConfig();

  const [{ createSellerApp }, { SELLER_AGENT_URL }, x402, { createWebApp }, { X402_BASE_URL }] =
    await Promise.all([
      import("./a2a/seller-server.js"),
      import("./a2a/seller-agent-card.js"),
      import("./x402/server.js"),
      import("./web/server.js"),
      import("./x402/config.js"),
    ]);

  const app = express();

  // Order matters: the panel claims "/", so it is mounted last. Express matches
  // in registration order and a router mounted at "/" would otherwise shadow
  // everything after it.
  app.use(createSellerApp());
  app.use(x402.app);
  app.use(createWebApp());

  /**
   * Liveness for the platform's health check.
   *
   * Deliberately not `/` — that serves the panel, and a health check that only
   * proves a static file can be read says nothing about whether the agent can
   * still take an offer.
   */
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, agent: SELLER_AGENT_URL, x402: X402_BASE_URL });
  });

  // Settle the rails before accepting traffic, so the first buyer is not the
  // one who discovers a facilitator is unreachable.
  await x402.initialisePayments();

  app.listen(PORT, () => {
    console.log(`Kinora listening on :${PORT}`);
    console.log(
      `  agent card   ${SELLER_AGENT_URL.replace("/negotiate/jsonrpc", "")}/.well-known/agent-card.json`,
    );
    console.log(`  a2a jsonrpc  ${SELLER_AGENT_URL}`);
    console.log(`  licence      ${X402_BASE_URL}/licence/grant`);
    console.log(`  catalogue    ${X402_BASE_URL}/catalog`);
    console.log(`  panel        ${X402_BASE_URL}/`);

    if (!envString("DATA_DB_PATH")) {
      console.warn(
        `[config] DATA_DB_PATH is unset, so the catalogue lives in the container's filesystem` +
          ` and is lost on every redeploy. Point it at a mounted volume.`,
      );
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
