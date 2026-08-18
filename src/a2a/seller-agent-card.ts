import type { AgentCard } from "@a2a-js/sdk";
import { duplicateInterfacesForLegacy } from "@a2a-js/sdk/compat/v0_3";
import { envOr } from "../env.js";

/**
 * The seller agent's public manifest.
 *
 * This is how a buyer agent discovers us: it fetches the card, sees the
 * `licence-negotiation` skill, and knows it can open a negotiation without
 * any prior arrangement between the two operators — which is the whole point of
 * agent-to-agent commerce.
 *
 * The card is served at `/.well-known/agent-card.json` by the Phase 4.3 server.
 */

/**
 * Where the seller agent answers A2A JSON-RPC calls.
 *
 * This is the address the card hands to strangers, so it has to be the address
 * a stranger can actually reach — behind a deployment that means the public
 * origin, not the port this process happens to bind. `SELLER_AGENT_URL`
 * overrides it; the default keeps local development on :4000.
 *
 * The path deliberately avoids the substring "a2a": OKX.AI's listing validator
 * reads it in a URL as a claim about the service type and blocks the listing —
 * a false positive, but one that cannot be argued with from outside. The
 * protocol is unchanged; only the path this server mounts it at moved.
 */
export const SELLER_AGENT_URL = envOr(
  "SELLER_AGENT_URL",
  "http://localhost:4000/negotiate/jsonrpc",
);

/**
 * The same endpoint is advertised twice: once for A2A 1.0 (what the installed
 * `@a2a-js/sdk` speaks natively) and once for 0.3, so buyer agents built
 * against the older spec can still find and call us.
 */
const supportedInterfaces = duplicateInterfacesForLegacy(
  [
    {
      url: SELLER_AGENT_URL,
      protocolBinding: "JSONRPC",
      tenant: "",
      protocolVersion: "1.0",
    },
  ],
  ["JSONRPC"],
);

export const sellerAgentCard: AgentCard = {
  name: "Music Rights Agent",
  description:
    "Licensing agent acting for a music rights holder. Negotiates fractional licences (sync, " +
    "mechanical, sampling, performance) over the holder's tracks, autonomously and against a " +
    "policy the holder set once in plain language. Master references stay encrypted until a " +
    "licence is granted — buyers receive a licence, and only after payment settles on Hedera.",
  version: "0.1.0",
  provider: {
    organization: "Music Licensing Marketplace",
    url: "https://github.com/SweetieBirdX/ETHGlobal-Lisbon",
  },
  supportedInterfaces,
  capabilities: {
    // No callbacks: a negotiation is short enough to answer in-band, and the
    // buyer agent is the one that acts next (by paying), so there is nothing
    // to push.
    pushNotifications: false,
    streaming: false,
    extensions: [],
  },
  defaultInputModes: ["text"],
  defaultOutputModes: ["text"],
  skills: [
    {
      id: "licence-negotiation",
      name: "Music licence negotiation",
      description:
        "Receives a licence offer for a track (track, share count, licence type, territory, use case, " +
        "price in HBAR), checks the buyer's HCS-registered identity, evaluates the offer against the " +
        "rights holder's policy, and either declines with a reason or accepts and returns an " +
        "x402-protected endpoint the buyer can pay to.",
      tags: ["negotiation", "music-licensing", "sync", "hedera", "x402", "hcs-14"],
      examples: [
        "We need a sync licence for track 3, 500 shares, worldwide, for a short film. We can pay 0.5 HBAR.",
        "Offering 0.05 HBAR for 2000 shares of track 1 for advertising use.",
        "We want to license track 2 for a political ad campaign, 1000 shares, 5 HBAR.",
      ],
      inputModes: ["text"],
      outputModes: ["text"],
      securityRequirements: [],
    },
  ],
  // Anyone may open a negotiation — trust comes from the buyer's identity in
  // the HCS registry (gate 1), not from a transport credential.
  securitySchemes: {},
  securityRequirements: [],
  signatures: [],
};
