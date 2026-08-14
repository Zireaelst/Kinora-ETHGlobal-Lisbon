import { randomUUID } from "node:crypto";
import { Role, TaskState, type Message, type Part } from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { checkAvailability, quotePrice, UnknownTrackError } from "../data/catalog.js";
import {
  insertLicence,
  openDatabase,
  reserveShares,
  setLicenceCertificate,
  updateLicenceStatus,
  type LicenceRow,
} from "../data/db.js";
import { VALIDATION_TAG } from "../identity/attestation.js";
import { SCORE_SUCCESS, submitFeedback } from "../identity/reputation.js";
import { accountIdFromUaid } from "../identity/uaid.js";
import { verifyBuyerIdentity } from "../identity/verify.js";
import { logAuditEvent } from "../hedera/audit.js";
import { createSellerClient } from "../hedera/clients.js";
import { certificateTokenId, mintCertificate } from "../hedera/certificate.js";
import { parsePolicy } from "../policy/parser.js";
import type { IdentityCheck, LicenceOffer, LicencePolicy } from "../types/marketplace.js";
import {
  HBAR_ASSET_ID,
  hbarToTinybar,
  LICENCE_GRANT_PATH,
  NETWORK,
  X402_BASE_URL,
} from "../x402/config.js";
import { envString } from "../env.js";

/**
 * The seller agent's negotiation logic.
 *
 * An offer passes through three gates in order, and each one can only ever
 * narrow what happens next: is the buyer who they say they are (HCS identity
 * registry), does
 * the owner's policy permit this sale, and can the cohort be reported without
 * exposing an individual. No human is involved in any of them.
 */

export type NegotiationDecision = "accept" | "decline";

/** Why an offer was turned down, for the reply and the audit trail. */
export type DeclineReason =
  | "identity_unverified"
  | "offer_incomplete"
  /** The buyer asked for a licence type the policy does not permit. */
  | "licence_type_not_permitted"
  /** The buyer named a use the rights holder forbids outright. */
  | "use_case_forbidden"
  /** The buyer asked for more shares than one licence may carry. */
  | "share_cap_exceeded"
  | "price_too_low"
  /** The track has fewer shares left than the licence asks for. */
  | "insufficient_shares"
  /** The catalogue holds no such track. */
  | "unknown_track"
  /** Something failed on the seller's side; the buyer is not at fault. */
  | "internal_error";

/**
 * Everything the buyer agent needs to pay and collect, sent with an
 * acceptance. It can act on this without a human reading the reply.
 */
export interface PaymentInstruction {
  /** x402-protected URL, with the agreed cohort criteria already applied. */
  url: string;
  method: "GET";
  /** What the endpoint will charge, in HBAR. */
  priceHbar: string;
  /** The same amount in tinybar, which is what actually gets signed. */
  priceTinybar: string;
  /** Native HBAR (`0.0.0`). */
  asset: string;
  network: string;
  scheme: "exact";
}

export interface NegotiationResult {
  decision: NegotiationDecision;
  reply: string;
  reason?: DeclineReason;
  /** Shares of the track still available, reported with an availability refusal. */
  availableShares?: number;
  /**
   * The owner's floor, disclosed on a price refusal. The prose already states
   * it ("the rights holder's minimum is 0.5 HBAR"); this is the same fact in a
   * form a counter-offering agent can act on without parsing sentences. Only
   * price refusals disclose it — a licence-type or use-case refusal is not a
   * matter of price, and says nothing more.
   */
  minPriceHbar?: number;
  /** Present only on an acceptance. */
  payment?: PaymentInstruction;
}

