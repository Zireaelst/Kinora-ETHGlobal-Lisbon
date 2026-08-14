import "dotenv/config";
import { AccountId, PrivateKey } from "@hiero-ledger/sdk";

/**
 * Validates the shape of the Hedera credentials without printing them.
 *
 *   npm run check:env
 *
 * The SDK's own failure is accurate but hostile: putting a key where an
 * account id belongs produces "failed to parse entity id: 302e0201..." — which
 * both buries the diagnosis and prints the private key into the terminal,
 * where it lands in scrollback, CI logs and screen shares. This reports which
 * field is wrong and why, and never echoes a value.
 */

type Check = { name: string; ok: boolean; note: string };

/** DER prefixes, so a key pasted into an id field is named rather than shown. */
const DER_ED25519 = "302e020100300506032b6570";
const DER_ECDSA = "3030020100300706052b8104000a";

function checkAccountId(name: string): Check {
  const raw = process.env[name]?.trim();
  if (!raw) return { name, ok: false, note: "missing" };

  const lower = raw.toLowerCase();
  if (lower.startsWith(DER_ED25519) || lower.startsWith(DER_ECDSA) || /^(0x)?[0-9a-f]{64,}$/.test(lower)) {
    return {
      name,
      ok: false,
      note: "contains a PRIVATE KEY, not an account id — the id looks like 0.0.12345",
    };
  }
  // `AccountId.fromString` accepts an EVM address as an alias, so this parses
  // and then behaves like a different account than the rest of the project
  // means. Caught explicitly because "valid" is exactly how it would otherwise
  // read.
  if (/^0x[0-9a-f]{40}$/.test(lower)) {
    return {
      name,
      ok: false,
      note: "an EVM address, not a Hedera account id — this project uses the 0.0.12345 form",
    };
  }

  try {
    AccountId.fromString(raw);
    return { name, ok: true, note: `valid account id (${raw})` };
  } catch {
    return { name, ok: false, note: "not a valid account id — expected the form 0.0.12345" };
  }
}

function checkPrivateKey(name: string): Check {
  const raw = process.env[name]?.trim();
  if (!raw) return { name, ok: false, note: "missing" };

  if (/^\d+\.\d+\.\d+$/.test(raw)) {
    return { name, ok: false, note: "contains an ACCOUNT ID, not a private key — the two are swapped" };
  }

  // The project signs with ECDSA throughout, so an Ed25519 key parses fine on
  // its own yet fails at the first transaction. Better to say so here.
  const lower = raw.toLowerCase();
  const looksEd25519 = lower.startsWith(DER_ED25519);

  try {
    PrivateKey.fromStringECDSA(raw);
    return {
      name,
      ok: !looksEd25519,
      note: looksEd25519
        ? "parses, but this is an Ed25519 key and the project uses ECDSA — create an ECDSA account"
        : "valid ECDSA private key",
    };
  } catch {
    if (looksEd25519) {
      return { name, ok: false, note: "Ed25519 key — the project needs an ECDSA one" };
    }
    return { name, ok: false, note: "not a usable ECDSA private key" };
  }
}

const checks: Check[] = [
  checkAccountId("SELLER_ACCOUNT_ID"),
  checkPrivateKey("SELLER_PRIVATE_KEY"),
  checkAccountId("BUYER_ACCOUNT_ID"),
  checkPrivateKey("BUYER_PRIVATE_KEY"),
  checkAccountId("X402_PAY_TO_ACCOUNT"),
];

console.log("Hedera credentials");
console.log("------------------");
for (const check of checks) {
  console.log(`  ${check.ok ? "OK  " : "FAIL"}  ${check.name.padEnd(22)} ${check.note}`);
}

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  console.error(
    `\n${failed.length} problem(s). Both accounts must be ECDSA testnet accounts from` +
      ` https://portal.hedera.com/dashboard — the id goes in *_ACCOUNT_ID, the key in *_PRIVATE_KEY.`,
  );
  process.exitCode = 1;
}
