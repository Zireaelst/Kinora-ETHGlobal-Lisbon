import "dotenv/config";
import { ChatGroq } from "@langchain/groq";
import { z } from "zod";
import { envOr } from "../env.js";
import {
  LICENCE_TYPES,
  USE_CASES,
  type LicencePolicy,
} from "../types/marketplace.js";

/**
 * Turns the rights holder's plain-language instructions into a machine-checkable policy.
 *
 * This is the point of the whole design: the artist says once, in their own
 * words, what they are willing to license and for how much — and from then on
 * the agent applies it to every offer without waking them up. The LLM only ever
 * produces this small structured object; it never decides an individual deal.
 */

/**
 * The model that turns the rights holder's sentence into a policy object.
 *
 * Overridable, because a hosted model is not a stable dependency: Groq retired
 * `llama-3.3-70b-versatile` — the model this project was built on — and the
 * deployment answered every request with "Could not interpret the owner's
 * policy", which is the safe reading but leaves the agent unable to sell
 * anything. `GROQ_MODEL` lets that be fixed by configuration rather than a
 * release.
 *
 * Whatever is chosen must support tool calling: the policy is extracted with
 * `withStructuredOutput`, and a model without it fails with
 * "`tool calling` is not supported with this model" rather than a bad answer.
 * Verified against the current catalogue — openai/gpt-oss-120b, gpt-oss-20b and
 * qwen/qwen3.6-27b all parse the canonical sentence correctly.
 */
export const MODEL = envOr("GROQ_MODEL", "openai/gpt-oss-120b");

/** A track's whole licensing capacity, in basis points. */
const FULL_CAPACITY = 10000;

export const policySchema = z.object({
  allowedLicenceTypes: z
    .array(z.string())
    .describe(
      `Licence types the rights holder is willing to grant. Use only: ${LICENCE_TYPES.join(", ")}. Empty array means nothing is licensed.`,
    ),
  minPricePerShareHbar: z
    .number()
    .nonnegative()
    .describe("Minimum acceptable price in HBAR per share (one basis point of a track)."),
  maxSharesPerLicence: z
    .number()
    .int()
    .nonnegative()
    .describe(
      `Largest share of one track a single licence may take, in basis points — ${FULL_CAPACITY} is the whole track, so "half" is 5000 and "5%" is 500.`,
    ),
  forbiddenUseCases: z
    .array(z.string())
    .describe(
      `Uses the rights holder refuses outright. Use only: ${USE_CASES.join(", ")}. Empty array means no use is forbidden.`,
    ),
});

const SYSTEM_PROMPT =
  "You convert a musician's instructions about licensing their own tracks into a strict policy object. " +
  `Valid licence types: ${LICENCE_TYPES.join(", ")}. ` +
  `Valid use cases: ${USE_CASES.join(", ")}. ` +
  `Shares are basis points of one track's licensing capacity: ${FULL_CAPACITY} is the entire track, ` +
  "so 'half' or '50%' is 5000 and '5%' is 500. " +
  "Phrases like 'never for political ads' or 'no political advertising' mean forbiddenUseCases includes political-ad. " +
  "forbiddenUseCases lists ONLY uses the person explicitly refuses; allowedLicenceTypes lists ONLY licence types they actually permit. " +
  "If they give no price, use 0. If they set no share cap, use " +
  `${FULL_CAPACITY}. Never invent licence types or use cases outside the valid lists.`;

function requireApiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      "Missing environment variable GROQ_API_KEY — get a free key at https://console.groq.com/keys and add it to .env.",
    );
  }
  return key;
}

/**
 * Drops anything the model invented outside the known vocabularies.
 *
 * The schema guarantees the *shape*; this guarantees the *contents*. A licence
 * type the marketplace does not trade would silently widen what the agent
 * sells, so an unrecognised value is discarded rather than trusted.
 */
function keepKnown(values: string[], known: readonly string[]): string[] {
  const lookup = new Map(known.map((k) => [k.toLowerCase(), k]));
  const kept = values
    .map((value) => lookup.get(value.trim().toLowerCase()))
    .filter((value): value is string => value !== undefined);
  return [...new Set(kept)];
}

/**
 * Parses a natural-language licensing policy statement.
 *
 * @param input e.g. "Sell sync licences for my tracks, at least 0.05 HBAR per
 * share, never more than 50% in total, and never for political advertising."
 */
export async function parsePolicy(input: string): Promise<LicencePolicy> {
  if (!input.trim()) {
    throw new Error("Policy input is empty — describe what you are willing to license.");
  }

  const model = new ChatGroq({
    model: MODEL,
    apiKey: requireApiKey(),
    // The policy must be the same every time it is parsed, not a sample from a
    // distribution — the user set it once and expects it to stay put.
    temperature: 0,
  });

  const structured = model.withStructuredOutput(policySchema, { name: "policy" });
  const raw = await structured.invoke([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: input },
  ]);

  // Validate again after filtering: the model can satisfy the schema while
  // still naming a licence type the marketplace does not trade, or a share
  // cap larger than a track.
  return policySchema.parse({
    allowedLicenceTypes: keepKnown(raw.allowedLicenceTypes, LICENCE_TYPES),
    minPricePerShareHbar: raw.minPricePerShareHbar,
    maxSharesPerLicence: Math.min(raw.maxSharesPerLicence, FULL_CAPACITY),
    forbiddenUseCases: keepKnown(raw.forbiddenUseCases, USE_CASES),
  });
}
