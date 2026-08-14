import "dotenv/config";
import express from "express";
import { createSellerApp } from "./a2a/seller-server.js";
import { SELLER_AGENT_URL } from "./a2a/seller-agent-card.js";
import { app as x402App, initialisePayments } from "./x402/server.js";
import { createWebApp } from "./web/server.js";
import { X402_BASE_URL } from "./x402/config.js";
import { envNumber, envString } from "./env.js";

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
 *   /.well-known/agent-card.json, /a2a/jsonrpc   seller agent
 *   /catalog, /licence/grant                     x402 licence endpoint
 *   /, /api/*                                    demo panel
 *
 * One process rather than three services is also required, not merely tidy:
 * the policy saved in the panel lives in the seller agent's memory, so a panel
 * in a separate process would only be talking to itself.
 */

const PORT = envNumber("PORT", 8080);

const app = express();

// Order matters: the panel claims "/", so it is mounted last. Express matches
// in registration order and a router mounted at "/" would otherwise shadow
// everything after it.
app.use(createSellerApp());
app.use(x402App);
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

async function main(): Promise<void> {
  // Settle the rails before accepting traffic, so the first buyer is not the
  // one who discovers a facilitator is unreachable.
  await initialisePayments();

  app.listen(PORT, () => {
    console.log(`Kinora listening on :${PORT}`);
    console.log(`  agent card   ${SELLER_AGENT_URL.replace("/a2a/jsonrpc", "")}/.well-known/agent-card.json`);
    console.log(`  a2a jsonrpc  ${SELLER_AGENT_URL}`);
    console.log(`  licence      ${X402_BASE_URL}/licence/grant`);
    console.log(`  catalogue    ${X402_BASE_URL}/catalog`);
    console.log(`  panel        ${X402_BASE_URL}/`);

    // These are what a buyer agent is told to come back to. Pointing at
    // localhost from a hosted process is the failure that looks like it works:
    // every response is correct and no stranger can act on any of it.
    for (const [name, value] of [
      ["SELLER_AGENT_URL", SELLER_AGENT_URL],
      ["X402_BASE_URL", X402_BASE_URL],
    ] as const) {
      if (value.includes("localhost") || value.includes("127.0.0.1")) {
        console.warn(
          `[config] ${name} is ${value} — set it to this deployment's public https:// origin,` +
            ` or the addresses handed to buyer agents will be unreachable.`,
        );
      }
    }

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
