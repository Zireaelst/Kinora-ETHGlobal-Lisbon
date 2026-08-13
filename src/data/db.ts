import "dotenv/config";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import Database from "better-sqlite3";
import type { BasisPoints } from "../types/marketplace.js";
import { envOr } from "../env.js";

/**
 * The rights holder's catalogue.
 *
 * This is the half of the system that never goes on-chain. A track's master
 * reference lives here encrypted at the field level and is only decrypted for a
 * buyer who has actually paid — so the ledger records that a licence was
 * granted without the asset itself ever being readable from it.
 */

const ALGORITHM = "aes-256-gcm";
/** 96-bit nonce is the size AES-GCM is specified for. */
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/** Named so a row records *which* key encrypted it, not the key itself. */
export const DEFAULT_KEY_REF = "owner-master-key";

/** Every track is issued in basis points, so 10000 = the whole licensing capacity. */
export const TOTAL_SHARES: BasisPoints = 10000;

export type LicenceStatus =
  | "pending"
  | "accepted"
  | "declined"
  /** Paid, granted, audited on HCS and certified with an HTS licence NFT. */
  | "completed";

export interface TrackRow {
  id: number;
  title: string;
  artist: string;
  total_shares: BasisPoints;
  available_shares: BasisPoints;
  base_price_per_share: number;
  /** Ciphertext — use {@link decryptField} with `encryption_key_ref`. */
  encrypted_master_ref: string;
  encryption_key_ref: string;
  created_at: string;
}

export interface LicenceRow {
  id: number;
  track_id: number;
  /** HCS-14 UAID of the buying agent, e.g. `did:uaid:...;nativeId=hedera:testnet:0.0.x`. */
  buyer_uaid: string;
  shares: BasisPoints;
  licence_type: string;
  territory: string;
  use_case: string;
  price: number;
  status: LicenceStatus;
  tx_hash: string | null;
  /** Serial of the HTS licence certificate NFT minted for this grant. */
  certificate_serial: string | null;
  /** requestHash of the compliance attestation that admitted this buyer (gate 1). */
  attestation_hash: string | null;
  created_at: string;
}

/**
 * Derives the encryption key from `DATA_ENCRYPTION_KEY`.
 *
 * scrypt with a fixed salt keeps the demo reproducible across restarts — a
 * production system would use a per-record salt and a real KMS, which is what
 * `encryption_key_ref` is there to point at.
 */
function deriveKey(keyRef: string): Buffer {
  const secret = process.env.DATA_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "Missing environment variable DATA_ENCRYPTION_KEY — set a passphrase in .env (any string; it never leaves this machine).",
    );
  }
  return scryptSync(secret, keyRef, KEY_LENGTH);
}

/**
 * Encrypts one field.
 *
 * Output is `iv:authTag:ciphertext`, all base64. The tag is what makes this
 * tamper-evident: altering the stored ciphertext makes decryption throw rather
 * than quietly returning wrong data.
 */
export function encryptField(plaintext: string, keyRef: string = DEFAULT_KEY_REF): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(keyRef), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** Reverses {@link encryptField}. Throws if the value was altered. */
export function decryptField(payload: string, keyRef: string = DEFAULT_KEY_REF): string {
  const [ivPart, tagPart, dataPart] = payload.split(":");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Malformed encrypted value — expected iv:authTag:ciphertext");
  }

  const authTag = Buffer.from(tagPart, "base64");
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Malformed auth tag (${authTag.length} bytes, expected ${AUTH_TAG_LENGTH})`);
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    deriveKey(keyRef),
    Buffer.from(ivPart, "base64"),
  );
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export const DEFAULT_DB_PATH = envOr("DATA_DB_PATH", "catalogue.db");

/**
 * Opens the database and creates the schema if it is not there yet.
 *
 * Pass `":memory:"` for tests.
 */
export function openDatabase(path: string = DEFAULT_DB_PATH): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      title                TEXT    NOT NULL,
      artist               TEXT    NOT NULL,
      total_shares         INTEGER NOT NULL DEFAULT ${TOTAL_SHARES},
      available_shares     INTEGER NOT NULL,
      base_price_per_share REAL    NOT NULL,
      encrypted_master_ref TEXT    NOT NULL,
      encryption_key_ref   TEXT    NOT NULL DEFAULT '${DEFAULT_KEY_REF}',
      created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS licences (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id           INTEGER NOT NULL REFERENCES tracks (id),
      buyer_uaid         TEXT    NOT NULL,
      shares             INTEGER NOT NULL,
      licence_type       TEXT    NOT NULL,
      territory          TEXT    NOT NULL,
      use_case           TEXT    NOT NULL,
      price              REAL    NOT NULL,
      status             TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','accepted','declined','completed')),
      tx_hash            TEXT,
      certificate_serial TEXT,
      attestation_hash   TEXT,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_licences_buyer ON licences (buyer_uaid);
  `);

  // Databases created before the column existed: ALTER is idempotent-by-catch,
  // since SQLite has no ADD COLUMN IF NOT EXISTS.
  try {
    db.exec("ALTER TABLE licences ADD COLUMN attestation_hash TEXT");
  } catch {
    /* already present */
  }

  return db;
}

