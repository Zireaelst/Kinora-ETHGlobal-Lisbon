import "dotenv/config";
import { createOkxFacilitatorFromEnv } from "../src/x402/okx-facilitator.js";
import { XLAYER_TESTNET, xlayerAsset } from "../src/x402/config.js";

/**
 * Checks the OKX facilitator credentials on their own.
 *
 *   npm run check:okx
 *
 * Worth having as a separate step because a bad credential surfaces deep
 * inside route validation otherwise — as "facilitator does not support
 * eip155:1952", which reads like a missing network rather than a rejected key.
 * This asks the facilitator directly and reports what it actually said.
 *
 * Prints no secrets: only whether each variable is set, and how it fails.
 */

function describeAuthFailure(message: string): string[] {
  // OKX distinguishes these, and the distinction is the whole diagnosis:
  // 50113 would mean our signing is wrong, 50111 that the key is unknown.
  // 50105 means both were accepted and only the passphrase did not match.
  if (message.includes("50105")) {
    return [
      "The API key and the request signature were both ACCEPTED — only the passphrase is wrong.",
      "",
      "The passphrase is the one you typed when creating the key, not your OKX",
      "account password and not a 2FA code. It cannot be read back afterwards:",
      "if it is lost, create a new key and set a fresh one.",
      "",
      "If it contains a '#', quote it in .env — dotenv treats an unquoted '#' as",
      "the start of a comment and would silently cut the value short:",
      '    OKX_PASSPHRASE="my#passphrase"',
    ];
  }
  if (message.includes("50113")) {
    return [
      "Signature rejected. The key and passphrase were read, but the HMAC did not",
      "match — most likely OKX_SECRET_KEY is wrong or truncated.",
    ];
  }
  if (message.includes("50111") || message.includes("50103")) {
    return [
      "The API key itself was not recognised. Check OKX_API_KEY, and check the key",
      "was created in the Onchain OS developer portal:",
      "    https://web3.okx.com/onchainos/dev-portal",
    ];
  }
  if (message.includes("50102")) {
    return ["Timestamp rejected — this machine's clock is too far out of sync."];
  }
  return ["Not an authentication error. The full response is above."];
}

async function main(): Promise<void> {
  const present = (name: string) => (process.env[name]?.trim() ? "set" : "MISSING");
  console.log("OKX facilitator credentials");
  console.log("---------------------------");
  for (const name of ["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE"]) {
    console.log(`  ${name.padEnd(18)} ${present(name)}`);
  }
  console.log(`  OKX_BASE_URL       ${process.env.OKX_BASE_URL?.trim() || "(default web3.okx.com)"}`);

  const client = createOkxFacilitatorFromEnv();
  if (!client) {
    console.error("\nFAIL — set all three in .env before running this.");
    process.exitCode = 1;
    return;
  }

  console.log("\nGET /api/v6/pay/x402/supported ...");
  let supported;
  try {
    supported = await client.getSupported();
  } catch (error) {
    const message = String(error);
    console.error(`\nFAIL — ${message}\n`);
    for (const line of describeAuthFailure(message)) console.error(line);
    process.exitCode = 1;
    return;
  }

  const kinds = supported?.kinds ?? [];
  console.log(`\nOK — the facilitator answered with ${kinds.length} supported kind(s):\n`);
  for (const kind of kinds) {
    console.log(`  scheme=${kind.scheme}  network=${kind.network}`);
  }

  const asset = xlayerAsset();
  const covered = kinds.some(
    (kind) => kind.scheme === "exact" && kind.network === XLAYER_TESTNET,
  );

  console.log(`\nX Layer rail (exact / ${XLAYER_TESTNET}): ${covered ? "SUPPORTED" : "NOT SUPPORTED"}`);
  console.log(`  asset  ${asset.eip712Name} ${asset.address}`);
  console.log(`  domain name="${asset.eip712Name}" version="${asset.eip712Version}"`);

  if (!covered) {
    console.error(
      "\nThe credentials work but this facilitator will not settle X Layer testnet.\n" +
        "The rail stays off; Hedera is unaffected.",
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
