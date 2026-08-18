import { accessSync, constants, existsSync } from "node:fs";
import { dirname } from "node:path";
import { envString } from "./env.js";

/**
 * Reports everything a deployment is missing, once, before anything imports it.
 *
 * The modules that need configuration read it as they load, so a missing
 * variable throws during import — killing the process with a stack trace, and
 * naming exactly one problem. A deployment short of five variables therefore
 * takes five redeploys to discover them, each ending in a crash that looks
 * like a code fault rather than a setup step.
 *
 * This runs first and reports the whole set, so the answer arrives in one go.
 * It deliberately does not read files or reach the network — it only checks
 * what is present, which is all that can be checked before the app exists.
 */

export interface RequiredSetting {
  name: string;
  why: string;
}

/** Without these the agent cannot serve a licence at all. */
const REQUIRED: RequiredSetting[] = [
  { name: "SELLER_ACCOUNT_ID", why: "the rights holder's Hedera account" },
  { name: "SELLER_PRIVATE_KEY", why: "signs the audit, reputation and certificate writes" },
  { name: "X402_PAY_TO_ACCOUNT", why: "where HBAR payments land" },
  { name: "DATA_ENCRYPTION_KEY", why: "decrypts master references for a paid response" },
  { name: "GROQ_API_KEY", why: "parses the rights holder's policy; without it no offer can be judged" },
  { name: "HCS_AUDIT_TOPIC_ID", why: "the audit trail every completed licence is written to" },
  { name: "HCS_IDENTITY_TOPIC_ID", why: "the registry gate 1 resolves buyers against" },
];

/**
 * Needed only for the optional X Layer rail, and only as a complete set — half
 * of it configured means the rail silently stays off, which is worth saying
 * out loud rather than leaving to be noticed in a 402 that quotes one chain.
 */
const XLAYER: RequiredSetting[] = [
  { name: "X402_XLAYER_PAY_TO", why: "where X Layer payments land" },
  { name: "OKX_API_KEY", why: "OKX facilitator credentials" },
  { name: "OKX_SECRET_KEY", why: "OKX facilitator credentials" },
  { name: "OKX_PASSPHRASE", why: "OKX facilitator credentials" },
];

export interface StartupReport {
  missing: RequiredSetting[];
  /** Present but unusable — a placeholder left in, or a malformed URL. */
  invalid: { name: string; value: string; why: string }[];
  warnings: string[];
}

/**
 * Settings that are parsed as URLs the moment the app loads.
 *
 * A bad value here does not reach any check: `new URL()` throws during import
 * and the process dies on a raw TypeError, which names the module rather than
 * the setting. Validating them first turns that into an answer.
 */
const URL_SETTINGS = [
  { name: "SELLER_AGENT_URL", why: "the address the agent card hands to other agents" },
  { name: "X402_BASE_URL", why: "the address buyers are sent back to in order to pay" },
];

/**
 * Catches a template pasted in without being filled: the angle brackets from
 * `https://<domain>` survive into the value and produce an invalid URL far
 * from where anyone would look for the cause.
 */
function looksLikePlaceholder(value: string): boolean {
  return /[<>]/.test(value) || value.includes("your-domain") || value.includes("example.com");
}

/**
 * Why an address cannot be reached from outside this machine, if it cannot.
 *
 * These are the addresses handed to *other* agents, so an unreachable one is
 * the failure that looks like success: the service runs, every response is
 * correct, and no stranger can act on any of it. `localhost` at least looks
 * wrong; a private-network hostname like `x.railway.internal` looks exactly
 * like a real domain, and would be written on-chain permanently by an ASP
 * registration before anyone noticed.
 */
export function unreachableReason(value: string): string | undefined {
  let host: string;
  let protocol: string;
  try {
    ({ hostname: host, protocol } = new URL(value));
  } catch {
    return undefined; // malformed is reported separately
  }

  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return "loopback — reachable only from inside this container";
  }
  if (host.endsWith(".railway.internal")) {
    return "Railway's PRIVATE network — reachable only from inside the project." +
      " Generate a public domain: Settings → Networking → Public Networking";
  }
  if (host.endsWith(".internal") || host.endsWith(".local")) {
    return "a private-network hostname — not resolvable from the public internet";
  }
  if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return "a private IP address — not routable from the public internet";
  }
  if (protocol !== "https:") {
    return `served over ${protocol.replace(":", "")}, and agents are handed https:// addresses`;
  }
  return undefined;
}

