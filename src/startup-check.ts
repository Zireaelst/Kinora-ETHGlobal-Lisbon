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
  warnings: string[];
}

export function checkStartupConfig(): StartupReport {
  const missing = REQUIRED.filter((setting) => !envString(setting.name));
  const warnings: string[] = [];

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

  return { missing, warnings };
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
  const { missing, warnings } = checkStartupConfig();

  for (const warning of warnings) console.warn(`[config] ${warning}`);

  if (missing.length === 0) return;

  for (const line of describeEnvironment()) console.error(`[config] ${line}`);

  console.error(
    `\n[config] ${missing.length} required setting${missing.length === 1 ? " is" : "s are"} missing:\n`,
  );
  for (const setting of missing) {
    console.error(`  ${setting.name.padEnd(24)} ${setting.why}`);
  }
  console.error(
    `\nSet them in the deployment's environment (see .env.example, and` +
      ` docs/deploy-railway.md for a hosted service). Nothing was started.\n`,
  );
  process.exit(1);
}
