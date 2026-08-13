/**
 * Reading optional environment variables without being fooled by blanks.
 *
 * `process.env.X ?? fallback` looks right and is wrong for anything that comes
 * from a `.env` file: dotenv sets a bare `X=` to the empty string, and `??`
 * only guards `undefined`. So a variable listed-but-not-filled — exactly what
 * `.env.example` invites you to leave alone — silently overrides its own
 * default with `""`.
 *
 * That is not a theoretical tidy-up. `HBAR_USD_RATE=` made `Number("")` zero,
 * which priced every X Layer licence at one base unit — a licence for
 * 0.000001 USD₮0. `WEB_PORT=` would bind port 0, and `DATA_DB_PATH=` would
 * open a database named "".
 *
 * Whitespace counts as blank too: a line left as `X= ` is not a value.
 */

/** The variable's value, or `undefined` when unset, empty or whitespace. */
export function envString(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** The variable's value, or `fallback` when unset, empty or whitespace. */
export function envOr(name: string, fallback: string): string {
  return envString(name) ?? fallback;
}

/**
 * The variable parsed as a finite number, or `fallback`.
 *
 * A non-numeric value falls back rather than yielding `NaN`: `NaN` propagates
 * silently through arithmetic and surfaces far from its cause.
 */
export function envNumber(name: string, fallback: number): number {
  const raw = envString(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
