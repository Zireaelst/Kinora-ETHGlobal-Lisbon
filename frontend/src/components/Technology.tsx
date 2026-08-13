import SectionHeading from './SectionHeading';

/**
 * The badge row.
 *
 * The "0 smart contracts" badge is the load-bearing one for the No Solidity
 * track, and it is a checkable claim rather than a slogan — the grep that backs
 * it is quoted underneath and is the same one in the README.
 */

const BADGES = [
  { name: 'A2A Protocol', detail: 'agent-to-agent negotiation' },
  { name: 'x402', detail: '402 → sign → 200 payments' },
  { name: 'Hedera Consensus Service', detail: 'audit, identity, attestation' },
  { name: 'Hedera Token Service', detail: 'licence certificate NFTs' },
  { name: 'Mirror Node', detail: 'every read, independently verifiable' },
  { name: 'HCS-14', detail: 'agent identity (partial subset)' },
  { name: 'Hedera SDK', detail: '@hiero-ledger/sdk' },
];

export default function Technology() {
  return (
    <section
      id="technology"
      className="relative overflow-hidden border-t border-accent/15 bg-[#0D0B27] py-20 sm:py-28 md:py-32"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(900px 420px at 50% -10%, rgba(110,86,207,0.16), transparent 65%)',
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <SectionHeading
          eyebrow="Technology"
          title="Hedera's own primitives, and nothing pretending to be them."
        />

        <div className="mt-12 flex flex-wrap gap-3">
          {BADGES.map((badge) => (
            <div
              key={badge.name}
              className="liquid-glass rounded-xl border border-accent/25 bg-accent/[0.05] px-5 py-3.5 transition-colors hover:border-accent/50"
            >
              <p className="text-sm font-semibold text-white">{badge.name}</p>
              <p className="font-mono mt-0.5 text-[11px] text-white/50">{badge.detail}</p>
            </div>
          ))}

          {/* The claim the No Solidity track turns on. */}
          <div className="rounded-xl border border-accent-teal/50 bg-accent-teal/[0.12] px-5 py-3.5 shadow-[0_0_40px_-16px_rgba(0,206,201,0.8)]">
            <p className="font-instrument-serif text-2xl leading-none text-accent-teal">
              0 smart contracts
            </p>
            <p className="font-mono mt-1 text-[11px] text-accent-teal/70">
              none written, none deployed, none called
            </p>
          </div>
        </div>

        <div className="mt-8 max-w-3xl overflow-hidden rounded-2xl border border-accent/25 bg-black/40">
          <p className="font-mono border-b border-accent/20 px-5 py-3 text-[11px] tracking-[0.1em] text-white/45 uppercase">
            The claim, and how to check it
          </p>
          <pre className="overflow-x-auto px-5 py-4 font-mono text-[12px] leading-relaxed text-white/80">
{`grep -rniE "solidity|\\bethers\\b|Contract(Execute|Call|Create)Transaction|\\.sol\\b" \\
  src scripts --include=*.ts --include=*.html
# exits 1 — no matches across all source files`}
          </pre>
        </div>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/60">
          The project started on ERC-8004 Solidity registries and that layer was deleted, not
          bypassed — identity, the audit trail and the certificate all moved onto Hedera&rsquo;s own
          services. <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[12px]">ethers</code>{' '}
          survives only inside the Hedera SDK&rsquo;s dependency tree; nothing here imports it.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60">
          A licence can also be paid for in a stablecoin on X Layer, so a buyer agent holding no
          HBAR is not shut out. That rail settles the way the rest of this project works: the buyer
          signs an EIP-712 authorisation and a facilitator submits it. Kinora writes no contract,
          deploys none, and calls none on either chain — which is why the check above still exits 1.
        </p>
      </div>
    </section>
  );
}
