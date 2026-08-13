import "dotenv/config";
import { createHmac } from "node:crypto";
import type { FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";

/**
 * OKX's x402 facilitator, as a `FacilitatorClient` the resource server can use.
 *
 * The X Layer rail needs a facilitator that supports `eip155:1952`, and OKX's
 * is the only one that does — the public x402.org facilitator covers Base
 * Sepolia, Hedera testnet, Solana and others, but not X Layer. So the seller
 * runs two facilitators side by side: blocky402 settles Hedera, this one
 * settles X Layer, and `x402ResourceServer` takes both.
 *
 * **Why this is hand-written rather than `HTTPFacilitatorClient` with headers.**
 * `@x402/core` does expose a `createAuthHeaders` hook, but OKX signs
 * `timestamp + method + path + body` — and that hook is called with no
 * arguments, so it cannot see the body it would have to sign. The interface it
 * would have implemented is only three methods, so implementing it directly is
 * both smaller and honest about what it does.
 *
 * **Why not `@okxweb3/x402-core`.** OKX publishes its own port of this SDK
 * (`OKXFacilitatorClient` there does exactly this), but it is a parallel
 * package family at 0.1.0 with its own `x402ResourceServer`, and adopting it
 * would mean running two resource servers or migrating the working Hedera
 * path onto an early-version fork. Talking to the same HTTP API directly costs
 * ~80 lines and no new dependency.
 *
 * Wire format taken from OKX's own client
 * (`okx/payments` → `typescript/bu-payments/app-x402-core/src/facilitator/OKXFacilitatorClient.ts`).
 */

/** Every OKX REST response is wrapped in this envelope. */
interface OkxEnvelope<T> {
  code?: string | number;
  msg?: string;
  data?: T;
}

export interface OkxFacilitatorConfig {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  /** Defaults to OKX's production host, which also serves testnet networks. */
  baseUrl?: string;
  /**
   * Wait for on-chain confirmation before returning from `settle`.
   *
   * On by default here: this server hands over a decrypted master reference as
   * soon as settlement reports success, so "probably paid" is not good enough
   * — the licence must not be released against a payment still in flight.
   */
  syncSettle?: boolean;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://web3.okx.com";
const DEFAULT_TIMEOUT_MS = 60_000;

const SUPPORTED_PATH = "/api/v6/pay/x402/supported";
const VERIFY_PATH = "/api/v6/pay/x402/verify";
const SETTLE_PATH = "/api/v6/pay/x402/settle";

export class OkxFacilitatorClient implements FacilitatorClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly syncSettle: boolean;

  constructor(private readonly config: OkxFacilitatorConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.syncSettle = config.syncSettle ?? true;
  }

  /**
   * OKX REST auth: HMAC-SHA256 over `timestamp + method + path + body`, base64.
   *
   * The body has to be the exact string that gets sent — re-serialising it
   * anywhere between here and `fetch` would change the bytes and invalidate
   * the signature, which is why callers pass the already-stringified body.
   */
  private headers(method: string, path: string, body?: string): Record<string, string> {
    const timestamp = new Date().toISOString();
    const sign = createHmac("sha256", this.config.secretKey)
      .update(timestamp + method + path + (body ?? ""))
      .digest("base64");

    return {
      "OK-ACCESS-KEY": this.config.apiKey,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": this.config.passphrase,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(method: "GET" | "POST", path: string, payload?: unknown): Promise<T> {
    const body = payload === undefined ? undefined : JSON.stringify(payload);

    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method,
        headers: this.headers(method, path, body),
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(`OKX facilitator ${path} unreachable: ${String(error).slice(0, 160)}`);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OKX facilitator ${path} failed: HTTP ${response.status} ${text.slice(0, 240)}`);
    }

    let parsed: OkxEnvelope<T>;
    try {
      parsed = JSON.parse(text) as OkxEnvelope<T>;
    } catch {
      throw new Error(`OKX facilitator ${path} returned non-JSON: ${text.slice(0, 240)}`);
    }

    // A non-zero `code` is an application-level failure even on HTTP 200 —
    // reporting it as success would let an unpaid request through.
    if (parsed.code !== undefined && String(parsed.code) !== "0") {
      throw new Error(
        `OKX facilitator ${path} rejected the request: code ${parsed.code} ${parsed.msg ?? ""}`.trim(),
      );
    }

    return (parsed.data ?? (parsed as unknown)) as T;
  }

  async getSupported(): Promise<SupportedResponse> {
    return this.request<SupportedResponse>("GET", SUPPORTED_PATH);
  }

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return this.request<VerifyResponse>("POST", VERIFY_PATH, {
      x402Version: 2,
      paymentPayload,
      paymentRequirements,
    });
  }

  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return this.request<SettleResponse>("POST", SETTLE_PATH, {
      x402Version: 2,
      paymentPayload,
      paymentRequirements,
      syncSettle: this.syncSettle,
    });
  }
}

/**
 * Builds the client from the environment, or returns undefined when OKX
 * credentials are not configured.
 *
 * Undefined rather than throwing: a missing OKX key means "run on Hedera
 * only", which is a supported configuration, not an error.
 */
export function createOkxFacilitatorFromEnv(): OkxFacilitatorClient | undefined {
  // Trimmed because a stray space or newline around a credential produces a
  // 401 that reads like a wrong key rather than a formatting slip, and the
  // difference costs an hour to find. Note the related `.env` trap this cannot
  // fix: dotenv treats `#` in an unquoted value as a comment, so a passphrase
  // containing one must be quoted or it arrives silently truncated.
  const apiKey = process.env.OKX_API_KEY?.trim();
  const secretKey = process.env.OKX_SECRET_KEY?.trim();
  const passphrase = process.env.OKX_PASSPHRASE?.trim();

  if (!apiKey || !secretKey || !passphrase) return undefined;

  return new OkxFacilitatorClient({
    apiKey,
    secretKey,
    passphrase,
    ...(process.env.OKX_BASE_URL ? { baseUrl: process.env.OKX_BASE_URL } : {}),
  });
}