export function checkStartupConfig(): StartupReport {
  const missing = REQUIRED.filter((setting) => !envString(setting.name));
  const invalid: StartupReport["invalid"] = [];
  const warnings: string[] = [];

  for (const setting of URL_SETTINGS) {
    const value = envString(setting.name);
    if (!value) continue;
    if (looksLikePlaceholder(value)) {
      invalid.push({
        name: setting.name,
        value,
        why: "still holds the template placeholder — replace it with this deployment's real domain",
      });
      continue;
    }
    try {
      new URL(value);
    } catch {
      invalid.push({ name: setting.name, value, why: `not a valid URL — ${setting.why}` });
      continue;
    }

    const unreachable = unreachableReason(value);
    if (unreachable) {
      warnings.push(`${setting.name} is ${value} — ${unreachable}. ${setting.why}.`);
    }
  }

  // A DATA_DB_PATH whose directory is absent is the mounted-volume mistake, and
  // it surfaces as a stack-trace 500 on every request that touches the
  // catalogue — long after boot, and nowhere near the cause. Deliberately fatal
  // rather than self-healing: creating the directory would let the service run
  // on the container's own filesystem and lose the catalogue, the licences and
  // the encrypted master references on the next redeploy, silently.
  const dbPath = envString("DATA_DB_PATH");
  if (dbPath) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      invalid.push({
        name: "DATA_DB_PATH",
        value: dbPath,
        why: `the directory ${dir} does not exist — mount a volume there (Railway: service → Variables → Volumes), or point this at a path that does`,
      });
    } else {
      try {
        accessSync(dir, constants.W_OK);
      } catch {
        invalid.push({
          name: "DATA_DB_PATH",
          value: dbPath,
          why: `${dir} exists but is not writable by this process`,
        });
      }
    }
  }

  const railWanted = ["on", "true", "1"].includes(
    (envString("X402_XLAYER_RAIL") ?? "").toLowerCase(),
  );
  if (railWanted) {
    const incomplete = XLAYER.filter((setting) => !envString(setting.name));
    if (incomplete.length > 0) {
      warnings.push(
        `X402_XLAYER_RAIL is on but ${incomplete.map((s) => s.name).join(", ")} ` +
          `${incomplete.length === 1 ? "is" : "are"} unset — the X Layer rail will stay off.`,
      );
    }
  }

  // Not fatal on its own, but the licence certificate has nowhere to go without
  // it, and that failure only surfaces after a buyer has already paid.
  if (!envString("HTS_LICENCE_TOKEN_ID")) {
    warnings.push(
      "HTS_LICENCE_TOKEN_ID is unset — licences will settle but no certificate NFT will be minted.",
    );
  }

  if (!envString("SELLER_UAID") && !envString("BUYER_UAID")) {
    warnings.push(
      "SELLER_UAID / BUYER_UAID are unset — identity falls back to agent-uaids.json, " +
        "which scripts/register-agents-hcs.ts writes locally and is gitignored, so it " +
        "will not exist in a deployed container.",
    );
  }

  return { missing, invalid, warnings };
}

/**
 * Prints the report and stops the process when something required is absent.
 *
 * Exits rather than throws: this is a configuration answer for whoever is
 * reading deployment logs, and a stack trace would bury it.
 */
/**
 * Whether the process can see any configuration at all, and from where.
 *
 * Distinguishes the two failures that produce an identical "everything is
 * missing" list: a handful of variables genuinely not filled in, versus the
 * service receiving none of them because they were saved against a different
 * service or environment. If the platform's own variables are present and not
 * one of ours is, the values were set somewhere this container cannot see —
 * and no amount of correcting individual names will help.
 */
function describeEnvironment(): string[] {
  const lines: string[] = [];

  const platform = [
    ["RAILWAY_ENVIRONMENT_NAME", process.env["RAILWAY_ENVIRONMENT_NAME"]],
    ["RAILWAY_SERVICE_NAME", process.env["RAILWAY_SERVICE_NAME"]],
    ["RAILWAY_PROJECT_NAME", process.env["RAILWAY_PROJECT_NAME"]],
  ].filter(([, value]) => value) as [string, string][];

  const ours = [...REQUIRED, ...XLAYER, { name: "HTS_LICENCE_TOKEN_ID" }, { name: "X402_BASE_URL" }]
    .filter((setting) => envString(setting.name)).length;

  if (platform.length > 0) {
    lines.push(
      `Running on Railway — ${platform.map(([k, v]) => `${k.replace("RAILWAY_", "").toLowerCase()}=${v}`).join(", ")}.`,
    );
    if (ours === 0) {
      lines.push(
        "The platform's own variables are visible but NOT ONE of this project's is —" +
          " so they are not missing so much as elsewhere. Check they were saved against" +
          " this service and this environment, and that any project-level shared variable" +
          " is actually referenced by the service.",
      );
    }
  }

  return lines;
}

export function assertStartupConfig(): void {
  const { missing, invalid, warnings } = checkStartupConfig();

  for (const warning of warnings) console.warn(`[config] ${warning}`);

  if (missing.length === 0 && invalid.length === 0) return;

  for (const line of describeEnvironment()) console.error(`[config] ${line}`);

  if (invalid.length > 0) {
    console.error(
      `\n[config] ${invalid.length} setting${invalid.length === 1 ? " is" : "s are"} set but unusable:\n`,
    );
    for (const setting of invalid) {
      console.error(`  ${setting.name}`);
      console.error(`    value: ${setting.value}`);
      console.error(`    ${setting.why}`);
    }
  }

  if (missing.length > 0) {
    console.error(
      `\n[config] ${missing.length} required setting${missing.length === 1 ? " is" : "s are"} missing:\n`,
    );
    for (const setting of missing) {
      console.error(`  ${setting.name.padEnd(24)} ${setting.why}`);
    }
  }
  console.error(
    `\nSet them in the deployment's environment (see .env.example, and` +
      ` docs/deploy-railway.md for a hosted service). Nothing was started.\n`,
  );
  process.exit(1);
}
