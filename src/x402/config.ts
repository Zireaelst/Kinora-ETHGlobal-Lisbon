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

/**
 * A settlement asset on X Layer, with the EIP-712 domain a payer signs under.
 *
 * Every field here was read off the chain rather than taken from a document —
 * see ANALYSIS.md §11 for the method and why it matters: both tokens are
 * proxies, so a naive look at the token address finds no EIP-3009 selectors at
 * all, and the domain is what decides whether a signature verifies.
 */
export interface XLayerAsset {
  address: string;
  decimals: number;
  /** EIP-712 domain `name`, from the contract's own `name()`. */
  eip712Name: string;
  /** EIP-712 domain `version`. */
  eip712Version: string;
}

/**
 * USDC_TEST — the asset OKX's own testnet mock merchant charges in, and the
 * one the demo buyer wallet actually holds. This is the default.
 *
 * ⚠️ **The version here is "2", and OKX's mock merchant says "1".**
 * `GET https://www.okx.com/api/v1/pay/mock-merchant/resource` advertises
 * `extra: {"version":"1","name":"USDC_TEST"}`, but the contract disagrees and
 * the contract is what verifies the signature:
 *
 *     version()          → "2"
 *     DOMAIN_SEPARATOR() → 0x7513e76c6d38c7986bcfe857d0e0772d5050d9db65ef5a941d1e15859baef959
 *
 * and that separator is reproduced by name="USDC_TEST", version="2",
 * chainId=1952, verifyingContract=<this address> — not by version="1". A payer
 * signing under "1" builds a different digest and `transferWithAuthorization`
 * rejects it. We publish the value the chain agrees with; if OKX's facilitator
 * turns out to insist on its own, override it (see `xlayerAsset`) rather than
 * editing this constant, so the verified value stays on record.
 */
export const XLAYER_USDC_TEST: XLayerAsset = {
  address: "0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d",
  decimals: 6,
  eip712Name: "USDC_TEST",
  eip712Version: "2",
};

/**
 * USD₮0 — the default asset OKX's Go SDK declares for `eip155:1952`.
 *
 * Kept because it is the documented default and fully verified (EIP-3009 in
 * both the v,r,s and bytes variants, domain name "USD₮0" version "1"
 * reproducing 0xd2406dc8…907ff982), but it is *not* what the demo wallet holds
 * and not what OKX's own merchant uses, so it is not the default here.
 */
export const XLAYER_USDT0: XLayerAsset = {
  address: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
  decimals: 6,
  eip712Name: "USD₮0",
  eip712Version: "1",
};

/**
 * The asset this server quotes on X Layer.
 *
 * `X402_XLAYER_ASSET=usdt0` switches to USD₮0; `X402_XLAYER_EIP712_VERSION`
 * overrides just the domain version, which exists solely so a disagreement
 * with OKX's facilitator can be settled by configuration instead of a patch.
 */
export function xlayerAsset(): XLayerAsset {
  const base =
    (process.env.X402_XLAYER_ASSET ?? "").trim().toLowerCase() === "usdt0"
      ? XLAYER_USDT0
      : XLAYER_USDC_TEST;

  const versionOverride = process.env.X402_XLAYER_EIP712_VERSION?.trim();
  return versionOverride ? { ...base, eip712Version: versionOverride } : base;
}

/** Where X Layer payments land. An EVM address, unlike the Hedera payee. */
export const X402_XLAYER_PAY_TO = process.env.X402_XLAYER_PAY_TO;

/**
 * Whether OKX facilitator credentials are configured.
 *
 * X Layer is settled by OKX's facilitator, which is authenticated (HMAC over
 * an API key/secret/passphrase from the OKX developer portal) rather than an
 * open URL like blocky402. No single facilitator covers both rails, which is
 * why the resource server takes an array of them.
 */
export function okxCredentialsPresent(): boolean {
  return Boolean(
    process.env.OKX_API_KEY && process.env.OKX_SECRET_KEY && process.env.OKX_PASSPHRASE,
  );
}

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
 * Both a payee and facilitator credentials are required: without the first
 * there is nowhere to send the money, without the second the server would
 * refuse to boot at all, which is a worse failure than quietly staying on one
 * rail.
 */
export function xlayerAdvertised(): boolean {
  return xlayerRailEnabled() && Boolean(X402_XLAYER_PAY_TO) && okxCredentialsPresent();
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
 * Converts a licence's HBAR quote into base units of the X Layer asset.
 *
 * Floors at one base unit: a licence cheap enough to round to zero would
 * otherwise be advertised as free, and a zero-amount payment requirement is
 * not something a buyer agent can meaningfully sign.
 */
export function hbarToXLayerBaseUnits(hbar: number, asset: XLayerAsset = xlayerAsset()): string {
  const units = Math.round(hbar * HBAR_USD_RATE * 10 ** asset.decimals);
  return String(Math.max(1, units));
}