/**
 * Adds a track to the catalogue, encrypting the master reference on the way in.
 *
 * A fresh track has its full capacity available; `availableShares` only ever
 * moves through {@link reserveShares}.
 */
export function insertTrack(
  db: Database.Database,
  track: {
    title: string;
    artist: string;
    masterRef: string;
    basePricePerShare: number;
    totalShares?: BasisPoints;
  },
  keyRef: string = DEFAULT_KEY_REF,
): number {
  const totalShares = track.totalShares ?? TOTAL_SHARES;
  const result = db
    .prepare(
      `INSERT INTO tracks
         (title, artist, total_shares, available_shares, base_price_per_share,
          encrypted_master_ref, encryption_key_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      track.title,
      track.artist,
      totalShares,
      totalShares,
      track.basePricePerShare,
      encryptField(track.masterRef, keyRef),
      keyRef,
    );
  return Number(result.lastInsertRowid);
}

/**
 * Reads one track back.
 *
 * The master reference stays encrypted in the returned row — decrypt it with
 * `decryptField(row.encrypted_master_ref, row.encryption_key_ref)` only once a
 * licence has actually been paid for.
 */
export function getTrack(db: Database.Database, id: number): TrackRow | undefined {
  return db.prepare("SELECT * FROM tracks WHERE id = ?").get(id) as TrackRow | undefined;
}

/** The catalogue as a buyer's agent browses it, oldest first. */
export function listTracks(db: Database.Database): TrackRow[] {
  return db.prepare("SELECT * FROM tracks ORDER BY id").all() as TrackRow[];
}

/** Records a licence request so the negotiation leaves an auditable trail. */
export function insertLicence(
  db: Database.Database,
  licence: {
    trackId: number;
    buyerUaid: string;
    shares: BasisPoints;
    licenceType: string;
    territory: string;
    useCase: string;
    price: number;
    status?: LicenceStatus;
    /** requestHash of the gate-1 attestation, kept with the negotiated terms. */
    attestationHash?: string;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO licences
         (track_id, buyer_uaid, shares, licence_type, territory, use_case, price, status,
          attestation_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      licence.trackId,
      licence.buyerUaid,
      licence.shares,
      licence.licenceType,
      licence.territory,
      licence.useCase,
      licence.price,
      licence.status ?? "pending",
      licence.attestationHash ?? null,
    );
  return Number(result.lastInsertRowid);
}

/** Advances a licence's status, attaching the payment transaction once there is one. */
export function updateLicenceStatus(
  db: Database.Database,
  id: number,
  status: LicenceStatus,
  txHash?: string,
): void {
  db.prepare("UPDATE licences SET status = ?, tx_hash = COALESCE(?, tx_hash) WHERE id = ?").run(
    status,
    txHash ?? null,
    id,
  );
}

/** Records the HTS certificate NFT minted for a granted licence. */
export function setLicenceCertificate(
  db: Database.Database,
  id: number,
  certificateSerial: string,
): void {
  db.prepare("UPDATE licences SET certificate_serial = ? WHERE id = ?").run(
    certificateSerial,
    id,
  );
}

/**
 * Takes `shares` out of a track's remaining capacity.
 *
 * Called **only on completion** — never on acceptance. An accepted offer is a
 * promise the buyer may still walk away from, and reserving there would let a
 * buyer exhaust a track by negotiating and never paying.
 *
 * The guard lives in the `WHERE` clause rather than in a read-then-write, so
 * two settlements racing each other cannot both pass a capacity check and
 * oversell the track; the loser matches no row and gets `false` back.
 */
export function reserveShares(
  db: Database.Database,
  trackId: number,
  shares: BasisPoints,
): boolean {
  const result = db
    .prepare(
      `UPDATE tracks SET available_shares = available_shares - ?
        WHERE id = ? AND available_shares >= ?`,
    )
    .run(shares, trackId, shares);
  return result.changes === 1;
}
