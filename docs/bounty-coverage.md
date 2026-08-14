# Requirement coverage — both bounties

What is genuinely wired up, what stands in for something else, and what is simply not done — with the file that implements it and the command that proves it.

> **On the source of these rows.** We do not have an official ETHGlobal scoring checklist. The requirements below are taken from the two bounty briefs as we read them, plus the component list in `CLAUDE.md`. If the real criteria differ, re-check these rows against them rather than trusting this table.

**Legend** — ✅ done and provable · ⚠️ real but with a stated caveat · ❌ not done

---

## Bounty 1 — No Solidity

| Requirement | Status | Where | Proof |
|---|---|---|---|
| No Solidity anywhere | ✅ | — | `grep -rniE "solidity\|\bethers\b\|Contract(Execute\|Call\|Create)Transaction\|ContractCallQuery\|ContractFunctionParameters\|\.sol\b" src scripts --include=*.ts --include=*.html` → **exits 1**, 41 files scanned |
| No EVM contract calls | ✅ | — | Same grep. The project *started* on ERC-8004 Solidity registries; that layer was deleted — `git log --oneline --grep "remove the ERC-8004"`. **A second payment rail on X Layer was added afterwards and does not change this row:** the buyer signs an EIP-712 authorisation and OKX's facilitator submits the ERC-20 transfer. Kinora writes no contract, deploys none, and issues no contract call on either chain |
| `ethers` not a dependency of ours | ✅ | `package.json` | `node -e "console.log(Object.keys(require('./package.json').dependencies))"` — absent. It remains transitively inside the Hedera SDK's own tree; that is theirs, not ours |
| Hedera SDK | ✅ | `src/hedera/clients.ts` | `@hiero-ledger/sdk` — the same SDK as `@hashgraph/sdk` after Hedera donated it to the Linux Foundation's Hiero project |
| **Two or more native Hedera services** | ✅ **three** | below | HCS + HTS + Mirror Node |
| — HCS (Consensus) | ✅ | `src/hedera/audit.ts`, `src/identity/registry.ts`, `attestation.ts`, `reputation.ts` | `npm run test:identity` (33 checks); the panel's audit pane |
| — HTS (Token Service) | ✅ | `src/hedera/certificate.ts`, `scripts/create-licence-token.ts` | Collection created live; certificate NFTs confirmed in the buyer's account via mirror node |
| — Mirror Node | ✅ | `src/hedera/mirror.ts`, `src/web/api.ts` | Every identity resolution and every audit-panel row is a mirror-node read |
| Thoughtful security | ⚠️ | `src/data/db.ts` | Field-level AES-256-GCM on the master reference, decrypted **in memory only** on a paid response (`src/data/catalog.ts` → `buildLicenceGrant`). Tamper-evident: `npm run test:catalog` alters a ciphertext and the auth tag rejects it. Caveat: scrypt uses a fixed salt and the key comes from `.env`, not a KMS — `encryption_key_ref` is the seam where a real KMS would attach |
| Public repo | ✅ | — | This repository |
| Demo video | ❌ | — | Not yet filmed — see `docs/demo-script.md` |

---

## Bounty 2 — AI & Agentic Payments on Hedera

