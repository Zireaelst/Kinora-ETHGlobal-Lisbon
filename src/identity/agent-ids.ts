import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { envString } from "../env.js";

/**
 * Reads the agent UAIDs written by `scripts/register-agents-hcs.ts`.
 *
 * Both sides of the negotiation need these: the buyer to say who it is, the
 * seller to decide whether that identity is one it will deal with.
 */

export interface RegisteredAgentRecord {
  uaid: string;
  accountId: string;
  transactionId: string;
}

interface AgentUaidsFile {
  seller: RegisteredAgentRecord;
  buyer: RegisteredAgentRecord;
  registeredAt: string;
}

const AGENT_UAIDS_FILE = "agent-uaids.json";

let cached: AgentUaidsFile | null = null;

function loadAgentUaids(): AgentUaidsFile {
  if (cached) return cached;

  if (!existsSync(AGENT_UAIDS_FILE)) {
    throw new Error(
      `${AGENT_UAIDS_FILE} not found — run \`npx tsx scripts/register-agents-hcs.ts\` to register the agent identities.`,
    );
  }

  cached = JSON.parse(readFileSync(AGENT_UAIDS_FILE, "utf8")) as AgentUaidsFile;
  return cached;
}

/** Env override exists so a test can act as an agent that is not in the file. */
export function getBuyerUaid(): string {
  return envString("BUYER_UAID") ?? loadAgentUaids().buyer.uaid;
}

export function getSellerUaid(): string {
  return envString("SELLER_UAID") ?? loadAgentUaids().seller.uaid;
}

/**
 * The rights holder's own allow-list, not an independent auditor.
 *
 * A real deployment would read an attestation signed by an audit body; for the
 * hackathon the seller simply keeps a list of UAIDs it has vetted. Being on the
 * identity registry proves an agent exists — this is the separate question of
 * whether the rights holder is willing to license to it.
 */
export function getApprovedUaids(): string[] {
  const configured = envString("APPROVED_UAIDS");
  if (configured) {
    return configured.split(",").map((uaid) => uaid.trim()).filter(Boolean);
  }
  // Falls back through getBuyerUaid rather than straight to the file, so a
  // deployment that sets BUYER_UAID is not left with an empty allow-list. It
  // was: agent-uaids.json is written locally and gitignored, so in a container
  // this reached for a file that does not exist and gate 1 refused every
  // buyer — with "cannot be verified right now", which reads like a mirror-node
  // outage rather than a missing setting.
  return [getBuyerUaid()];
}