/**
 * The owner's policy, as typed in plain language.
 *
 * Overridable with `POLICY_STATEMENT` so a demo can change the rules without a
 * code change; Phase 8.2's form calls {@link setPolicy} instead.
 *
 * **The floor is set below the cheapest track on purpose.** The policy floor
 * (`minPricePerShareHbar × shares`) and the price the endpoint charges
 * (`quotePrice` — the track's own per-share rate × shares) are two independent
 * numbers, and a floor above a track's rate means an offer at that track's own
 * asking price is refused. The seeded catalogue runs 0.00082–0.00198 ℏ per
 * share, so 0.0008 clears every track rather than only the expensive ones. Keep
 * it at or below the cheapest track whenever the catalogue is reseeded.
 */
export const DEFAULT_POLICY_STATEMENT =
  envString("POLICY_STATEMENT") ??
  "You can grant sync and sampling licences on my tracks to verified buyers, at least " +
    "0.0008 HBAR per share, up to 5000 shares per licence. Never license my music for " +
    "political advertising.";

let cachedPolicy: LicencePolicy | null = null;

/**
 * Returns the active policy, parsing the statement once.
 *
 * Parsing per negotiation would put an LLM call on the critical path of every
 * offer and risk the answer drifting between them; the owner set the policy
 * once, so it is interpreted once.
 */
export async function getPolicy(): Promise<LicencePolicy> {
  if (cachedPolicy) return cachedPolicy;

  try {
    cachedPolicy = await parsePolicy(DEFAULT_POLICY_STATEMENT);
  } catch (error) {
    // If the owner's instructions cannot be interpreted, the safe reading is
    // "sell nothing" — never "sell anything".
    throw new Error(
      `Could not interpret the owner's policy, so no sale can be authorised: ${String(error).slice(0, 160)}`,
    );
  }

  return cachedPolicy;
}

/** Replaces the active policy — used by the frontend and by tests. */
export function setPolicy(policy: LicencePolicy | null): void {
  cachedPolicy = policy;
}

/**
 * A text part. The protobuf-derived `Part` type requires `metadata`,
 * `filename` and `mediaType` to be present even when a part is plain text.
 */
function textPart(value: string): Part {
  return {
    content: { $case: "text", value },
    metadata: undefined,
    filename: "",
    mediaType: "text/plain",
  };
}

/** Pulls the plain text out of an A2A message, ignoring non-text parts. */
export function extractText(message: Message): string {
  return message.parts
    .map((part) => (part.content?.$case === "text" ? part.content.value : ""))
    .join(" ")
    .trim();
}

/**
 * Builds the paid-endpoint instruction for an accepted offer.
 *
 * The criteria are baked into the URL by the seller rather than left to the
 * buyer, so the request that gets paid for is the one that was negotiated.
 */
export function buildPaymentInstruction(
  offer: Required<Pick<LicenceOffer, "trackId" | "shares" | "licenceType" | "useCase">> &
    Pick<LicenceOffer, "territory">,
  licenceId: number,
  /** The licence's quote (`quotePrice`) — each licence is priced per negotiation. */
  quotedPriceHbar: number,
): PaymentInstruction {
  // The negotiated terms are baked into the URL by the seller rather than left
  // to the buyer — the x402 gate compares them against the stored acceptance,
  // so a buyer cannot widen the licence afterwards.
  const params = new URLSearchParams({
    trackId: String(offer.trackId),
    shares: String(offer.shares),
    licenceType: offer.licenceType,
    useCase: offer.useCase,
  });
  if (offer.territory) params.set("territory", offer.territory);
  // Carries the negotiation into the payment, so the seller can tie a settled
  // transaction back to the buyer and terms that were agreed.
  params.set("licenceId", String(licenceId));

  return {
    url: `${X402_BASE_URL}${LICENCE_GRANT_PATH}?${params}`,
    method: "GET",
    priceHbar: String(quotedPriceHbar),
    priceTinybar: hbarToTinybar(quotedPriceHbar),
    asset: HBAR_ASSET_ID,
    network: NETWORK,
    scheme: "exact",
  };
}

