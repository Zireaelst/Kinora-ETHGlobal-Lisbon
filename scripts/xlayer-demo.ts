import "dotenv/config";
import { insertLicence, insertTrack, listTracks, openDatabase } from "../src/data/db.js";
import { quotePrice } from "../src/data/catalog.js";
import { getBuyerUaid } from "../src/identity/agent-ids.js";
import {
  HBAR_USD_RATE,
  hbarToXLayerBaseUnits,
  LICENCE_GRANT_PATH,
  X402_PORT,
  xlayerAsset,
} from "../src/x402/config.js";
import { initialisePayments, startX402Server } from "../src/x402/server.js";

/**
 * Stands up a licence that an outside agent can actually pay for, and stays up.
 *
 *   npm run demo:xlayer
 *
 * The licence endpoint only serves a licence some negotiation authorised, so
 * there is no URL to hand a buyer until one exists. This seeds a track, records
 * an accepted licence against it, prints the payment URL, and holds the server
 * open so the OKX CLI can be pointed at it from another terminal:
 *
 *   onchainos payment quote <url>        # reads the 402, prices it, pays nothing
 *   onchainos payment pay --payment-id … # settles, after you confirm
 *
 * Uses its own database (DEMO_DB_PATH, default demo-xlayer.db) so a demo never
 * writes into the catalogue the rest of the project uses.
 */

/**
 * The buyer this licence is recorded against.
 *
 * Read from the registry rather than hard-coded: the UAID names the Hedera
 * account the certificate is minted to, so a stale one sends the certificate
 * to an account nobody in this environment controls.
 */
const DEMO_BUYER_UAID = getBuyerUaid();

process.env.DATA_DB_PATH ??= "demo-xlayer.db";

async function main(): Promise<void> {
  const db = openDatabase();
  let trackId: number;
  let licenceId: number;
  try {
    // Reuse the first track if this has been run before, so repeated runs do
    // not pile up near-identical rows.
    const existing = listTracks(db);
    trackId =
      existing[0]?.id ??
      insertTrack(db, {
        title: "Neon Harbour",
        artist: "Aslan Vega",
        basePricePerShare: 0.00082,
        masterRef: "https://example.invalid/master/neon-harbour.wav",
      });

    licenceId = insertLicence(db, {
      trackId,
      buyerUaid: DEMO_BUYER_UAID,
      shares: 500,
      licenceType: "sync",
      territory: "worldwide",
      useCase: "film",
      price: await quotePrice(trackId, 500),
      status: "accepted",
    });
  } finally {
    db.close();
  }

  startX402Server();
  // The rails are only settled once the pre-flight has run; printing the URL
  // before that would advertise a rail this process may be about to drop.
  await initialisePayments();

  const params = new URLSearchParams({
    trackId: String(trackId),
    shares: "500",
    licenceType: "sync",
    useCase: "film",
    territory: "worldwide",
    licenceId: String(licenceId),
  });
  const url = `http://localhost:${X402_PORT}${LICENCE_GRANT_PATH}?${params}`;

  const priceHbar = await quotePrice(trackId, 500);
  const asset = xlayerAsset();

  console.log(`\n${"─".repeat(72)}`);
  console.log(`Licence ${licenceId}: 500 shares (5%) of track ${trackId}, sync / film`);
  console.log(`  Hedera   ${priceHbar} ℏ`);
  console.log(
    `  X Layer  ${hbarToXLayerBaseUnits(priceHbar, asset)} base units of ${asset.eip712Name}` +
      ` (${(priceHbar * HBAR_USD_RATE).toFixed(6)} @ ${HBAR_USD_RATE} USD/ℏ)`,
  );
  console.log(`\n  ${url}\n`);
  console.log(`Point the OKX CLI at it:`);
  console.log(`  onchainos payment quote "${url}"`);
  console.log(`\nEach acceptance settles once — re-run this to mint a fresh licence.`);
  console.log(`${"─".repeat(72)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
