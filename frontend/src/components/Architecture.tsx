import SectionHeading from './SectionHeading';

const STACK_GROUPS = [
  { label: 'Hedera', chips: ['@hiero-ledger/sdk', '@hashgraph/hedera-agent-kit'] },
  { label: 'Agent protocol', chips: ['@a2a-js/sdk', 'AgentCard 1.0 + 0.3', 'JSON-RPC'] },
  {
    label: 'Payments',
    chips: [
      '@x402/express',
      '@x402/hedera',
      'facilitator: blocky402',
      'asset: HBAR (0.0.0)',
    ],
  },
  {
    label: 'Payments — second rail',
    chips: [
      '@x402/evm',
      'X Layer testnet (eip155:1952)',
      'facilitator: OKX',
      'asset: USDC_TEST (EIP-3009)',
    ],
  },
  {
    label: 'Identity',
    chips: ['HCS-14 UAID', 'did:uaid:{id};proto=a2a;nativeId=hedera:testnet:{account};uid=0'],
  },
  { label: 'Data', chips: ['better-sqlite3', 'AES-256-GCM (field-level)'] },
  { label: 'Policy parsing', chips: ['@langchain/groq', 'llama-3.3-70b-versatile'] },
];

const RESOURCES = [
  { k: 'Seller account', v: '0.0.9695366' },
  { k: 'Buyer account', v: '0.0.10062841' },
  { k: 'HCS identity registry topic', v: '0.0.10062828' },
  { k: 'HTS licence certificate collection', v: '0.0.10062876 — "Music Licence Certificate" (MLIC)' },
  { k: 'HCS audit topic', v: 'configured via HCS_AUDIT_TOPIC_ID' },
  {
    k: 'Repository',
    v: 'github.com/SweetieBirdX/Kinora ↗',
    href: 'https://github.com/SweetieBirdX/Kinora',
  },
];

const TEST_RESULTS = [
  { num: '22', of: '22', label: 'E2E — run twice back-to-back' },
  { num: '33', of: '33', label: 'Identity' },
  { num: '18', of: '18', label: 'Errors' },
  { num: '25', of: '25', label: 'Catalog' },
];

const SCENARIOS = [
  "A permitted sync licence closes with real HBAR — the certificate NFT is verified in the buyer's wallet, capacity decrements exactly, and a replay writes and mints nothing.",
  'A 1000 ℏ political-ad offer is rejected.',
  'An over-capacity request is rejected before payment.',
  "A low offer triggers the agent's autonomous counter-offer from the disclosed floor, then accept, then payment.",
  'A clean-clone install was also verified.',
];