export interface CompletedSale {
  licenceId: number;
  buyerUaid: string;
  transactionId: string;
  /** HCS sequence number of the audit entry, when the write succeeded. */
  auditSequenceNumber?: number;
  /** HCS sequence number of the reputation feedback, when the write succeeded. */
  feedbackIndex?: string;
  /** Set when the sale was already recorded and nothing was written again. */
  alreadyCompleted?: boolean;
  /** HTS licence certificate NFT handed to the payer, when one was minted. */
  certificate?: { serial: number; hashscanUrl: string };
  /** Steps that failed, so a partial completion is never reported as clean. */
  errors: string[];
}

/**
 * Everything the seller does *after* a payment settles, in order:
 * write the audit entry to HCS, publish reputation feedback about the buyer,
 * take the shares out of the track's capacity (only now — an accepted offer
 * reserves nothing), mint the licence certificate NFT to the account that
 * paid, then mark the licence complete in the ledger.
 *
 * Each step is attempted even if an earlier one failed — a reputation outage
 * should not cost the audit trail its record — and every failure is reported
 * back rather than swallowed.
 *
 * Runs at most once per negotiation. Neither of the Hedera writes is
 * idempotent: feedback appends a new entry every time it is submitted, so a
 * sale recorded twice would rate the buyer twice for one payment.
 */
/** A Hedera account id, as opposed to an EVM address or anything else. */
const HEDERA_ACCOUNT_ID = /^\d+\.\d+\.\d+$/;

/**
 * Decides which account receives the licence certificate.
 *
 * Normally the payer: whoever settled is who gets the proof. That breaks once
 * a licence can be paid for on another chain — an X Layer settlement reports
 * an EVM address as its payer, and handing that to a Hedera transfer does not
 * fail. It silently auto-creates a *new* Hedera account aliased to that
 * address and delivers the certificate there, leaving it stranded away from
 * the agent that negotiated for it and unassociated with anything.
 *
 * So a payer is used only when it is genuinely a Hedera account. Otherwise the
 * certificate goes to the account named by the buyer's UAID — the identity
 * that was verified at gate 1 and that the whole licence is recorded against,
 * which is the more honest answer even on the Hedera rail.
 */
export function certificateAccountFor(
  payerAccountId: string | undefined,
  buyerUaid: string,
): string | undefined {
  if (payerAccountId && HEDERA_ACCOUNT_ID.test(payerAccountId)) return payerAccountId;

  try {
    return accountIdFromUaid(buyerUaid);
  } catch {
    return undefined;
  }
}

