import { Hbar } from "@hiero-ledger/sdk";
import type { Network } from "@x402/core/types";

/**
 * Shared facts about the paid licence endpoint.
 *
 * Kept apart from `server.ts` because that module starts listening as soon as
 * it is imported — the seller agent needs to *describe* the endpoint when it
 * accepts an offer, without booting a second copy of it.
 *
 * There is deliberately no fixed price here: every licence is priced per
 * negotiation via `quotePrice` (shares × the track's per-share rate), and the
 * x402 route quotes the same amount dynamically from the licence row.
 */

export const X402_PORT = 4021;

export const X402_BASE_URL =
  process.env.X402_BASE_URL ?? `http://localhost:${X402_PORT}`;

export const LICENCE_GRANT_PATH = "/licence/grant";

/** HBAR amounts are advertised in ℏ but charged in tinybars (10⁻⁸ ℏ). */
export function hbarToTinybar(hbar: number | string): string {
  return Hbar.fromString(String(hbar)).toTinybars().toString();
}

/** Native HBAR. Hedera's own token has no contract address — it is asset 0.0.0. */
export const HBAR_ASSET_ID = "0.0.0";

export const NETWORK: Network = "hedera:testnet";

/* ------------------------------------------------------------------ *
 * Second settlement rail: X Layer (OKX's L2)
 * ------------------------------------------------------------------ */

/**
 * The licence endpoint can quote the same licence on more than one chain.
 *
 * Identity (HCS-14), the audit trail (HCS) and the certificate (HTS, with its
 * royalty) all stay on Hedera — only *where the money moves* varies. A buyer
 * agent holding no HBAR can then still license a track, which is the whole
 * point of advertising a second rail rather than migrating to one.
 *
 * Every constant below was verified against X Layer testnet at block
 * 0x2451312 rather than copied from documentation — see ANALYSIS.md §11. That
 * mattered: the token is an ERC-1967 proxy, so the EIP-3009 selectors live in
 * the implementation (0x73406f06…) and a naive check of the token address
 * finds nothing.
 */
export const XLAYER_TESTNET: Network = "eip155:1952";

/** USD₮0 on X Layer testnet. Proxy address — the one a signature must name. */
export const XLAYER_USDT0_ADDRESS = "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c";

/** Confirmed on-chain via `decimals()`. */
export const XLAYER_USDT0_DECIMALS = 6;

/**
 * EIP-712 domain of the USD₮0 contract.
 *
 * `version` has no on-chain getter (`version()` reverts), so it was recovered
 * by reproducing `DOMAIN_SEPARATOR()`: of 18 candidate combinations only
 * name="USD₮0", version="1", chainId=1952, verifyingContract=<proxy> yields
 * 0xd2406dc8a5f31c1f65263669534de22dea0363db6ca41e1094e98442907ff982, which is
 * what the contract returns. Change either value and every signature this
 * server asks for would be rejected on-chain.
 */
export const XLAYER_USDT0_EIP712_NAME = "USD₮0";
export const XLAYER_USDT0_EIP712_VERSION = "1";

/** Where X Layer payments land. An EVM address, unlike the Hedera payee. */
export const X402_XLAYER_PAY_TO = process.env.X402_XLAYER_PAY_TO;

/**
 * Facilitator that verifies and settles X Layer payments.
 *
 * Separate from `X402_FACILITATOR_URL` because no single facilitator covers
 * both rails: blocky402 settles Hedera and knows nothing of `eip155:1952`, and
 * OKX's own facilitator is X Layer mainnet under an authenticated SA API. The
 * resource server takes an array of facilitators for exactly this reason.
 */
export const X402_XLAYER_FACILITATOR_URL = process.env.X402_XLAYER_FACILITATOR_URL;

/**
 * Whether the X Layer rail is switched on. Off unless explicitly enabled.
 *
 * **This started life as a three-state flag** — `off` / `advertise` / `settle` —
 * on the assumption that a rail could be quoted for OKX tooling to read
 * without being payable yet. The SDK does not permit that, and it is right not
 * to: `x402HTTPResourceServer.initialize()` validates every `accepts[]` entry
 * against the registered schemes *and* against what the facilitators report
 * through `/supported`, refusing to start otherwise:
 *
 *     RouteConfigurationError: Route "GET /licence/grant":
 *       Facilitator does not support scheme "exact" on network "eip155:1952"
 *
 * So a quote-only rail is not a thing that can exist here, and the honesty
 * concern behind the three states is enforced by the library rather than by
 * us: you cannot advertise what nothing can settle. What remains is a plain
 * on/off, where "on" means a facilitator genuinely stands behind it.
 */
export function xlayerRailEnabled(): boolean {
  const raw = (process.env.X402_XLAYER_RAIL ?? "off").trim().toLowerCase();
  return raw === "on" || raw === "true" || raw === "1";
}

/**
 * True when the rail is enabled *and* fully configured.
 *
 * Both a payee and a facilitator are required: without the first there is
 * nowhere to send the money, without the second the server would refuse to
 * boot at all, which is a worse failure than quietly staying on one rail.
 */
export function xlayerAdvertised(): boolean {
  return (
    xlayerRailEnabled() &&
    Boolean(X402_XLAYER_PAY_TO) &&
    Boolean(X402_XLAYER_FACILITATOR_URL)
  );
}

/**
 * Demo-time HBAR→USD rate, used to price the X Layer rail.
 *
 * The catalogue prices a share in HBAR, but USD₮0 is a dollar stablecoin, so
 * the two rails need a rate between them. A fixed, configurable number is the
 * honest version of this for now: it is stated rather than implied, and it is
 * the seam where a live feed (OKX market data) would attach. A demo must not
 * silently invent an exchange rate it presents as a market price.
 */
export const HBAR_USD_RATE = Number(process.env.HBAR_USD_RATE ?? "0.28");

/**
 * Converts a licence's HBAR quote into USD₮0 base units.
 *
 * Floors at one base unit: a licence cheap enough to round to zero would
 * otherwise be advertised as free, and a zero-amount payment requirement is
 * not something a buyer agent can meaningfully sign.
 */
export function hbarToUsdt0BaseUnits(hbar: number): string {
  const units = Math.round(hbar * HBAR_USD_RATE * 10 ** XLAYER_USDT0_DECIMALS);
  return String(Math.max(1, units));
}
