import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import {
  UserBuilder,
  agentCardHandler,
  jsonRpcHandler,
} from "@a2a-js/sdk/server/express";
import { SELLER_AGENT_URL, sellerAgentCard } from "./seller-agent-card.js";
import { SellerExecutor } from "./seller-executor.js";

/**
 * The seller agent as a network service.
 *
 * A buyer agent that has never heard of us can fetch the card from the
 * well-known URL, read the negotiation skill off it, and start sending offers
 * to the JSON-RPC endpoint — no shared configuration between the two sides.
 *
 *   npx tsx src/a2a/seller-server.ts
 */

/**
 * Port from the URL advertised in the agent card, so the two cannot drift.
 *
 * A public https:// URL carries no explicit port, and `URL.port` is then the
 * empty string — which would bind port 0 and listen somewhere nobody was told
 * about. Behind a deployment the advertised URL and the bound port are
 * genuinely different things, so fall back to the local default and let the
 * process decide what to listen on.
 */
export const SELLER_PORT = Number(new URL(SELLER_AGENT_URL).port) || 4000;

/** Path the card advertises for JSON-RPC (`/negotiate/jsonrpc`). */
export const SELLER_JSONRPC_PATH = new URL(SELLER_AGENT_URL).pathname;

export const AGENT_CARD_PATH = "/.well-known/agent-card.json";

/**
 * Builds the Express app without starting it, so the Phase 4.5 end-to-end test
 * can own the server lifecycle.
 */
export function createSellerApp(): Express {
  const requestHandler = new DefaultRequestHandler(
    sellerAgentCard,
    new InMemoryTaskStore(),
    new SellerExecutor(),
  );

  const app = express();

  // `legacyCompat` on both routes: the card advertises a v0.3 JSONRPC
  // interface, so buyers built against either spec version can transact.
  app.use(
    AGENT_CARD_PATH,
    agentCardHandler({
      agentCardProvider: requestHandler,
      legacyCompat: { enabled: true },
    }),
  );

  app.use(
    SELLER_JSONRPC_PATH,
    jsonRpcHandler({
      requestHandler,
      // Anyone may open a negotiation — the buyer proves who they are with
      // their ERC-8004 identity (Phase 5.4), not with a transport credential.
      userBuilder: UserBuilder.noAuthentication,
      legacyCompat: { enabled: true },
    }),
  );

  return app;
}

export function startSellerServer(port: number = SELLER_PORT) {
  const server = createSellerApp().listen(port, () => {
    console.log(`Seller agent listening on http://localhost:${port}`);
    console.log(`  agent card: http://localhost:${port}${AGENT_CARD_PATH}`);
    console.log(`  json-rpc:   http://localhost:${port}${SELLER_JSONRPC_PATH}`);
  });
  return server;
}

// Only start listening when run directly, not when imported by a test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startSellerServer();
}