export async function recordCompletedSale(
  licenceId: number,
  transactionId: string,
  /** Account that settled the payment — where the certificate NFT goes. */
  payerAccountId?: string,
): Promise<CompletedSale> {
  const db = openDatabase();
  const errors: string[] = [];

  try {
    const licence = db
      .prepare("SELECT * FROM licences WHERE id = ?")
      .get(licenceId) as LicenceRow | undefined;

    if (!licence) {
      throw new Error(`No negotiation recorded for licence ${licenceId}`);
    }

    // Already recorded: leave the original transaction, audit entry and rating
    // exactly as they are. A second run here would publish a second reputation
    // feedback for one payment, which is how a buyer would inflate its rating.
    if (licence.status === "completed") {
      return {
        licenceId,
        buyerUaid: licence.buyer_uaid,
        transactionId: licence.tx_hash ?? transactionId,
        alreadyCompleted: true,
        errors,
      };
    }

    const result: CompletedSale = {
      licenceId,
      buyerUaid: licence.buyer_uaid,
      transactionId,
      errors,
    };

    // 1. Audit trail on HCS — the public, tamper-evident record that this
    //    exchange happened, carrying the attestation that admitted the buyer.
    const seller = createSellerClient();
    try {
      const audit = await logAuditEvent(seller, {
        event: "licence_completed",
        licenceId,
        buyerUaid: licence.buyer_uaid,
        trackId: licence.track_id,
        shares: licence.shares,
        licenceType: licence.licence_type,
        territory: licence.territory,
        useCase: licence.use_case,
        priceHbar: licence.price,
        paymentTransactionId: transactionId,
        ...(licence.attestation_hash ? { attestationHash: licence.attestation_hash } : {}),
      });
      result.auditSequenceNumber = audit.sequenceNumber;
    } catch (error) {
      errors.push(`HCS audit log failed: ${String(error).slice(0, 160)}`);
    } finally {
      seller.close();
    }

    // 2. Reputation — the buyer paid as agreed, and the feedback cites the
    //    transaction so the claim is checkable. Recorded on the HCS identity
    //    topic, keyed by the buyer's UAID.
    try {
      const feedback = await submitFeedback(
        licence.buyer_uaid,
        SCORE_SUCCESS,
        transactionId,
      );
      result.feedbackIndex = String(feedback.sequenceNumber);
    } catch (error) {
      errors.push(`Reputation feedback failed: ${String(error).slice(0, 160)}`);
    }

    // 3. Capacity. Settlement is the moment shares actually leave the track —
    //    reserving on acceptance would let a buyer exhaust a track by
    //    negotiating and never paying. The WHERE-clause guard in reserveShares
    //    is what loses a race gracefully instead of overselling.
    if (!reserveShares(db, licence.track_id, licence.shares)) {
      errors.push(
        `Could not reserve ${licence.shares} shares of track ${licence.track_id} — ` +
          "capacity was taken by a competing settlement.",
      );
    }

    // 4. Certificate NFT — the product's on-chain half, minted to the buyer.
    //    Best-effort like the steps above; the sale stands either way. The
    //    completed-guard at the top is what makes this run-once.
    const tokenId = certificateTokenId();
    const certificateRecipient = certificateAccountFor(payerAccountId, licence.buyer_uaid);
    if (!tokenId) {
      // Not configured is not a failure — run scripts/create-licence-token.ts
      // to enable certificates.
      console.warn(
        `[certificate] HTS_LICENCE_TOKEN_ID is not set — no certificate NFT for licence ${licenceId}`,
      );
    } else if (!certificateRecipient) {
      console.warn(
        `[certificate] no Hedera account for the buyer — no certificate NFT for licence ${licenceId}`,
      );
    } else {
      try {
        const minted = await mintCertificate({
          tokenId,
          trackId: licence.track_id,
          shares: licence.shares,
          licenceType: licence.licence_type,
          buyerAccountId: certificateRecipient,
          auditSequenceNumber: result.auditSequenceNumber,
        });
        setLicenceCertificate(db, licenceId, String(minted.serial));
        result.certificate = { serial: minted.serial, hashscanUrl: minted.hashscanUrl };
      } catch (error) {
        errors.push(`Certificate NFT mint failed: ${String(error).slice(0, 160)}`);
      }
    }

    // 5. Local ledger.
    updateLicenceStatus(db, licenceId, "completed", transactionId);

    return result;
  } finally {
    db.close();
  }
}