export default function Architecture() {
  return (
    <section
      id="architecture"
      className="relative overflow-hidden border-t border-accent/15 bg-[#0D0B27] py-20 sm:py-28 md:py-32"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(1000px 500px at 50% -15%, rgba(110,86,207,0.18), transparent 65%)',
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <SectionHeading
          eyebrow="Architecture"
          title="Built directly on Hedera's primitives."
          intro="The raw asset never touches the chain. Only payment, identity, and the licence certificate do."
        />

        {/* On-chain vs off-chain */}
        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-accent/40 bg-accent/[0.1] p-7 shadow-[0_0_50px_-20px_rgba(110,86,207,0.9)]">
            <h3 className="font-instrument-serif text-xl text-white">On-chain — Hedera</h3>
            <p className="font-mono mt-1 mb-6 text-xs text-accent-teal/80">public, verifiable</p>
            <div className="flex flex-col gap-5">
              {[
                {
                  tag: 'x402',
                  title: 'Payment',
                  desc: 'HBAR micropayment, native asset (0.0.0), Hedera testnet.',
                },
                {
                  tag: 'HCS',
                  title: 'Identity, reputation & attestation',
                  desc: 'Written on every accept and every reject.',
                },
                {
                  tag: 'HTS',
                  title: 'Licence certificate',
                  desc: 'An NFT minted to the buyer that negotiated, once the licence completes.',
                },
              ].map((item) => (
                <div key={item.tag} className="flex gap-3">
                  <span className="font-mono h-fit flex-shrink-0 rounded-md bg-accent/25 px-2 py-1 text-[11px] font-bold text-accent-teal">
                    {item.tag}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="mt-0.5 text-sm text-white/65">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-accent/15 bg-accent/[0.03] p-7">
            <h3 className="font-instrument-serif text-xl text-white">Off-chain — private</h3>
            <p className="font-mono mt-1 mb-6 text-xs text-white/50">encrypted at rest</p>
            <div className="flex flex-col gap-5">
              {[
                {
                  tag: 'SQLite',
                  title: 'Master asset reference',
                  desc: 'Field-level AES-256-GCM encryption.',
                },
                {
                  tag: 'Memory',
                  title: 'Decrypted only after payment',
                  desc: 'Held only long enough to build the response — never persisted in the clear, never written on-chain.',
                },
              ].map((item) => (
                <div key={item.tag} className="flex gap-3">
                  <span className="font-mono h-fit flex-shrink-0 rounded-md border border-white/20 px-2 py-1 text-[11px] font-bold text-white/70">
                    {item.tag}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="mt-0.5 text-sm text-white/65">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tech stack */}
        <div className="mt-20">
          <h3 className="font-instrument-serif mb-1 text-xl text-white sm:text-2xl">
            Tech stack
          </h3>
          <p className="mb-8 text-sm text-white/65">
            Everything that has to be provable stays on Hedera: identity, the audit trail, and the
            certificate with its royalty. Only the money can take a second route — a licence settles
            in HBAR, or in a stablecoin on X Layer for a buyer holding no HBAR. Neither route writes
            or deploys a contract.
          </p>
          <div className="flex flex-col">
            {STACK_GROUPS.map((group, i) => (
              <div
                key={group.label}
                className={`grid grid-cols-1 gap-3 py-5 sm:grid-cols-[160px_1fr] ${
                  i !== 0 ? 'border-t border-accent/15' : ''
                }`}
              >
                <p className="font-mono pt-1 text-xs tracking-[0.08em] text-accent-teal/80 uppercase">
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-2">
                  {group.chips.map((chip) => (
                    <span
                      key={chip}
                      className="font-mono rounded-md border border-accent/20 bg-accent/[0.05] px-3 py-1.5 text-[13px] text-white/85"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live proof */}
        <div className="mt-20">
          <h3 className="font-instrument-serif mb-1 text-xl text-white sm:text-2xl">
            Live on testnet
          </h3>
          <p className="mb-8 max-w-lg text-sm text-white/65">
            Real accounts, real topics, real test runs — everything below is verifiable on Hedera
            testnet right now.
          </p>

          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-accent/20 bg-accent/15 sm:grid-cols-2">
            {RESOURCES.map((r) => (
              <div key={r.k} className="bg-[#0D0B27] p-5">
                <p className="mb-1.5 text-xs text-white/55">{r.k}</p>
                {r.href ? (
                  <a
                    href={r.href}
                    target="_blank"
                    rel="noopener"
                    className="font-mono text-[13px] break-all text-accent-teal hover:underline"
                  >
                    {r.v}
                  </a>
                ) : (
                  <p className="font-mono text-[13px] break-all text-white/90">{r.v}</p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TEST_RESULTS.map((t) => (
              <div
                key={t.label}
                className="rounded-2xl border border-accent/20 bg-accent/[0.04] p-5"
              >
                <p className="font-instrument-serif text-3xl text-accent-teal">
                  {t.num}
                  <span className="text-lg text-white/40">/{t.of}</span>
                </p>
                <p className="mt-1 text-xs text-white/65">{t.label}</p>
              </div>
            ))}
          </div>

          <ul className="mt-8 flex flex-col gap-3">
            {SCENARIOS.map((s) => (
              <li key={s} className="flex gap-3 text-sm leading-relaxed text-white/75">
                <span className="mt-0.5 flex-shrink-0 font-bold text-accent-teal">✓</span>
                {s}
              </li>
            ))}
          </ul>

          <div className="mt-8 rounded-xl border border-accent/25 border-l-2 border-l-accent bg-accent/[0.08] p-5">
            <p className="text-sm leading-relaxed text-white/75">
              <strong className="text-white/95">On honesty:</strong> the compliance attestation is
              self-issued by the seller agent — it verifies itself. Treat it as an on-chain audit
              trail, not independent third-party verification.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-white/75">
              This is a hackathon prototype running on Hedera testnet, not a production system. No
              real revenue, users, or licensing partners are implied.
            </p>
          </div>
        </div>

        {/* Track fit */}
        <div className="mt-20 rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/25 via-accent/[0.06] to-transparent p-8 shadow-[0_0_60px_-25px_rgba(110,86,207,0.9)] sm:p-10">
          <p className="font-mono mb-3 text-xs tracking-[0.15em] text-accent-teal uppercase">
            Track Fit
          </p>
          <h3 className="font-instrument-serif mb-4 text-2xl text-white sm:text-3xl">
            Hedera — AI &amp; Agentic Payments
          </h3>
          <p className="max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base">
            Kinora is two autonomous agents that negotiate, verify each other's identity, and pay
            one another with no human in the loop — built directly on Hedera's consensus, token,
            and micropayment primitives: HCS for identity and audit, HTS for the licence
            certificate, x402 for settlement.
          </p>
        </div>
      </div>
    </section>
  );
}