| Requirement | Status | Where | Proof |
|---|---|---|---|
| Two autonomous agents, not one program | ✅ | `src/a2a/seller-executor.ts`, `buyer-client.ts` | Separate Hedera accounts, separate identities, discovery via AgentCard — the buyer knows only a base URL |
| A2A protocol | ✅ | `src/a2a/` | `@a2a-js/sdk`; card served at `/.well-known/agent-card.json` on `:4000` |
| Real Task lifecycle | ✅ | `publishReply` in `seller-executor.ts` | Accept → `completed`, policy refusal → `input-required` (the task stays open for a counter), identity failure → `failed` |
| Multi-round negotiation | ✅ | `priorRound` + `counterOffer` | A counter-offer lands in the **same task**; the reply opens *"Round 2 of our negotiation — last round you offered…"* — `npm run test:rounds` |
| Autonomous buyer strategy | ⚠️ rule-based | `negotiateWithStrategy` in `buyer-client.ts` | Three rules, **no model call in the loop**: counter only on a price refusal, counter at the seller's disclosed floor, budget is a hard wall. Sold as light strategy, not AI bargaining — `npm run test:rounds` walks away from a forbidden use at 10× the budget |
| x402 payments | ✅ | `src/x402/server.ts`, `pay.ts` | 402 → sign → 200 against the blocky402 testnet facilitator |
| Real HBAR settlement | ✅ | asset `0.0.0` | Every accepted run produces a HashScan transaction |
| **Second settlement rail (X Layer)** | ✅ **settled live** | `src/x402/config.ts`, `okx-facilitator.ts` | The same licence is quoted on `hedera:testnet` **and** `eip155:1952`, so a buyer holding no HBAR is not shut out. Identity, audit trail and certificate stay on Hedera — only the money moves elsewhere. Proven end to end: OKX's Agentic Wallet paid licence #3 with `onchainos payment pay`, tx [`0xe3a1407e…4ca6d13a`](https://www.oklink.com/xlayer-test/tx/0xe3a1407e897b651d3fd874d7e5efa615b31e63d9fa17f721b9da0ee44ca6d13a) — 0.1148 USDC_TEST moved buyer→seller and the decrypted master reference came back in the 200. Off by default (`X402_XLAYER_RAIL`) |
| **No human approves any payment** | ✅ | `negotiateAndPurchase` | The buyer reads price and endpoint off the acceptance metadata and signs unattended — `npm run test:e2e` |
| Per-licence pricing | ✅ | `licenceQuote` in `x402/server.ts` | The 402 quotes `quotePrice(track, shares)` from the licence row, not a flat route price |
| Payment bound to the negotiation | ✅ | `requireAcceptedLicence` | An unnegotiated or altered request is refused **403 before any price is quoted**; a settled acceptance cannot be replayed |
| Agent identity | ⚠️ partial HCS-14 | `src/identity/uaid.ts`, `registry.ts` | UAID format, sanitisation rule and `nativeId` binding are implemented; the id is **self-derived** rather than carried from an existing W3C DID — see README's limits |
| Reputation | ✅ | `src/identity/reputation.ts` | Feedback written to the identity topic after settlement, citing the payment transaction |
| HCS audit trail | ✅ | `src/hedera/audit.ts` | Panel's audit pane reads it back off the mirror node |
| HTS token creation | ✅ | `scripts/create-licence-token.ts` | "Music Licence Certificate" (MLIC), seller treasury + sole supply key, **no admin key — immutable** |
| **HTS royalty fee schedule** | ✅ **demonstrated** | `scripts/create-licence-token.ts`, `scripts/verify-royalty.ts` | 5% to the rights holder, **no fallback fee**, baked in at creation with no fee schedule key so the terms cannot change. Proven live, not just configured: `npm run verify:royalty` → **7/7**, tx [`0.0.10062841-1786711560-010261346`](https://hashscan.io/testnet/transaction/0.0.10062841-1786711560-010261346) — 0.5 ℏ of a 10 ℏ resale routed to the rights holder, who was not a party to that trade. **The live negotiation path mints into this collection**, so every certificate the demo issues carries the royalty (verified: a panel purchase produced serial 12 in `0.0.10062876`). The **resale** that triggers the fee is a separate verification script, not a demo beat |
| Hedera Agent Kit, autonomous mode | ✅ | `src/hedera/agentkit.ts` | `AgentMode.AUTONOMOUS` + HCS audit-trail hook — demonstrated by `npx tsx scripts/test-agent-kit.ts`; the negotiation path uses the SDK directly |
| Natural-language policy | ✅ | `src/policy/parser.ts` | Groq `llama-3.3-70b-versatile`, `temperature: 0`, structured output, plus a whitelist filter so a hallucinated licence type can never widen what is sold |
| Demo video | ❌ | — | Not yet filmed |

---

## Deliberately not done

Cut for time under a 12-hour budget. Named here rather than left for a judge to discover.

| Enhancement | Status | Why, and what it would take |
|---|---|---|
| **UCP (Universal Commerce Protocol) discovery** | ❌ not attempted | Discovery today is the A2A AgentCard only. UCP would be a second discovery surface on top of a working one — additive points, non-trivial integration |
| **Scheduled Transactions** | ❌ not attempted | Every payment here settles immediately, which is the whole point of the x402 flow. Scheduled transactions would suit a *deferred* or multi-signature licence settlement — a different product beat, not this one |
| ~~**HTS custom fee schedules / royalty fees**~~ | ✅ **done after all** | Moved into the delivered table above. 5% royalty, no fallback fee, demonstrated by a real secondary sale. The one caveat kept honest: the resale is a **separate verification script**, not something the primary demo flow performs |
| **Third-party validation** | ❌ by necessity, then by choice | The ERC-8004 ValidationRegistry **has no deployment on any chain** — the spec section is still under revision, so there was nothing to call. Our attestation is therefore **self-issued**: the seller attests the buyer against its own allow-list and writes the result to HCS using the registry's own field names. A real, public, tamper-evident record — but not independent verification |
| **Persistent negotiations** | ❌ | `InMemoryTaskStore`: sessions do not survive a restart. Fine for a demo; a counter-offer to a restarted seller gets "Task not found" |

---

## Worth knowing, by design

| Behaviour | Effect |
|---|---|
| A buyer must be associated with the certificate collection before it can receive one | `scripts/create-licence-token.ts` associates the demo buyer at creation. Any **additional** buyer would need its own association first; without it the sale still completes and the licence is granted, but the mint has nowhere to land and the panel's Licences-sold row shows `—` in the Certificate column |
| The policy floor and the track quote are two separate knobs | The floor comes from the rights holder's sentence (`minPricePerShareHbar × shares`); the charge is the track's own rate (`quotePrice`). The seeded catalogue runs **0.00082–0.00198 ℏ per share** and the default floor is **0.0008**, deliberately under the cheapest track, so an offer at any track's own asking price clears. On a 5% licence on the cheapest track: 0.4 ℏ floor, 0.41 ℏ quote. Reseed with different prices and the floor must move with them |
