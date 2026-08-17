# Deploying to Railway

The seller agent has to be reachable from outside this machine before it is any
use to another agent — and before it can be listed on OKX.AI, where the endpoint
is written **on-chain and permanently**. A tunnel URL registered there is a
permanent mistake, so deploy first, register second.

`npm start` runs all three services on one port (`src/prod-server.ts`) because a
Railway service exposes exactly one. They share it without collision:

```
/.well-known/agent-card.json, /a2a/jsonrpc   seller agent
/catalog, /licence/grant                     x402 licence endpoint
/, /api/*                                    demo panel
/healthz                                     liveness
```

One process is also a requirement rather than a convenience: the policy saved in
the panel lives in the seller agent's memory, so splitting them would leave the
panel talking to itself.

---

## 1. Create the service

Point Railway at this repo. `railway.json` sets the start command and the health
check; `engines.node` and `.nvmrc` pin the Node version. Nothing else needs
configuring at build time.

> **Why the version is pinned.** Left to choose, Nixpacks picked Node 18, which
> `better-sqlite3` publishes no prebuilt binary for — so the build fell through
> to compiling from source, and failed on a missing Python. On Node 20–24 the
> prebuilt binary is found and nothing is compiled.

## 2. Add a volume — before the first real run

The catalogue, the licences and the encrypted master references are a SQLite
file. Without a volume it lives in the container filesystem and **every redeploy
wipes it**, taking the licence history with it.

- Mount path: `/data`
- Then set `DATA_DB_PATH=/data/catalogue.db`

`npm start` warns on boot if `DATA_DB_PATH` is unset.

## 3. Set the variables

Railway's variable editor, not a committed file. Everything in
[`.env.example`](../.env.example) applies; these are the ones that change or
matter more once hosted.

### Must be the public origin

Railway gives the service a domain (`something.up.railway.app`, or your own).
Both of these are handed to *other* agents, so pointing them at localhost is the
failure that looks like success — every response is correct and nobody else can
act on any of it. `npm start` warns if either still says localhost.

| Variable | Value |
|---|---|
| `X402_BASE_URL` | `https://<your-domain>` |
| `SELLER_AGENT_URL` | `https://<your-domain>/a2a/jsonrpc` |

### Identity, without the generated file

`agent-uaids.json` is written by `scripts/register-agents-hcs.ts` and is
gitignored, so it will not exist in the container. Register the agents locally,
then carry the two UAIDs over as variables:

| Variable | Where it comes from |
|---|---|
| `SELLER_UAID` | printed by `register-agents-hcs.ts` |
| `BUYER_UAID` | same |
| `APPROVED_UAIDS` | the buyer UAIDs this seller will attest — defaults to `BUYER_UAID` |

### Everything else

Hedera credentials and topic ids (`SELLER_ACCOUNT_ID`, `SELLER_PRIVATE_KEY`,
`HCS_AUDIT_TOPIC_ID`, `HCS_IDENTITY_TOPIC_ID`, `HTS_LICENCE_TOKEN_ID`),
`GROQ_API_KEY`, `DATA_ENCRYPTION_KEY`, `X402_FACILITATOR_URL`,
`X402_PAY_TO_ACCOUNT`, and — if the X Layer rail is wanted —
`X402_XLAYER_RAIL=on`, `X402_XLAYER_PAY_TO`, `OKX_API_KEY`, `OKX_SECRET_KEY`,
`OKX_PASSPHRASE`.

`DATA_ENCRYPTION_KEY` decrypts the master references. Change it and the existing
catalogue becomes unreadable — carry the same value across, do not generate a
fresh one.

## 4. Seed the catalogue

A fresh volume holds an empty database, and an agent with nothing to sell
answers every offer with `unknown_track`. Seed it once, from a local checkout
pointed at the same environment:

```bash
DATA_DB_PATH=./catalogue.db npx tsx scripts/seed-catalog.ts
```

Then copy that file into the volume — or, more simply, run the seed once against
the deployment through Railway's shell, with `DATA_DB_PATH=/data/catalogue.db`.
The script refuses to overwrite an existing catalogue unless `FORCE=1`.

## 5. Check it from outside

From somewhere that is not the deployment:

```bash
curl https://<your-domain>/healthz
curl https://<your-domain>/catalog
curl https://<your-domain>/.well-known/agent-card.json | jq '.supportedInterfaces[].url'
```

The last one must print your public URL. If it prints `localhost`, `SELLER_AGENT_URL`
did not take effect — and any agent that reads the card will try to call itself.

Then confirm the paid endpoint still refuses an unnegotiated request:

```bash
curl -i "https://<your-domain>/licence/grant?trackId=1&shares=500"
# 403 negotiation_required — the binding gate, before any price is quoted
```

## 6. Only then, list it

With a permanent HTTPS endpoint, the ASP registration in
[`ANALYSIS.md`](../ANALYSIS.md) §4.2 becomes available. Register the service, not
the panel: the endpoint is `https://<your-domain>/licence/grant`.

---

## Notes

**Cost.** One always-on service plus a small volume. The process is idle between
negotiations but cannot scale to zero — a buyer agent arriving at a sleeping
service gets a timeout, not a 402.

**Secrets.** The OKX credentials are seller-side API keys and are **not** covered
by the Agentic Wallet's TEE (see [`okx-findings.md`](okx-findings.md) §1). They
sit in Railway's variable store like any other secret.

**Testnet.** Everything here is Hedera testnet and X Layer testnet. Nothing in
this deployment moves real money; going to mainnet is a separate decision with
separate keys.
