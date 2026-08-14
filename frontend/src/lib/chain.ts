/**
 * The on-chain artefacts this project actually produced.
 *
 * Every id and transaction below was confirmed before being put on the page —
 * accounts and topics resolve, both settlements report SUCCESS, and the
 * certificate collection reports a 5/100 royalty to the rights holder. Nothing
 * here is illustrative.
 *
 * These are from the environment provisioned on 14 Aug 2026. An earlier set
 * (seller 0.0.9696085, buyer 0.0.9697053, audit 0.0.9738154, collection
 * 0.0.9756726) is still on testnet and still resolves, but belongs to accounts
 * this deployment no longer holds keys for — so it is gone from here rather
 * than left to look current.
 *
 * If the demo environment is rebuilt again, these are the values to update —
 * deliberately in one file so the page can never drift into showing an id that
 * no longer resolves.
 */

const HASHSCAN = 'https://hashscan.io/testnet';
/** OKX's own explorer; X Layer testnet lives under `xlayer-test`. */
const OKLINK_XLAYER_TEST = 'https://www.oklink.com/xlayer-test';

export const accountUrl = (id: string) => `${HASHSCAN}/account/${id}`;
export const topicUrl = (id: string) => `${HASHSCAN}/topic/${id}`;
export const tokenUrl = (id: string) => `${HASHSCAN}/token/${id}`;
/** HashScan wants `0.0.x-seconds-nanos`, not the `0.0.x@seconds.nanos` form. */
export const txUrl = (id: string) => `${HASHSCAN}/transaction/${id}`;
export const xlayerTxUrl = (hash: string) => `${OKLINK_XLAYER_TEST}/tx/${hash}`;

export const SELLER_ACCOUNT = '0.0.9695366';
export const BUYER_ACCOUNT = '0.0.10062841';
export const AUDIT_TOPIC = '0.0.10062827';
export const IDENTITY_TOPIC = '0.0.10062828';
export const CERTIFICATE_TOKEN = '0.0.10062876';

/** A licence the end-to-end test negotiated over two rounds and settled. */
export const SETTLED_PAYMENT_TX = '0.0.7162784-1786711624-666422291';
/** The resale that made the 5% royalty actually fire: 0.5 ℏ of a 10 ℏ trade. */
export const ROYALTY_PROOF_TX = '0.0.10062841-1786711560-010261346';
/** The same product, bought on the other rail — settled by OKX's Agentic Wallet. */
export const XLAYER_PAYMENT_TX =
  '0x07095b35b89fff65d15d24ac0958b4fe5c9031e9bb3f4a97440d71f3d96af285';

/** Numerator/denominator of the royalty baked into the collection at creation. */
export const ROYALTY_PERCENT = 5;

export interface ChainArtefact {
  label: string;
  value: string;
  href: string;
  note: string;
}

export const CHAIN_ARTEFACTS: ChainArtefact[] = [
  {
    label: 'Rights holder account',
    value: SELLER_ACCOUNT,
    href: accountUrl(SELLER_ACCOUNT),
    note: 'The seller agent. Treasury of the certificate collection and the royalty collector.',
  },
  {
    label: 'Buyer account',
    value: BUYER_ACCOUNT,
    href: accountUrl(BUYER_ACCOUNT),
    note: 'The buyer agent — a separate Hedera account, not a second key on the first.',
  },
  {
    label: 'Settled licence payment',
    value: SETTLED_PAYMENT_TX,
    href: txUrl(SETTLED_PAYMENT_TX),
    note: 'One x402 settlement: 402 → signed → 200, with no human approving it.',
  },
  {
    label: 'Same licence, paid on X Layer',
    value: `${XLAYER_PAYMENT_TX.slice(0, 18)}…`,
    href: xlayerTxUrl(XLAYER_PAYMENT_TX),
    note: 'OKX’s Agentic Wallet buying a licence in a stablecoin — 0.1148 USDC_TEST, no HBAR involved.',
  },
  {
    label: 'HCS audit topic',
    value: AUDIT_TOPIC,
    href: topicUrl(AUDIT_TOPIC),
    note: 'Every completed licence writes an entry here, whichever rail paid for it. Read it without trusting us.',
  },
  {
    label: 'HCS identity topic',
    value: IDENTITY_TOPIC,
    href: topicUrl(IDENTITY_TOPIC),
    note: 'HCS-14 agent profiles plus the compliance attestation written per negotiation.',
  },
  {
    label: 'HTS certificate collection',
    value: CERTIFICATE_TOKEN,
    href: tokenUrl(CERTIFICATE_TOKEN),
    note: `Licence certificates, minted to the buyer that negotiated. Carries the ${ROYALTY_PERCENT}% royalty, no fallback fee.`,
  },
  {
    label: 'Royalty proof',
    value: ROYALTY_PROOF_TX,
    href: txUrl(ROYALTY_PROOF_TX),
    note: `A 10 ℏ resale routed ${ROYALTY_PERCENT}% — 0.5 ℏ — to the rights holder, who was not a party to that trade.`,
  },
];