/** Reads the offer out of the message metadata the buyer client attaches. */
/** Reads the licence offer out of the message metadata the buyer client attaches. */
export function extractOffer(message: Message): LicenceOffer {
  const metadata = message.metadata ?? {};

  const numberOf = (value: unknown): number | undefined => {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const stringOf = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value : undefined;

  return {
    ...(numberOf(metadata["trackId"]) !== undefined
      ? { trackId: numberOf(metadata["trackId"]) }
      : {}),
    ...(numberOf(metadata["shares"]) !== undefined
      ? { shares: numberOf(metadata["shares"]) }
      : {}),
    ...(stringOf(metadata["licenceType"]) ? { licenceType: stringOf(metadata["licenceType"]) } : {}),
    ...(stringOf(metadata["territory"]) ? { territory: stringOf(metadata["territory"]) } : {}),
    ...(stringOf(metadata["useCase"]) ? { useCase: stringOf(metadata["useCase"]) } : {}),
    ...(numberOf(metadata["offeredPriceHbar"]) !== undefined
      ? { priceHbar: numberOf(metadata["offeredPriceHbar"]) }
      : {}),
  };
}

/** Names a use case the way the refusal sentence needs it said. */
function describeUseCase(useCase: string): string {
  const labels: Record<string, string> = {
    "political-ad": "political advertising",
    advertising: "advertising",
    film: "a film",
    game: "a game",
    documentary: "a documentary",
  };
  return labels[useCase] ?? useCase;
}

/**
 * Decides a licence offer against the rights holder's policy.
 *
 * Pure and synchronous, so the rules can be tested without a network: the
 * share-availability check happens separately in `execute`.
 */
export function evaluateOffer(
  offer: LicenceOffer,
  policy: LicencePolicy,
): NegotiationResult {
  // 1. Incomplete. Every gate below needs its field, so all of them are
  // required — including the use case: an offer that names none would slip
  // past the forbidden-use check unexamined.
  if (
    offer.trackId === undefined ||
    offer.shares === undefined ||
    !Number.isFinite(offer.shares) ||
    offer.shares <= 0 ||
    !offer.licenceType ||
    !offer.useCase ||
    offer.priceHbar === undefined ||
    Number.isNaN(offer.priceHbar)
  ) {
    return {
      decision: "decline",
      reason: "offer_incomplete",
      reply:
        "Your offer is incomplete. Send the track, the number of shares, the licence type, " +
        "the intended use and the price in HBAR you are offering, and I will evaluate it " +
        "against the rights holder's policy.",
    };
  }

  const licenceType = offer.licenceType.trim().toLowerCase();
  const useCase = offer.useCase.trim().toLowerCase();

  // 2. Licence type.
  if (!policy.allowedLicenceTypes.includes(licenceType)) {
    return {
      decision: "decline",
      reason: "licence_type_not_permitted",
      reply:
        `The rights holder's policy does not permit ${licenceType} licences. ` +
        `Permitted licence types: ${policy.allowedLicenceTypes.join(", ") || "none at present"}. ` +
        "This is not a matter of price.",
    };
  }

  // 3. Forbidden use. The refusal names the use, because "declined" without
  // the why is indistinguishable from a haggling position — this one is not.
  if (policy.forbiddenUseCases.includes(useCase)) {
    return {
      decision: "decline",
      reason: "use_case_forbidden",
      reply:
        `You asked to use this track in ${describeUseCase(useCase)}. ` +
        "The rights holder's policy forbids that use. This is not a matter of price.",
    };
  }

  // 4. Share cap.
  if (offer.shares > policy.maxSharesPerLicence) {
    return {
      decision: "decline",
      reason: "share_cap_exceeded",
      reply:
        `You asked for ${offer.shares} shares, and the rights holder grants at most ` +
        `${policy.maxSharesPerLicence} per licence. Reduce the share count and I will reconsider.`,
    };
  }

  // 5. Price. Rounded to 8 decimals — one tinybar is 10⁻⁸ ℏ, so anything
  // finer cannot settle, and unrounded float products fail equality checks.
  const floorHbar = Number((policy.minPricePerShareHbar * offer.shares).toFixed(8));
  if (offer.priceHbar < floorHbar) {
    return {
      decision: "decline",
      reason: "price_too_low",
      minPriceHbar: floorHbar,
      reply:
        `Price too low — you offered ${offer.priceHbar} HBAR and the rights holder's minimum is ` +
        `${floorHbar} HBAR for ${offer.shares} shares (${policy.minPricePerShareHbar} ℏ per share). ` +
        "Raise the offer and I will reconsider.",
    };
  }

  return {
    decision: "accept",
    reply:
      `Offer accepted: a ${licenceType} licence on track ${offer.trackId}, ${offer.shares} shares` +
      `${offer.territory ? `, ${offer.territory}` : ""}, for ${describeUseCase(useCase)}, ` +
      `at ${offer.priceHbar} HBAR. Settle the x402 payment and the licence will be granted. ` +
      "The master reference stays encrypted until then.",
  };
}

// Gate 1 itself lives in src/identity/verify.ts: four checks against the HCS
// identity registry, each failing closed, imported above. Re-exported so the
// tests that exercise the gate through the executor keep one import path.
export { verifyBuyerIdentity };
export type { IdentityCheck };

export class SellerExecutor implements AgentExecutor {
  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    // A negotiation must always end in an answer. Anything unexpected becomes a
    // decline the buyer can read, never a hung request or a stack trace.
    try {
      await this.negotiate(requestContext, eventBus);
    } catch (error) {
      console.error("[negotiation] unexpected failure:", error);
      this.publishReply(requestContext, eventBus, {
        decision: "decline",
        reason: "internal_error",
        reply:
          "I could not complete this negotiation because of a problem on my side. " +
          "Nothing has been charged. Please try again shortly.",
      });
    }
  }

  /**
   * What the previous round said, when this message continues an open task.
   *
   * The task's current status carries the seller's own last reply, so the
   * previous verdict is read from a record this executor wrote — no separate
   * session store to drift out of sync.
   */
  private priorRound(requestContext: RequestContext):
    | { round: number; decision?: string; reason?: string; priceHbar?: number }
    | undefined {
    const previousReply = requestContext.task?.status?.message;
    if (!previousReply) return undefined;

    const metadata = previousReply.metadata ?? {};
    const price = Number(metadata["offeredPriceHbar"]);
    return {
      round: Number(metadata["round"]) || 1,
      decision: typeof metadata["decision"] === "string" ? metadata["decision"] : undefined,
      reason: typeof metadata["reason"] === "string" ? metadata["reason"] : undefined,
      priceHbar: Number.isFinite(price) ? price : undefined,
    };
  }

  private async negotiate(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const buyerUaid = requestContext.userMessage.metadata?.["buyerUaid"];

    // Gate 1 — identity. An unidentified or unverified buyer never reaches the
    // policy, so no offer from one can be accepted.
    if (typeof buyerUaid !== "string") {
      this.publishReply(requestContext, eventBus, {
        decision: "decline",
        reason: "identity_unverified",
        reply:
          "Identify yourself before making an offer: include your UAID as `buyerUaid` " +
          "in the message metadata so I can verify you against the identity registry.",
      });
      return;
    }

    const identity = await verifyBuyerIdentity(buyerUaid);
    if (!identity.verified) {
      this.publishReply(
        requestContext,
        eventBus,
        {
          decision: "decline",
          reason: "identity_unverified",
          reply: `Identity check failed — ${identity.reason}. I only negotiate with verified agents.`,
        },
        identity,
      );
      return;
    }

    // Gate 2 — the owner's policy.
    const offer = extractOffer(requestContext.userMessage);
    const verdict = evaluateOffer(offer, await getPolicy());
    if (verdict.decision === "decline") {
      // Refusals are recorded too: what the agent turned down on the owner's
      // behalf is as much a part of the story as what it sold.
      this.recordDecline(buyerUaid, offer, verdict.reason);
      this.publishReply(requestContext, eventBus, verdict, identity);
      return;
    }

    // Gate 3 — does the track still have that many shares? Checking here,
    // before the buyer is routed to the paid endpoint, is what stops them
    // paying for a licence the catalogue could not grant.
    let availableShares: number;
    try {
      const availability = await checkAvailability(offer.trackId!, offer.shares!);
      availableShares = availability.availableShares;
      if (!availability.sufficient) {
        this.publishReply(
          requestContext,
          eventBus,
          {
            decision: "decline",
            reason: "insufficient_shares",
            availableShares,
            reply:
              `You asked for ${availability.requestedShares / 100}% but only ` +
              `${availability.availableShares / 100}% of this track's capacity is still available. ` +
              "Reduce the share count and I will reconsider — you have not been charged.",
          },
          identity,
        );
        return;
      }
    } catch (error) {
      if (error instanceof UnknownTrackError) {
        this.publishReply(
          requestContext,
          eventBus,
          {
            decision: "decline",
            reason: "unknown_track",
            reply: `Track ${offer.trackId} is not in the catalogue. Ask for the catalogue and pick a track from it.`,
          },
          identity,
        );
        return;
      }
      throw error;
    }

    // Record the agreed terms before handing out a payment URL, so a settled
    // payment can be matched back to who agreed to what. The attestation hash
    // rides on the row, tying the grant to the gate-1 record that admitted
    // this buyer.
    const db = openDatabase();
    let licenceId: number;
    try {
      licenceId = insertLicence(db, {
        trackId: offer.trackId!,
        buyerUaid,
        shares: offer.shares!,
        licenceType: offer.licenceType!.trim().toLowerCase(),
        territory: offer.territory?.trim().toLowerCase() || "worldwide",
        useCase: offer.useCase!.trim().toLowerCase(),
        price: offer.priceHbar!,
        status: "accepted",
        ...(identity.attestation
          ? { attestationHash: identity.attestation.requestHash }
          : {}),
      });
    } finally {
      db.close();
    }

    // Priced per negotiation: shares × the track's per-share rate. The x402
    // route computes the same quote from the licence row, so the amount the
    // buyer is told here is the amount the endpoint will actually charge.
    const quotedPriceHbar = await quotePrice(offer.trackId!, offer.shares!);

    const payment = buildPaymentInstruction(
      {
        trackId: offer.trackId!,
        shares: offer.shares!,
        licenceType: offer.licenceType!.trim().toLowerCase(),
        useCase: offer.useCase!.trim().toLowerCase(),
        ...(offer.territory ? { territory: offer.territory.trim().toLowerCase() } : {}),
      },
      licenceId,
      quotedPriceHbar,
    );

    this.publishReply(
      requestContext,
      eventBus,
      {
        ...verdict,
        availableShares,
        payment,
        reply:
          `${verdict.reply} ` +
          `Pay ${payment.priceHbar} HBAR (${payment.priceTinybar} tinybar, asset ${payment.asset}) ` +
          `on ${payment.network} and ${payment.method} ${payment.url} — the same request returns the licence grant once settled.`,
      },
      identity,
    );
  }

  /**
   * Records a refused offer in the ledger.
   *
   * Only offers complete enough to have been judged on their merits are kept —
   * a malformed message is not a decision the owner made. Best-effort: a
   * bookkeeping failure must never change the answer the buyer receives.
   */
  private recordDecline(
    buyerUaid: string,
    offer: LicenceOffer,
    _reason?: DeclineReason,
  ): void {
    // Only offers complete enough to have been judged on their merits are
    // kept — a malformed message is not a decision the rights holder made.
    if (
      offer.trackId === undefined ||
      offer.shares === undefined ||
      !offer.licenceType ||
      !offer.useCase ||
      offer.priceHbar === undefined ||
      Number.isNaN(offer.priceHbar)
    ) {
      return;
    }

    try {
      const db = openDatabase();
      try {
        insertLicence(db, {
          trackId: offer.trackId,
          buyerUaid,
          shares: offer.shares,
          licenceType: offer.licenceType.trim().toLowerCase(),
          territory: offer.territory?.trim().toLowerCase() || "worldwide",
          useCase: offer.useCase.trim().toLowerCase(),
          price: offer.priceHbar,
          status: "declined",
        });
      } finally {
        db.close();
      }
    } catch (error) {
      console.error("[ledger] could not record a declined offer:", error);
    }
  }

  /**
   * Publishes one reply and settles this round of the task.
   *
   * The audit (session 45) found the old version emitted a bare message and
   * never touched the task store, so every reply carried a `taskId` the server
   * itself could not resume — "Task not found" on any follow-up. Now the first
   * round persists a real Task and every reply arrives as a status update, so
   * the id in the reply is one the buyer can genuinely continue:
   *
   *   accept          → COMPLETED       (negotiation over, go pay)
   *   policy decline  → INPUT_REQUIRED  (the reply invites a counter-offer)
   *   unverified / internal error → FAILED (no invitation to continue)
   */
  private publishReply(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
    result: NegotiationResult,
    identity?: IdentityCheck,
  ): void {
    const prior = this.priorRound(requestContext);
    const round = (prior?.round ?? 0) + 1;

    // A counter-offer is answered as part of the same conversation, and the
    // reply says so — the buyer should not have to diff task ids to know the
    // seller remembers the last round.
    const reply = prior
      ? `Round ${round} of our negotiation — last round you offered ` +
        `${prior.priceHbar ?? "?"} HBAR and I ${prior.decision === "accept" ? "accepted" : "declined"}` +
        `${prior.reason ? ` (${prior.reason})` : ""}. ${result.reply}`
      : result.reply;

    const response: Message = {
      messageId: randomUUID(),
      contextId: requestContext.contextId,
      taskId: requestContext.taskId,
      role: Role.ROLE_AGENT,
      parts: [textPart(reply)],
      // The buyer agent needs to branch on the outcome without parsing prose,
      // and the identity result is what the audit trail records.
      metadata: {
        decision: result.decision,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.minPriceHbar !== undefined ? { minPriceHbar: result.minPriceHbar } : {}),
        ...(result.availableShares !== undefined
          ? { availableShares: result.availableShares }
          : {}),
        // The buyer agent pays straight from this, without reading the prose.
        ...(result.payment ? { payment: result.payment } : {}),
        identityVerified: identity?.verified ?? false,
        identityReason: identity?.reason ?? "no identity supplied",
        // Session bookkeeping: which round this reply settles, and what the
        // buyer offered — the next round's continuity line is built from this.
        round,
        offeredPriceHbar: extractOffer(requestContext.userMessage).priceHbar ?? null,
        // The buyer can fetch this off the topic and check the verdict itself
        // rather than taking the seller's word for the refusal.
        ...(identity?.attestation
          ? {
              attestation: {
                requestHash: identity.attestation.requestHash,
                response: identity.attestation.response,
                tag: VALIDATION_TAG,
                requestTransactionId: identity.attestation.requestTransactionId,
                responseTransactionId: identity.attestation.responseTransactionId,
                hashscanUrl: identity.attestation.hashscanUrl,
              },
            }
          : {}),
      },
      extensions: [],
      referenceTaskIds: [],
    };

    // First round: persist the task, so the id this reply carries is one the
    // buyer can actually come back to. Continuations skip this — the task is
    // already in the store, which is how the request got here at all.
    if (!requestContext.task) {
      eventBus.publish(
        AgentEvent.task({
          id: requestContext.taskId,
          contextId: requestContext.contextId,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            message: undefined,
            timestamp: new Date().toISOString(),
          },
          artifacts: [],
          history: [requestContext.userMessage],
          metadata: undefined,
        }),
      );
    }

    const state =
      result.decision === "accept"
        ? TaskState.TASK_STATE_COMPLETED
        : result.reason === "identity_unverified" || result.reason === "internal_error"
          ? TaskState.TASK_STATE_FAILED
          : TaskState.TASK_STATE_INPUT_REQUIRED;

    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId: requestContext.taskId,
        contextId: requestContext.contextId,
        status: { state, message: response, timestamp: new Date().toISOString() },
        metadata: undefined,
      }),
    );
    eventBus.finished();
  }

  /**
   * Tasks here live exactly as long as one request — every round is answered
   * within the call that delivered it — so there is never an in-flight task to
   * interrupt, and cancellation stays a no-op.
   */
  async cancelTask(
    _taskId: string,
    _eventBus: ExecutionEventBus,
  ): Promise<void> {}
}
