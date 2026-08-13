import "dotenv/config";
import { requireAuditTopicId } from "./audit.js";
import { envOr } from "../env.js";

/**
 * Reading the audit topic back off the mirror node.
 *
 * The point of writing to HCS is that a third party can check it, so anything
 * asserting on the trail should read it the way a third party would — through
 * the public mirror node, the same source HashScan renders — rather than
 * trusting what the app believes it wrote.
 *
 * The topic carries several kinds of message (sales, compliance attestations,
 * and the Agent Kit hook's plain-text lines), so counting raw sequence numbers
 * says only that the topic grew. {@link countTopicEvents} answers the question
 * that actually matters: what was recorded.
 */

export const MIRROR_NODE =
  envOr("HEDERA_MIRROR_NODE_URL", "https://testnet.mirrornode.hedera.com");

export interface TopicMessage {
  sequenceNumber: number;
  /** Consensus timestamp as the mirror node reports it (`seconds.nanos`). */
  consensusTimestamp: string;
  /** Decoded message body. */
  text: string;
  /** Parsed body when it is JSON — the Agent Kit hook writes prose. */
  json?: Record<string, unknown>;
}

interface MirrorTopicMessage {
  sequence_number: number;
  consensus_timestamp: string;
  message: string;
  chunk_info?: {
    initial_transaction_id?: {
      account_id: string;
      transaction_valid_start: string;
    } | null;
    number: number;
    total: number;
  } | null;
}

/**
 * Fetches the most recent messages on the topic, newest first.
 *
 * A single HCS message tops out at 1024 bytes; the SDK transparently splits
 * larger payloads into chunks, which the mirror node returns as separate rows.
 * Messages carrying UAIDs and inline document URIs cross that limit, so chunks
 * are reassembled here (grouped by their initiating transaction) — a caller
 * always sees whole logical messages. A group cut off by the page boundary
 * decodes as a fragment, which simply fails JSON parsing like any prose line.
 *
 * @param limit how many raw rows to read (the mirror node caps a page at 100);
 *              chunked messages mean the logical count can come back smaller
 */
export async function fetchTopicMessages(
  limit = 100,
  topicId: string = requireAuditTopicId(),
): Promise<TopicMessage[]> {
  const response = await fetch(
    `${MIRROR_NODE}/api/v1/topics/${topicId}/messages?order=desc&limit=${limit}`,
    { signal: AbortSignal.timeout(20_000) },
  );

  if (!response.ok) {
    throw new Error(
      `Mirror node responded ${response.status} for topic ${topicId} — it may not have seen the topic yet.`,
    );
  }

  const body = (await response.json()) as { messages?: MirrorTopicMessage[] };

  return groupChunkRows(body.messages ?? []).map(decodeChunkGroup);
}

/** Groups chunk rows back into logical messages, preserving newest-first order. */
function groupChunkRows(rows: MirrorTopicMessage[]): MirrorTopicMessage[][] {
  const groups: MirrorTopicMessage[][] = [];
  const byInitialTx = new Map<string, MirrorTopicMessage[]>();
  for (const row of rows) {
    const info = row.chunk_info;
    const tx = info?.initial_transaction_id;
    if (!info || info.total <= 1 || !tx) {
      groups.push([row]);
      continue;
    }
    const key = `${tx.account_id}@${tx.transaction_valid_start}`;
    const group = byInitialTx.get(key);
    if (group) {
      group.push(row);
    } else {
      const started = [row];
      byInitialTx.set(key, started);
      groups.push(started);
    }
  }
  return groups;
}

/** Reassembles one chunk group into a decoded logical message. */
function decodeChunkGroup(group: MirrorTopicMessage[]): TopicMessage {
  const chunks = [...group].sort(
    (a, b) => (a.chunk_info?.number ?? 1) - (b.chunk_info?.number ?? 1),
  );
  // Concatenate as bytes before decoding — a chunk boundary can fall inside
  // a multi-byte UTF-8 character.
  const text = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk.message, "base64")),
  ).toString("utf8");
  let json: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") {
      json = parsed as Record<string, unknown>;
    }
  } catch {
    // Not ours — the Agent Kit's audit hook writes plain text.
  }
  const last = chunks[chunks.length - 1]!;
  return {
    sequenceNumber: last.sequence_number,
    consensusTimestamp: last.consensus_timestamp,
    text,
    json,
  };
}

/** Highest sequence number on the topic, or 0 when it is empty. */
export async function topicSequence(
  topicId: string = requireAuditTopicId(),
): Promise<number> {
  const messages = await fetchTopicMessages(1, topicId);
  return messages[0]?.sequenceNumber ?? 0;
}

/**
 * Counts messages recording a given event with a sequence number > `afterSequence`.
 *
 * This is the only sound way to assert "N of these were written during my
 * run". Counting within a fixed window of recent messages looked equivalent
 * until the topic outgrew the window: every new message then pushes an old one
 * out, so the windowed count of an event can go *down* while the topic only
 * ever appends — which made "+1 sale" assertions fail with deltas like -4.
 * A sequence baseline cannot slide.
 */
export async function countTopicEventsSince(
  event: string,
  afterSequence: number,
  topicId: string = requireAuditTopicId(),
): Promise<number> {
  // Collect every raw row above the baseline first, THEN group: a chunked
  // message parses only as a whole, and its chunks can straddle a page.
  const rows: MirrorTopicMessage[] = [];
  let url = `${MIRROR_NODE}/api/v1/topics/${topicId}/messages?order=desc&limit=100`;
  let reachedBaseline = false;

  // A test run writes ~10 messages, so one page is the norm; the loop is a
  // guard against a busy topic, not an expectation.
  for (let page = 0; page < 5 && !reachedBaseline; page += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      throw new Error(`Mirror node responded ${response.status} for topic ${topicId}.`);
    }
    const body = (await response.json()) as {
      messages?: MirrorTopicMessage[];
      links?: { next?: string | null };
    };
    const messages = body.messages ?? [];

    for (const message of messages) {
      if (message.sequence_number <= afterSequence) {
        reachedBaseline = true;
        break;
      }
      rows.push(message);
    }

    if (!body.links?.next || messages.length === 0) break;
    url = `${MIRROR_NODE}${body.links.next}`;
  }

  return groupChunkRows(rows)
    .map(decodeChunkGroup)
    .filter((message) => message.json?.["event"] === event).length;
}
