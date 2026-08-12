# OKX.AI Ekosistemi — Kinora Uygunluk Analizi

**Tarih:** 2026-08-12 · **Kapsam:** yalnızca analiz, kod değişikliği yok · **Repo durumu:** `main`, temiz, `origin/main` ile senkron

---

## 0. Yönetici özeti — üç cümlelik karar

Kinora, ödeme/kimlik/denetim katmanının tamamı **Hedera** üzerinde çalışan, EVM'i
*bilinçli olarak silmiş* (No Solidity bounty'si için) bir müzik lisans pazaryeridir.
OKX.AI'nin çalıştırma tarafındaki bileşenlerinin **hiçbiri Hedera'yı desteklemiyor** —
kurulu 9 OKX skill dosyasının tamamında `hedera` veya `hbar` kelimesi **sıfır kez** geçiyor
(`grep -rin "hedera\|hbar" ~/.claude/skills` → boş), Agentic Wallet'in adres üretebildiği
7 zincir XLayer/Solana/Ethereum/Base/BSC/Arbitrum, ödeme protokolü ise dispatcher'ın
kendi ifadesiyle `method="evm"` dışını reddediyor.

Bu yüzden "OKX cüzdanını Kinora'ya takalım" tipi bir **yer değiştirme entegrasyonu
teknik olarak imkânsız**; anlamlı olan tek eksen, iki tarafın da aynı **x402 tel
protokolünü** konuşuyor olması — Kinora zaten x402 v2 satıcısıdır, OKX de x402 alıcısıdır.
Yani gerçek fırsat *ödeme rayını değiştirmek* değil, **ikinci bir ray eklemek**:
lisans endpoint'i `accepts[]` dizisine bir X Layer kalemi de koyarsa, OKX Agentic
Wallet'lı herhangi bir ajan Hedera'ya hiç dokunmadan lisans satın alabilir.

---

## 1. Mevcut mimari

### 1.1 Stack

| Katman | Teknoloji |
|---|---|
| Dil / runtime | TypeScript (ESM, NodeNext), `tsx`, Node 24 |
| Zincir SDK | `@hiero-ledger/sdk` 2.86 (Hedera SDK'nın Linux Foundation sonrası adı) |
| Ajan çerçevesi | `@hashgraph/hedera-agent-kit` 4.0 + `-langchain` 1.0, `AgentMode.AUTONOMOUS` |
| Ajanlar arası protokol | `@a2a-js/sdk` 1.0 — **Google/LF A2A** (AgentCard, Task lifecycle, JSON-RPC) |
| Ödeme | `@x402/core` + `@x402/express` + `@x402/hedera` 2.16, facilitator `api.testnet.blocky402.com` |
| Kimlik | HCS-14 UAID + kendi HCS registry topic'imiz (ERC-8004'ten göç edildi) |
| Veri | `better-sqlite3` + alan bazlı AES-256-GCM (`src/data/db.ts`) |
| LLM | `@langchain/groq`, `llama-3.3-70b-versatile`, `temperature: 0` |
| Frontend | React 19 + Vite 8 + Tailwind 4 — **statik tanıtım sayfası** |

### 1.2 Ana modüller

```
src/a2a/          seller-executor.ts (862 satır, 3 kapı) · buyer-client.ts (pazarlık stratejisi)
src/x402/         server.ts (402 duvarı + negotiation binding) · pay.ts (alıcı imzalama) · config.ts
src/hedera/       clients.ts (operator) · certificate.ts (HTS NFT) · audit.ts (HCS) · mirror.ts · agentkit.ts
src/identity/     uaid.ts · registry.ts · verify.ts · attestation.ts · reputation.ts · profile.ts
src/data/         db.ts (şifreli katalog) · catalog.ts (fiyat + grant)
src/policy/       parser.ts (doğal dil → LicencePolicy)
src/web/          server.ts + api.ts (SSE demo paneli)
frontend/         landing page (cüzdan yok, buton yok, işlem yok)
```

### 1.3 Akış

```
Alıcı ajan ──A2A mesajı (buyerUaid + teklif metadata)──► Satıcı ajan
                                                          │
  Kapı 1  identity/verify.ts   → HCS registry + attestation
  Kapı 2  evaluateOffer()      → LLM'in ürettiği politikaya karşı (lisans tipi / kullanım / tavan / fiyat)
  Kapı 3  checkAvailability()  → kalan pay yeterli mi
                                                          │
              ◄──accept + PaymentInstruction (URL, tinybar, asset 0.0.0, hedera:testnet)──
                                                          │
  payAndFetch() → GET → 402 → payment-required decode → ExactHederaScheme imzası → GET + payment-signature → 200
                                                          │
  recordCompletedSale(): HCS audit → HCS reputation → pay rezervasyonu → HTS sertifika NFT (%5 royalty) → ledger
```

### 1.4 Mevcut cüzdan / zincir / trading entegrasyonu

- **Cüzdan bağlama akışı: yok.** İnsan cüzdanı hiçbir yerde yok. Tasarımın *tezi* bu:
  "hiçbir işlemi insan onaylamıyor."
- **Zincir: yalnızca Hedera testnet.** EVM tamamen silinmiş —
  `docs/bounty-coverage.md:15-17` bunu bir grep komutuyla kanıt olarak sunuyor,
  `frontend/src/components/Technology.tsx:68` aynı grep'i **tanıtım sayfasında
  gösteriyor**.
- **Trading entegrasyonu: yok.** Ne DEX, ne CEX, ne fiyat beslemesi. Tek "fiyat"
  kavramı `quotePrice(track, shares)` — katalogdaki pay başına HBAR oranı.

---

## 2. Projenin doğası

**Trading/DeFi değil.** Kinora bir **fikrî mülkiyet lisanslama pazaryeri**:
satılan şey bir token değil, bir *kullanım hakkı* (bir parçanın lisanslama
kapasitesinin baz puan cinsinden yüzdesi). Zincir üç iş için var:

1. **Ödeme** — HBAR transferi (x402)
2. **Kimlik** — HCS-14 UAID profilleri (HCS topic)
3. **Kanıt** — denetim izi (HCS) + lisans sertifikası (HTS NFT, %5 royalty)

Bunun pratik sonucu: OKX'in **alım-satım/piyasa** tarafındaki her şey (DEX aggregation,
Agent Trade Kit'in 82 aracı, smart money sinyalleri, prediction market, DeFi getiri
ürünleri) bu projeye **konu olarak yabancı**. OKX'in **ajan altyapısı** tarafı
(ödeme protokolü, ajan cüzdanı, ajan pazaryeri) ise konu olarak **tam isabet** —
sorun konu değil, **zincir uyuşmazlığı**.

---

## 3. Yedi bileşenin tek tek değerlendirmesi

| # | Bileşen | Karar | Tek cümlelik gerekçe |
|---|---|---|---|
| 1 | X Layer (contract deploy) | ❌ **Uymuyor** | Projenin hiç contract'ı yok ve EVM'siz olmak bilinçli bir satış argümanı |
| 2 | OKX Wallet (insan cüzdanı) | ❌ **Uymuyor** | Ürünün tezi "insan onayı yok"; bağlanacak bir imza akışı mevcut değil |
| 3 | Agentic Wallet | ⚠️ **Kısmen** | Hedera'yı imzalayamaz; yalnızca yeni bir EVM rayının alıcı tarafı olarak anlamlı |
| 4 | Onchain OS — Payments (x402) | ✅ **En iyi eşleşme** | Aynı tel protokolü; `accepts[]` çoklu şema desteği hazır bir köprü |
| 4b | Onchain OS — DEX / Analyze / DApp Connect | ❌ **Uymuyor** | Swap, likidite, lending — hiçbiri lisans pazaryerinin işleyişine girmiyor |
| 5 | Agent Trade Kit | ❌ (⚠️ tek istisna) | CEX trading tamamen alakasız; yalnızca auth'suz HBAR/USDT fiyatı kozmetik bir kazanç |
| 6 | Hazır skill dosyaları | ✅ **Zaten kurulu** | 9 OKX skill'i `~/.claude/skills/` altında hazır; sıfır kod, sıfır risk |
| 7 | OKX.AI Marketplace / ASP | ✅ **Uygun ama şartlı** | Ajan gerçekten listelenebilir; public HTTPS + USDT fiyat + ERC-8004 kimliği şart |

### 1 — X Layer · ❌ Zorlama olur

X Layer bir contract deploy hedefi. Kinora'nın **deploy edilecek contract'ı yok** ve bu
bir eksiklik değil, kasıtlı bir tercih: ERC-8004 Solidity registry'leri projeden
*silindi* (session 48 pivotu, `PIVOT-PLAN.md:96`), `ethers` bağımlılıktan çıkarıldı,
ve bu durum `docs/bounty-coverage.md`'de bir bounty gereksinimi olarak kayıt altında.

Akla gelebilecek tek dürüst kullanım: HTS lisans sertifikasının X Layer'da ERC-721
kopyasını çıkarmak. Buna karşı iki argüman var — (a) HTS'te royalty **protokol
seviyesinde** ve şu an gerçekten çalışıyor (`scripts/verify-royalty.ts` → 7/7, 10 ℏ'lık
yeniden satıştan 0.5 ℏ hak sahibine gitti); ERC-721'de aynı şeyi yapmak ERC-2981 +
pazaryerinin gönüllü uyumu demek, yani **zayıflatma**. (b) Aynı lisansın iki zincirde
iki sertifikası olması "hangisi gerçek lisans?" sorusunu doğurur — hukuki anlatıyı
bozar.

**Sonuç: X Layer bu proje için anlamsız, çünkü projenin deploy edecek bir şeyi yok ve
sertifika mekanizması HTS'te zaten daha güçlü.**

### 2 — OKX Wallet · ❌ Ürün teziyle çelişiyor

`frontend/` bir tanıtım sayfası: `App.tsx` dokuz görsel bölüm render ediyor, tek bir
buton bile işlem tetiklemiyor, `frontend/package.json`'da wagmi/viem/WalletConnect yok.
Bağlanacak bir imza yüzeyi **yok**.

Daha önemlisi: bir "Connect Wallet" butonu eklemek ürünün ana iddiasını —
*"hiçbir işlemi insan onaylamıyor"* — görsel olarak yalanlar. Bu, README'nin ve
`docs/bounty-coverage.md:40`'ın merkezinde duran cümle.

**Sonuç: OKX Wallet bu proje için anlamsız, çünkü ürünün tanımı gereği insan imzası
yok.** (İleride hak sahibi için bir *dashboard* — katalog yükleme, sertifika görüntüleme,
gelir çekme — yapılırsa yeniden değerlendirilebilir; ama o zaman bile OKX Wallet'ın
Hedera/HBAR desteği doğrulanmalı.)

### 3 — Agentic Wallet · ⚠️ Hedera'yı imzalayamaz, ama yeni rayın alıcısı olabilir

Kurulu skill'in kendi tablosu (`~/.claude/skills/okx-agentic-wallet/_shared/chain-support.md`):

| Adres üretilebilen zincirler | xlayer (196) · xlayer_test (1952) · solana (501) · ethereum (1) · base (8453) · bsc (56) · arbitrum (42161) |
|---|---|

Hedera listede yok, "17+ diğer zincir" notunda da OKX'in tüm skill setinde `hedera`
kelimesi geçmiyor. Dolayısıyla Agentic Wallet:

- ❌ `SELLER_PRIVATE_KEY` / `BUYER_PRIVATE_KEY`'in yerini **alamaz**
- ❌ `TokenMintTransaction`, `TopicMessageSubmitTransaction`, HBAR transferi imzalayamaz
- ✅ Yeni bir **X Layer x402 rayı** açılırsa, o rayın alıcı ajanının cüzdanı olabilir

Yan fayda, göz ardı edilmemeli: bugün özel anahtarlar `.env`'de düz metin duruyor ve
`src/x402/pay.ts:66-72` ile `src/hedera/clients.ts:26-29`'da doğrudan okunuyor.
Agentic Wallet anahtarı TEE içinde tutuyor ve modele hiç göstermiyor — güvenlik
anlatısı için **gerçek** bir yükseltme, ama yalnızca EVM tarafında.

### 4 — Onchain OS · ✅ Payments modülü, ❌ geri kalanı

**Payments (x402 / Agent Payments Protocol) — en iyi eşleşme.** Kinora'nın satıcı
sunucusu zaten x402 v2 konuşuyor: `src/x402/server.ts:233` `paymentMiddleware`,
`src/x402/pay.ts:183-188` `payment-required` başlığını decode ediyor,
`pay.ts:236` `payment-signature` ile tekrar deniyor. OKX dispatcher'ının beklediği
başlıklar **birebir aynı** (`~/.claude/skills/okx-agent-payments-protocol/SKILL.md:170-176`).

Fark tek bir yerde: **network + scheme**. Bizim tek `accepts[]` kalemimiz
`{scheme: "exact", network: "hedera:testnet", asset: "0.0.0"}`. OKX tarafı `exact`
(EIP-3009 / Permit2), `upto`, `aggr_deferred`, `period` destekliyor — hepsi EVM,
ve dispatcher `method="evm"` dışını açıkça reddediyor.

x402 spesifikasyonu `accepts[]`'i **dizi** olarak tanımlıyor ve OKX skill'i çoklu-şema
seçimini (`multi-scheme.md`, `acceptsIndex`) ilk sınıf vatandaş olarak ele alıyor.
Yani köprü protokolde **zaten var**; bizim yapmamız gereken ikinci kalemi eklemek.

**DEX aggregation / Analyze / DApp Connect — ❌.** Kinora hiçbir token takas etmiyor,
likidite sağlamıyor, borç almıyor. Aave/Hyperliquid/Polymarket entegrasyonlarının
lisans pazaryerinde karşılığı yok. **Bu proje için anlamsızlar, çünkü ürün bir DeFi
ürünü değil.**

### 5 — Agent Trade Kit · ❌ (tek dar istisna: auth'suz piyasa verisi)

82 aracın tamamı CEX işlemleri: spot/futures/options emri, grid/DCA bot, earn, PnL,
smart money, prediction market. Kinora'da ne portföy var, ne pozisyon, ne emir.

**Tek istisna:** auth gerektirmeyen market-data araçları. Panelde ve `/earnings`
uçlarında "0.41 ℏ" yanına "≈ $X" yazmak için HBAR/USDT tickerı çekilebilir
(`src/web/api.ts:509` `totalEarnedHbar`, `frontend/src/components/LiveNumbers.tsx`).
Dürüst olmak gerekirse bu **kozmetik**: entegrasyon hikâyesi değil, bir sayı biçimlendirme
iyileştirmesi. OKX'in HBAR çiftini indekslediği de doğrulanmalı (DEX tarafı Hedera'yı
indekslemiyor; CEX tarafında HBAR-USDT var, ama bunu API'de teyit etmek gerek).

### 6 — Hazır skill dosyaları · ✅ Zaten kurulu, sıfır maliyet

Bu bileşen için yapılacak bir "entegrasyon" yok — **dokuz OKX skill'i bu makinede
kurulu durumda**: `okx-agentic-wallet`, `okx-agent-payments-protocol`, `okx-ai`,
`okx-dex-market`, `okx-defi`, `okx-dapp-discovery`, `okx-activity`, `okx-guide`,
`okx-growth-competition`. `onchainos` CLI de kurulu (`v4.4.9`,
`/Users/toyguntez/.local/bin/onchainos`), ayrıca `@okxweb3/a2a-node@0.1.9` global npm'de.

Bunlar Kinora'nın *kodunu* etkilemez; **geliştirme sırasında** OKX tarafını sürmek için
kullanılır (ödeme testi, ASP kaydı, cüzdan işlemleri). Repoya girecek tek şey, hangi
skill'in ne için kullanıldığını anlatan bir `docs/` notu olabilir.

> ⚠️ **Önemli isim çakışması.** `@okxweb3/a2a-node`'un "A2A"sı bizim A2A'mız **değil**:
> paketin kendi tanımı *"E2E encrypted agent-to-agent communication via **XMTP**"*.
> Kinora `@a2a-js/sdk` kullanıyor — AgentCard keşfi, Task yaşam döngüsü, JSON-RPC.
> İkisi farklı taşıma, farklı mesaj modeli. **Kinora'nın pazarlık katmanı OKX.AI'ye
> "olduğu gibi" takılmaz.**

### 7 — OKX.AI Marketplace / ASP · ✅ Uygun, ama dört şartı var

Satıcı ajanı bir **ASP (Agent Service Provider)** olarak listelemek gerçekten mümkün ve
konu olarak yerinde: "hak sahiplerinin kataloğunu ajanlar arası pazarlıkla lisanslayan
servis" ASP tanımına oturuyor. `onchainos agent create --role asp` akışı kurulu skill'de
tam belgeli (`okx-ai/references/identity-register.md`).

Şartlar (skill'in kendi kuralları):

1. **Public HTTPS endpoint** — `localhost`, `127.0.0.1`, private IP, placeholder **reddediliyor**
   (§6). Bugün satıcı `http://localhost:4000`, x402 sunucusu `http://localhost:4021`.
   **Yani önce gerçek bir deploy şart.**
2. **Fiyat USDT cinsinden** — pazaryeri fiyatlaması HBAR değil USDT. Servis ücreti ile
   lisans ücreti iki ayrı sayı olur; anlatıda bunu açıklamak gerekir.
3. **Servis tipi seçimi** — `A2MCP` (HTTP API, endpoint zorunlu) ya da `A2A` (OKX'in
   XMTP'si, endpoint yok). Bizim x402 uçlarımız doğal olarak **A2MCP**'ye oturur;
   OKX'in `A2A`'sı bizim A2A'mız olmadığı için o seçenek yeni bir taşıma yazmak demek.
4. **ERC-8004 kimliği** — `okx-ai` skill'i açıkça ERC-8004 ajan kimliği üzerine kurulu.
   Kinora bunu **HCS-14 lehine sildi**. Kayıt CLI ile dışarıdan yapıldığı için repoya
   Solidity girmez, ama *anlatı* çelişir: "ERC-8004'ü bıraktık" diyen bir README ile
   ERC-8004 kimliğiyle listelenmiş bir ajan yan yana durur. Bu bir yasak değil, bir
   **iletişim borcu** — README'de bir cümleyle açıklanmalı.

---

## 4. Uygun bulunanlar için somut entegrasyon planı

### 4.1 İkinci ödeme rayı: X Layer x402 (bileşen 4 + 3)

**Fikir:** lisans endpoint'i 402 cevabında iki ödeme seçeneği sunar. Alıcı ajan
Hedera'lıysa HBAR öder, OKX Agentic Wallet'lıysa X Layer'da stablecoin öder.
Kimlik, denetim izi, sertifika ve royalty **Hedera'da kalır** — değişen tek şey
paranın hangi rayda aktığı.

**Değişecek dosyalar:**

| Dosya | Değişiklik |
|---|---|
| `src/x402/config.ts` | `NETWORK` tekil sabiti (satır 31) → rayların listesi; `XLAYER_NETWORK`, `XLAYER_ASSET` (USDC/USDT kontratı), `xlayerAmount()` dönüşümü |
| `src/x402/server.ts:99-113` | `routes.accepts` tek nesneden **diziye**; ikinci kalem X Layer `exact` şeması. `licenceQuote()` (satır 89-97) her ray için ayrı miktar döndürmeli — HBAR tinybar **ve** stablecoin base units |
| `src/x402/server.ts:70` | `.register("hedera:*", …)` yanına `.register("eip155:196", new ExactEvmScheme())` — EVM şema paketi gerekir |
| `src/a2a/seller-executor.ts:68-80` | `PaymentInstruction` tekil (`priceHbar`, `asset`, `network`) → `options: PaymentOption[]`. **Geriye dönük uyum için** mevcut alanlar Hedera kalemini yansıtmaya devam etsin, yoksa `buyer-client.ts:351-366` ve `web/api.ts:373` kırılır |
| `src/a2a/seller-executor.ts:177-207` | `buildPaymentInstruction()` iki kalem üretir |
| `src/data/db.ts` | `licences` tablosuna `settlement_rail` (`hedera` \| `xlayer`) ve `settlement_asset` sütunları — hangi rayda ödendiği kayıt altına alınmalı |
| `src/a2a/seller-executor.ts:240-365` | `recordCompletedSale()`: `transactionId` artık Hedera formatında olmayabilir. HCS audit kaydına ray bilgisi, HashScan linki yerine raya göre explorer linki |
| `src/x402/pay.ts:219-229` | Alıcı tarafı: hangi kalemi seçtiğini belirtebilmeli (`preferNetwork` opsiyonu) — bugün en pahalıyı bakiye kontrolüne alıyor (satır 219-223), çoklu rayda bu mantık yanlış çalışır |
| `src/web/api.ts:345-350` | Panel: "settled … HashScan" satırı raya göre değişmeli |
| `docs/bounty-coverage.md` | "Real HBAR settlement" satırı artık tek gerçek değil — güncellenmeli |

**Yeni dosya:** `src/x402/xlayer.ts` — EVM şeması, asset kontratı, explorer URL üretimi.

**OKX tarafında test:** `onchainos payment quote <bizim-url>` → `payment pay --payment-id … --yes`.
Skill'in kendi akışı bu (Path A). Bizim sunucu doğru `accepts[]` döndürüyorsa OKX CLI
gerisini hallediyor — **el ile başlık kurmak yok**.

### 4.2 ASP listelemesi (bileşen 7)

Kod değişikliği **sıfır**; ön koşul bir **deploy**:

1. `src/a2a/seller-server.ts` (:4000) ve `src/x402/server.ts` (:4021) public HTTPS'e çıkar
   (`X402_BASE_URL` env değişkeni zaten dışarıdan geliyor — `config.ts:18-19`, hazır).
2. `frontend/src/lib/chain.ts`'teki testnet id'leri ya olduğu gibi kalır (demo) ya da
   mainnet'e taşınır (gerçek servis).
3. `onchainos agent create --role asp` → servis tipi `A2MCP`, endpoint = public
   `/licence/grant`, fiyat USDT.
4. `agent activate` ile yayına alınır.

**Not:** ASP kaydı `identity-register.md:119`'a göre endpoint'i **on-chain ve kalıcı**
yazıyor; değiştirmek ayrı bir update işlemi. Yani geçici bir tünel URL'i (ngrok vb.)
ile kayıt olmak kalıcı bir hata bırakır.

### 4.3 Fiyat gösterimi (bileşen 5, dar kapsam)

| Dosya | Değişiklik |
|---|---|
| `src/web/api.ts:447-524` | `/earnings` cevabına `totalEarnedUsd` eklenir |
| `frontend/src/components/LiveNumbers.tsx` | ℏ değerinin yanında ≈ USD |

Auth'suz ticker; anahtar yönetimi gerektirmez. **Tek başına yapılmaya değmez**, başka
bir işin yanında ucuz bir ek.

---

## 5. Mevcut cüzdan / imza / işlem kodu envanteri

| Dosya · satır | Ne yapıyor | Anahtar kaynağı | OKX ile durumu |
|---|---|---|---|
| `src/hedera/clients.ts:22-40` | `Client.forTestnet().setOperator()` — her iki ajan | `SELLER_/BUYER_PRIVATE_KEY` (ECDSA, `.env`) | **Yan yana.** OKX Hedera imzalayamaz |
| `src/x402/pay.ts:66-72` | `createClientHederaSigner()` — alıcının x402 imzası | `BUYER_PRIVATE_KEY` | **Yan yana.** X Layer rayı eklenirse ikinci bir imzalayıcı olur |
| `src/x402/pay.ts:226-231` | `x402Client().register("hedera:*", ExactHederaScheme)` | yukarıdakinden | **Genişletilir** — `.register("eip155:196", …)` eklenir |
| `src/x402/server.ts:68-70` | `x402ResourceServer` + `HTTPFacilitatorClient` | **anahtar tutmuyor** | **Genişletilir** — ikinci şema kaydı |
| `src/hedera/certificate.ts:102-123` | `TokenMintTransaction` + `TransferTransaction` | seller operator | **Değişmez.** HTS royalty'nin EVM karşılığı yok |
| `src/hedera/audit.ts` | `TopicMessageSubmitTransaction` | seller operator | **Değişmez** |
| `src/identity/registry.ts`, `reputation.ts`, `attestation.ts` | HCS yazımları | seller operator | **Değişmez** |
| `src/hedera/agentkit.ts:44-65` | Agent Kit, `AUTONOMOUS`, 43 araç | seller operator | **Değişmez.** OKX MCP'si ayrı bir araç seti olarak *eklenebilir* |
| `scripts/create-licence-token.ts`, `create-*-topic.ts`, `verify-royalty.ts` | tek seferlik kurulum | seller operator | **Değişmez** |

**Özet: OKX SDK'sı ile *değişecek* tek bir dosya yok. Her şey yan yana çalışır.**
Bu bir tesadüf değil — iki ekosistemin kesişimi sıfır zincir paylaşıyor.

---

## 6. Riskler ve açık sorular

### Riskler

| # | Risk | Etki | Azaltma |
|---|---|---|---|
| R1 | **Zincir uyuşmazlığı** — OKX'in hiçbir çalıştırma bileşeni Hedera'yı desteklemiyor | Yer değiştirme entegrasyonu imkânsız; her şey ikinci ray olmak zorunda | Kabul et, mimariyi buna göre kur |
| R2 | **"No Solidity" anlatısıyla çakışma** — bu iddia tanıtım sayfasında canlı bir grep olarak duruyor (`Technology.tsx:68`) | EVM kodu eklemek sayfanın kendi testini yalanlar | X Layer işini ayrı branch'te tut; ana dalda submission'ı bozma. Devam kararı verilirse sayfa metnini "EVM *gerektirmiyor*" diye yeniden yaz |
| R3 | **ERC-8004 dönüşü** — ASP kaydı ERC-8004 kimliği demek, proje bunu bilinçle sildi | Anlatı tutarsızlığı (kod tutarsızlığı değil) | README'de bir cümle: "protokol kimliğimiz HCS-14; OKX.AI listelemesi ayrı bir dizin kaydıdır" |
| R4 | **A2A isim çakışması** — OKX'in A2A'sı XMTP tabanlı, bizimki JSON-RPC/AgentCard | "Zaten A2A kullanıyoruz, direkt takılır" varsayımı yanlış çıkar, plan kayar | Planda A2MCP (HTTP) yolunu seç, OKX A2A'yı seçme |
| R5 | **`.env` yüzeyi büyür** — X Layer rayı için EVM özel anahtarı + OKX oturumu eklenir | Sızıntı yüzeyi artar; `.env` zaten `SELLER_/BUYER_PRIVATE_KEY` + `GROQ_API_KEY` + `DATA_ENCRYPTION_KEY` taşıyor | EVM tarafında **düz anahtar yerine Agentic Wallet (TEE)** kullan — `payment pay` yerine `pay-local` **kullanma**. `.gitignore` kontrolü zaten her oturum kuralı (CLAUDE.md) |
| R6 | **Testnet/mainnet karışması** — Kinora tamamen testnet; OKX ASP listelemesi gerçek USDT fiyatı istiyor | Demo verisiyle canlı listeleme yan yana gelirse yanıltıcı olur | ASP listelemesini X Layer **testnet** (1952) rayıyla eşleştir, ya da listelemeyi mainnet'e geçene kadar erteleme |
| R7 | **Facilitator bağımlılığı** — bugün blocky402, X Layer için OKX'in facilitator'ı gerekir | İki dış servise bağımlılık; biri düşerse o ray düşer | Rayların birbirinden bağımsız düşmesi zaten mimaride var (her kalem ayrı `accepts[]` girdisi) |
| R8 | **Kalıcı endpoint** — ASP kaydında endpoint on-chain ve kalıcı | Geçici URL ile kayıt kalıcı hata bırakır | Önce deploy, sonra kayıt. Sıralama tersine çevrilemez |

### Açık sorular (cevaplanmadan M/L stratejileri başlatılmamalı)

1. ~~**OKX'in x402 facilitator'ı üçüncü taraf satıcıları kabul ediyor mu, ve URL'i ne?**~~
   → **§9.1'de çözüldü.**
2. ~~**X Layer'da `exact` şeması hangi token'ı istiyor?**~~ → **§9.2'de çözüldü** (USDC değil, **USDT0**).
3. ~~**`@x402` ekosisteminde hazır bir EVM şema paketi var mı?**~~ → **§9.3'te çözüldü** (var, ama
   beklenenden farklı bir sonuçla).
4. ~~**Kullanıcının OKX cüzdan oturumu açık mı?**~~ → **§9.4'te çözüldü** (açık, ama fonsuz).
5. **OKX market-data HBAR/USDT çiftini veriyor mu?** CEX tarafında büyük ihtimalle evet,
   DEX tarafında hayır. Doğrulanmalı (bileşen 5 için tek gerekçe bu).
6. **Bu iş neyi hedefliyor?** ETHGlobal Lisbon submission'ı korunacak mı, yoksa proje
   OKX.AI Trading Hackathon gibi yeni bir hedefe mi taşınıyor? Cevap R2'yi ya önemsiz
   ya da kritik yapıyor. *(Not: kurulu `okx-activity` skill'i o hackathon'un yalnızca
   **Trading ASP** kabul ettiğini söylüyor — Kinora bir trading ajanı değil, yani
   o yarışmaya bu haliyle uygun görünmüyor.)*

---

## 7. Üç entegrasyon stratejisi

### S — Minimal · "Vitrin" · ~2-4 saat · Bileşen 6 (+5 dar)

**Kapsam:** kod değişikliği neredeyse sıfır.
- `docs/okx-tooling.md` — geliştirme akışında hangi OKX skill'inin ne için kullanıldığı
- İsteğe bağlı: `/earnings` ve `LiveNumbers` içinde ≈ USD gösterimi (bileşen 5, dar)

**Kazanç:** "OKX araçlarıyla geliştirildi" diyebilirsin, hiçbir riske girmezsin.
**Kaybı:** ürün olarak hiçbir şey değişmez. Bu bir entegrasyon değil, bir not.
**Ne zaman seçilir:** ETHGlobal submission'ı dondurmak istiyorsan.

### M — Orta · "İkinci ray" · ~1.5-3 gün · Bileşenler 4 + 3 (+6)

**Kapsam:** §4.1'in tamamı.
- `accepts[]` çoklu ray → X Layer `exact` kalemi
- `PaymentInstruction` çoklu seçenek + `settlement_rail` sütunu
- `recordCompletedSale` ray-farkında (explorer linki, HCS audit alanı)
- Alıcı tarafı OKX Agentic Wallet ile test: `onchainos payment quote/pay`
- Yeni `src/x402/xlayer.ts`; `src/x402/pay.ts`'e `preferNetwork`

**Kazanç:** **Anlatı gerçekten güçlenir** — "lisans pazaryeri zincirden bağımsız:
kimlik ve kanıt Hedera'da, para alıcının bulunduğu rayda." Herhangi bir OKX ajanı
Hedera hesabı açmadan lisans alabilir. Bu, projeye eklenen ilk *gerçek* yetenek.
**Riski:** R2 (No Solidity anlatısı), R7, ve 1-3 numaralı açık sorular. Ayrı branch şart.
**Ne zaman seçilir:** proje hackathon sonrası devam edecekse — en yüksek getiri/efor oranı bu.

### L — Kapsamlı · "OKX.AI'de listelenen ajan" · ~1-2 hafta · Bileşenler 3+4+6+7

**Kapsam:** M + üstüne
- Satıcı ajanın **public HTTPS deploy'u** (A2A sunucusu + x402 sunucusu + panel)
- `onchainos agent create --role asp` ile OKX.AI Marketplace listelemesi (A2MCP servisi)
- Alıcı ajanın EVM anahtarının Agentic Wallet TEE'sine taşınması (`.env`'den bir düz
  anahtar eksilir)
- İsteğe bağlı: OKX task marketplace'in A2A AgentCard'ın yanında **ikinci keşif yüzeyi**
  olarak eklenmesi (`docs/bounty-coverage.md:60`'ta UCP için verilen gerekçenin aynısı —
  çalışan bir keşfin üstüne ikinci bir keşif)

**Kazanç:** proje bir demo olmaktan çıkıp gerçekten *çağrılabilir* bir servise dönüşür.
**Riski:** R3, R6, R8 buraya toplanıyor — kalıcı endpoint, gerçek USDT fiyatı,
ERC-8004 kimliğiyle listelenme. Ayrıca deploy maliyeti ve bakım yükü.
**Ne zaman seçilir:** Kinora'yı yaşayan bir ürün olarak sürdürme kararı verilmişse.

---

## 8. Tavsiye

Açık soru 6'nın cevabı bilinmeden kesin öneri vermek doğru olmaz, ama iki senaryonun
her ikisi için de net bir yol var:

- **Submission korunacaksa → S**, ve M'yi `okx-xlayer-rail` branch'inde keşif olarak
  başlat. Ana dal dokunulmaz kalır.
- **Proje devam edecekse → M**, sonra L'ye kademeli geçiş. M tek başına savunulabilir
  bir bütün: yeni bir yetenek katıyor, mevcut hiçbir şeyi bozmuyor, ve L'nin ön koşulu
  zaten M değil *deploy* — ikisi paralel ilerleyebilir.

Her iki durumda da **bileşen 1 (X Layer contract) ve bileşen 2 (OKX Wallet) önerilmiyor**;
bunlar bu projeye zorlama olur ve ürünün kendi iddialarını zayıflatır.

---

## 9. Açık Soru Çözümleri

> Araştırma tarihi: 2026-08-12. Kaynaklar: `okx/payments` GitHub reposu (OKX'in resmî
> x402 SDK'sı), kurulu skill dosyaları, npm registry, ve makinedeki `onchainos` CLI (v4.4.9).
> **Bu bölüm §4.1'deki entegrasyon planını iki noktada düzeltiyor** — aşağıda işaretli.

### 9.0 Ana bulgu: **iki ayrı x402 paket ailesi var ve kesişimleri boş**

Araştırmanın en önemli sonucu, sorulardan hiçbirinin tek başına yakalayamadığı şey:
**`@x402/*` ile `@okxweb3/x402-*` aynı protokolün iki farklı implementasyonu.**

| | `@x402/*` (Kinora'nın kullandığı) | `@okxweb3/x402-*` (OKX'in satıcı SDK'sı) |
|---|---|---|
| Sahibi | Coinbase / x402-foundation (npm maintainer'ları `@coinbase.com`) | OKX (`github.com/okx/payments`) |
| Sürüm olgunluğu | `@x402/core@2.22.0` | `@okxweb3/x402-core@0.1.0`, `-evm@0.2.1`, `-express@0.1.1` |
| Hedera desteği | ✅ `@x402/hedera` | ❌ yok |
| X Layer desteği | ❌ varsayılan asset haritasında `eip155:196` **yok** | ✅ tek desteklenen ağ |
| Facilitator | `HTTPFacilitatorClient` (kimlik doğrulamasız, ör. blocky402) | `OKXFacilitatorClient` (OKX API kimlik bilgisi zorunlu) |

Coinbase'in `@x402/evm@2.22.0` paketinin derlenmiş bundle'ında bulunan ağlar:
`8453, 84532, 143, 4326, 988, 31611, 42161, 137, 50, 51, …` — **196 ve 1952 yok**.
Yani X Layer, Coinbase tarafında kasıtlı olarak dışarıda; OKX tarafında ise tek seçenek.

**Sonuç: Kinora iki rayı destekleyecekse iki paket ailesini yan yana kurmak zorunda.**
Tek bir `x402ResourceServer` örneğine hem Hedera hem X Layer şeması kaydetmek mümkün
değil — sınıflar farklı paketlerden geliyor ve facilitator client'ları uyumsuz.
Pratikte iki ayrı resource server, ya da OKX'in kendi `@okxweb3/payment-router`'ı ile
tek URL altında iki adaptör gerekir.

> ⚠️ **§4.1 düzeltmesi (1/2).** Plandaki
> `.register("eip155:196", new ExactEvmScheme())` satırı — mevcut `x402Server` örneğine
> eklenecek tek bir çağrı olarak yazılmıştı — **bu haliyle çalışmaz.** Doğrusu ayrı bir
> `x402ResourceServer` (OKX'in `@okxweb3/x402-core`'undan) + `OKXFacilitatorClient`.

### 9.1 Facilitator: üçüncü taraf satıcılar **kabul ediliyor**, ama OKX API anahtarı şart

**Cevap: evet, Kinora merchant olabilir.** OKX'in `typescript/SELLER.md` dosyası
(`github.com/okx/payments/blob/main/typescript/SELLER.md`) tam da bunun için yazılmış —
hedef kitlesi kendi ifadesiyle *"AI coding agents (Cursor, Claude Code, Copilot)"*,
kapsamı *"Seller (server) only"*. Yani OKX kendi barındırmadığı satıcıların entegre
olmasını açıkça bekliyor. Doküman ayrıca protokol seviyesinde
*"The x402 protocol doesn't require registration by design"* diyor.

**Ama facilitator kimlik doğrulamalı.** Ayrı bir "facilitator URL" yok; onun yerine
bir client sınıfı var:

```ts
new OKXFacilitatorClient({
  apiKey:     process.env.OKX_API_KEY,      // zorunlu
  secretKey:  process.env.OKX_SECRET_KEY,   // zorunlu — HMAC-SHA256 imzalama
  passphrase: process.env.OKX_PASSPHRASE,   // zorunlu
  baseUrl:    "https://web3.okx.com",       // varsayılan
  syncSettle: true,                          // on-chain onayı bekle
})
```

Settlement OKX'in **SA API**'si üzerinden brokerlanıyor (HMAC-SHA256 imzalı).
SELLER.md'nin "COMMON MISTAKES" tablosunda şu satır birebir duruyor:

> | Used `HTTPFacilitatorClient` | Always use `OKXFacilitatorClient` |

**Kinora bugün tam da o yanlış tarafta:** `src/x402/server.ts:69`
`new HTTPFacilitatorClient({ url: facilitatorUrl })` kullanıyor. Yani mevcut
facilitator client'ı bir OKX URL'ine yöneltmek **yetmez** — sınıfın kendisi değişmeli
ve OKX API kimlik bilgileri edinilmeli.

**Bunun `.env` üzerindeki bedeli (R5'i büyütüyor):** üç yeni sır — `OKX_API_KEY`,
`OKX_SECRET_KEY`, `OKX_PASSPHRASE`. Bunlar Agentic Wallet'ın TEE'siyle **korunmuyor**;
TEE alıcı tarafının imzalama anahtarını koruyor, satıcı tarafının API kimlik bilgilerini
değil. Yani "OKX kullanınca anahtar yönetimi düzelir" beklentisi yalnızca **alıcı**
tarafı için doğru.

**Satıcı SDK ailesi** (hepsi `@okxweb3/`): `x402-core`, `x402-evm`, `x402-express`,
`x402-hono`, `x402-fastify`, `x402-next`, `mpp`, `payment-router`.
Kinora Express kullandığı için `x402-express` doğrudan uyar.

**Kritik uyarı — `initialize()`.** OKX'in resource server'ı, sunucu ayağa kalktıktan
sonra ve ilk istek işlenmeden önce `await resourceServer.initialize()` çağrısı istiyor.
`src/x402/server.ts:309-319`'daki `startX402Server()` bunu yapmıyor; ikinci ray
eklenirse `app.listen` callback'i `async` olmalı.

### 9.2 X Layer token: **USDC değil, USDT0** — ve **testnet satıcı tarafında desteklenmiyor**

Otoritatif kaynak: `okx/payments` → `go/x402/mechanisms/evm/constants.go` içindeki
`NetworkConfigs` haritası.

| Ağ | chainId | Varsayılan asset | Kontrat | Ad (EIP-712 domain) | Version | Decimals |
|---|---|---|---|---|---|---|
| **X Layer mainnet** | `eip155:196` | **USDT0** | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | `USD₮0` (U+20AE) | `"1"` | **6** |
| **X Layer testnet** | `eip155:1952` | **USDT0** | `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` | `USD₮0` | `"1"` | **6** |

Ek teknik detaylar:
- Varsayılan transfer yöntemi **EIP-3009** (`transferWithAuthorization`) — gassız, alıcı
  tek bir yetkilendirme imzalıyor. EIP-3009 desteklemeyen token'lar için `extra:
  { assetTransferMethod: "permit2" }` alt modu var.
- Permit2 kullanılırsa alıcının bir kereliğine `IERC20.approve(PERMIT2, MAX_UINT256)`
  yapması gerekiyor; Permit2 adresi tüm EVM zincirlerinde aynı:
  `0x000000000022D473030F116dDEE9F6B43aC78BA3`.
- `@okxweb3/x402-*` ailesinde fiyat `"$0.01"` gibi USD string'i olarak yazılabiliyor
  (SDK decimals'a çeviriyor); `@okxweb3/mpp` ailesinde ise **base units** zorunlu
  (`"10000"` = 0.01). Karıştırmak SELLER.md'nin listelediği yaygın hatalardan.

> ⚠️ **§4.1 düzeltmesi (2/2) ve R6'nın sertleşmesi.** SELLER.md kapsamını iki kez,
> tartışmasız biçimde belirtiyor: *"X Layer (`eip155:196`) only"* ve
> *"Network: `eip155:196` (X Layer mainnet) — **no other networks**"*. Common-mistakes
> tablosunda da: *"Network other than `eip155:196` → Only X Layer is supported"*.
>
> **Yani `eip155:1952` (testnet) sabitler dosyasında tanımlı olsa da, satıcı SDK'sı
> onu desteklemiyor.** Kinora tamamen testnet üzerinde çalışan bir proje; X Layer rayını
> eklemek **gerçek parayla mainnet'te çalışmak** demek. Bu, R6'yı "dikkat edilmeli"
> seviyesinden **"M stratejisinin karakterini değiştiren"** seviyeye taşıyor:
> demo artık kısmen gerçek para hareket ettirir. Küçük tutarlarla ($0.01 mertebesi)
> yönetilebilir, ama bilinçli bir karar olmalı — kazara girilecek bir durum değil.

### 9.3 `@x402/evm` **var** — ama Kinora'nın işine yaramıyor

**Cevap: paket mevcut, elle şema yazmaya gerek yok** — ancak bu, beklenen kolaylığı
sağlamıyor.

`@x402/evm@2.22.0` yayında ve Kinora'nın kullandığı `@x402/core` / `@x402/hedera` ile
aynı sürüm hattında. Yapısı `@x402/hedera` ile birebir simetrik:

```
@x402/evm/exact/server   → ExactEvmScheme  (SchemeNetworkServer)
@x402/evm/exact/client   → ExactEvmScheme + registerExactEvmScheme
@x402/evm/upto/{client,server}, /v1, /batch-settlement, /auth-capture
Bağımlılıklar: viem ^2.48.11, zod ^3.24.2, @x402/core ~2.22.0
```

Client tarafı `eip155:*` joker kaydı destekliyor, server tarafında
`registerMoneyParser()` ile özel asset çözümü yapılabiliyor. Yani **teknik olarak**
X Layer'ı bu paketle de sürmek mümkün: `licenceQuote()` zaten açık `{asset, amount}`
döndürdüğü için varsayılan asset haritasının 196'yı içermemesi server tarafında engel
değil.

**Ama engel facilitator'da.** 196'yı destekleyen tek facilitator OKX'inki, o da
`OKXFacilitatorClient` istiyor (§9.1). Coinbase'in `HTTPFacilitatorClient`'ı ile
OKX facilitator'ına bağlanmak SELLER.md tarafından açıkça yanlış olarak işaretlenmiş.

**Pratik sonuç:**

| Yaklaşım | Uygulanabilir mi | Not |
|---|---|---|
| `@x402/evm` + kendi facilitator'ımız | ✅ teknik olarak | Kendi X Layer facilitator'ımızı çalıştırmak demek: RPC, sıcak cüzdan, gas yönetimi, nonce takibi. `okx/payments/go/x402/FACILITATOR.md` bunu ~300 satır referans implementasyon olarak tarif ediyor. **M stratejisinin kapsamını 2-3 katına çıkarır.** |
| `@x402/evm` + OKX facilitator'ı | ❌ | Client sınıfı uyumsuz |
| **`@okxweb3/x402-express` + `OKXFacilitatorClient`** | ✅ **önerilen** | OKX'in kendi yolu. Hedera rayı `@x402/*` ile ayrı kalır. |

**Efor tahmini güncellemesi:** açık soru 3'ün "elle yazılacaksa efor ikiye katlanır"
endişesi **gerçekleşmedi** — elle şema yazmak gerekmiyor. Ama yerine iki paket ailesini
yan yana çalıştırma karmaşıklığı geldi. **M stratejisinin ~1.5-3 gün tahmini
korunuyor**, dağılımı değişiyor: şema yazımı yerine iki sunucu/router kurgusu ve
mainnet konfigürasyonu.

Bir opsiyon daha var: OKX'in **`@okxweb3/payment-router`** paketi, tek URL altında
birden çok 402 lehçesini karşılamak için yazılmış (`MppAdapter`, `X402Adapter`,
`priority` ile otomatik tespit) ve `ProtocolAdapter` arayüzüyle **özel adaptör**
eklemeye açık. Hedera rayı teorik olarak buraya bir adaptör olarak takılabilir — zarif
ama denenmemiş bir yol; `0.1.0` sürümündeki bir pakete bel bağlamak demek.

### 9.4 Agentic Wallet oturumu: **açık, ama X Layer'da fonsuz**

`onchainos wallet status` (v4.4.9) çıktısı:

| Alan | Değer |
|---|---|
| `loggedIn` | ✅ `true` |
| `loginType` | `email` |
| `accountCount` | 1 (`Account 1`) |
| `policy` | Hiçbir limit tanımlı değil — `singleTxFlag`, `dailyTradeTxFlag`, `dailyTransferTxFlag` hepsi `false` |

`onchainos wallet addresses`: tek bir EVM adresi 30 zincire kayıtlı — içinde
**X Layer mainnet (`196`, `okb`)** ve **X Layer testnet (`1952`, `xlayer_test`)** ayrı
ayrı var. Ayrıca bir Solana adresi mevcut.

`onchainos wallet balance --chain xlayer`:

```json
{"ok":true,"data":{"details":[{"tokenAssets":[]}],"totalValueUsd":"0.00"}}
```

**Yani: TEE cüzdan kurulumu gerekmiyor — zaten hazır. Eksik olan tek şey fon.**

Kalan kurulum adımları:

1. **X Layer'a USDT0 köprüle veya yatır.** Alıcı ajanın ödeyeceği tutar + gas için OKB.
   Test için $1-2 mertebesi fazlasıyla yeterli (lisans fiyatları $0.01 altına ayarlanabilir).
   Adresi `onchainos wallet addresses` çıktısındaki `xlayer` girdisinden al.
2. **İşlem politikası tanımla (önerilir).** Şu an hiçbir limit yok; otonom bir ajanın
   imzalayacağı bir cüzdanda `singleTxLimit` ve `dailyTransferTxLimit` ayarlamak,
   Kinora'nın kendi `maxAmountTinybar` tavanının (`src/x402/pay.ts:206-215`)
   cüzdan seviyesindeki karşılığı olur. İki katmanlı savunma.
3. **Satıcı tarafı için OKX API kimlik bilgileri** (`OKX_API_KEY` / `OKX_SECRET_KEY` /
   `OKX_PASSPHRASE`) — §9.1. Bunlar cüzdan oturumundan **ayrı**; OKX hesabından
   üretilmeleri gerekiyor.
4. Permit2 alt modu seçilirse alıcı bir kereliğine `approve(PERMIT2, MAX_UINT256)`
   yapmalı. **Varsayılan EIP-3009 modunda bu adım yok** — sadelik için varsayılanda kalın.

> 🔒 Bu bölümde cüzdan adresi, hesap kimliği ve e-posta bilinçli olarak yazılmadı —
> `ANALYSIS.md` public bir repoda duruyor. Değerler `onchainos wallet addresses` ile
> her an okunabilir.

### 9.5 Çözümlerin stratejilere etkisi

| Strateji | Değişiklik |
|---|---|
| **S** | Etkilenmedi. Hâlâ ~2-4 saat, sıfır risk. |
| **M** | Tahmin (~1.5-3 gün) **korunuyor**, içeriği değişti: şema yazımı yok; yerine ikinci paket ailesi + `OKXFacilitatorClient` + `initialize()` kurgusu. **Karakteri değişti: artık mainnet ve gerçek para** (§9.2). Ön koşul: OKX API kimlik bilgileri + X Layer fonlaması. |
| **L** | Etkilenmedi; M'nin üzerine kurulmaya devam ediyor. ASP listelemesinin USDT fiyatlaması ile X Layer USDT0 rayı doğal olarak **aynı para birimine** oturuyor — bu, L'yi beklenenden tutarlı kılan bir yan bulgu. |

**Yeni risk — R9: SDK olgunluğu.** OKX satıcı paketleri `0.1.0` / `0.2.1` sürümlerinde.
Kinora'nın bugün kullandığı `@x402/core@2.16` ise `2.22`'ye kadar gelmiş bir hat.
Erken sürümlü bir SDK'ya ödeme yolunun yarısını bağlamak, breaking change riski demek.
Azaltma: Hedera rayını **birincil** tutmak, X Layer rayını ikinci/opsiyonel bırakmak —
zaten önerilen mimari bu, ama artık bunun bir gerekçesi daha var.

---

## 10. Testnet Yolu Araştırması

> Yöntem: `okx/payments` reposu shallow-clone edilip (19 MB, 4 dil implementasyonu)
> `sandbox|staging|testnet` için tam metin tarandı; minified bundle gürültüsü elenerek
> yalnızca kaynak ve doküman dosyaları değerlendirildi. Ayrıca OKX Payments dev-docs
> sayfaları ve X Layer geliştirici dokümanları kontrol edildi.

### 10.0 ⚠️ Önce düzeltme: §9.2'deki "mainnet-only" iddiam fazla genişti

§9.2'de *"OKX Payments satıcı SDK'sı yalnızca `eip155:196` destekliyor, testnet yok"*
demiştim. **Bu, dayandığı kaynak için doğru ama SDK'nın tamamı için yanlış.**

Kaynağım `typescript/SELLER.md`'ydi ve o dosya gerçekten kapsamını üç kez
"X Layer mainnet only" diye sınırlıyor. Ama aynı repodaki **`go/x402/SELLER.md`**
bambaşka bir tablo veriyor:

| Chain | Network ID | Token | Decimals | Transfer |
|---|---|---|---|---|
| X Layer | `eip155:196` | USD₮0 | 6 | EIP-3009 |
| Base | `eip155:8453` | USDC | 6 | EIP-3009 |
| **Base Sepolia** | **`eip155:84532`** | **USDC** | 6 | EIP-3009 |
| MegaETH | `eip155:4326` | USDM | 18 | Permit2 |
| Monad | `eip155:143` | USDC | 6 | EIP-3009 |
| **Mezo Testnet** | **`eip155:31611`** | **mUSD** | 18 | Permit2 |
| Stable | `eip155:988` | USDT0 | 6 | EIP-3009 |

Altında da şu cümle: *"Use `eip155:*` wildcard to support all EVM chains."*

**Doğru ifade şu:** "X Layer mainnet only" bir **doküman kapsamı** kararı —
TypeScript rehberi OKX'in kendi brokerladığı yolu anlatmak için yazılmış. Protokol
ve SDK seviyesinde testnet birinci sınıf vatandaş; iki testnet zaten belgeli.
`go/x402/README.md` de aynı listeyi tekrarlıyor.

**X Layer testnet (1952) ise ilginç bir ara durumda:** `constants.go`'da tam bir
`NetworkConfig` kaydı var (USDT0 `0x9e29b3aa…`, 6 decimals), ama **hiçbir
"Supported Networks" tablosunda listelenmiyor.** Yani kodda var, dokümante değil.

### 10.1 Soru 1 — Sandbox/testnet modu var mı?

**Cevap: evet, var — ama URL'i public değil.**

Repo taramasının kanıtları:

**(a) Facilitator URL'i her dilde override edilebilir, ve yorumlar bunu açıkça
"sandbox/test" için diye etiketliyor:**

- `rust/mpp/src/sa_client.rs:83` — *"Or with custom base URL (for sandbox/testing)"*,
  `OkxSaApiClient::with_base_url(...)`
- `rust/mpp/src/sa_client.rs:125` — *"Create with custom base URL (for testing/sandbox)"*
- `rust/x402/SELLER.md:229-240` — *"By default the SDK targets `https://web3.okx.com`.
  To point at a different facilitator (e.g., a **private staging instance**), use the
  `with_url` constructor"*
- TypeScript'te aynı kapı: `OKXConfig.baseUrl` (§9.1'deki imza)

**(b) OKX'in kendi test altyapısında iki ayrı non-prod ortam adı geçiyor:**

- `rust/mpp/tests/sandbox.rs` — `MPP_SA_SANDBOX_URL` / `_KEY` / `_SECRET` /
  `_PASSPHRASE` env değişkenleriyle çalışan, varsayılan olarak `#[ignore]`'lu
  "SA API sandbox integration tests"
- `java/…/RealFacilitatorIT.java:59-62` — `OKX_FACILITATOR_BASE_URL`, yorumu birebir:
  *"Non-production facilitator URL (**no auth required for typical setups**).
  Read from the environment so we never bake an internal URL into source."*

Yani **kimlik doğrulaması bile gerektirmeyen bir non-prod facilitator var**, ama
adresi bilinçli olarak kaynağa gömülmemiş.

**(c) Go SDK facilitator seçimini üç yollu bir tercih olarak sunuyor**
(`go/x402/SERVER.md:722-745`):

```go
// Testnet
URL: "https://x402.org/facilitator"
// Mainnet (Coinbase CDP)
URL: "https://api.cdp.coinbase.com"
// Self-Hosted
URL: "https://your-facilitator.example.com"
```

Hatta koddaki varsayılan bile OKX'in kendisi değil:
`go/x402/http/facilitator_client.go:63` → `DefaultFacilitatorURL = "https://x402.org/facilitator"`
(Python'da da aynı: `http/constants.py:15`).

**(d) OKX Payments dev-docs sayfalarında testnet/sandbox bölümü yok.**
`x402-introduction`, `core-concept`, `service-seller` sayfalarının hiçbiri testnet'ten
söz etmiyor — dokümantasyon tamamen mainnet anlatısı üzerine kurulu.

**Sonuç:**

| İddia | Durum |
|---|---|
| OKX facilitator'ının public bir testnet/sandbox URL'i var mı? | ❌ **Hayır** — hiçbir yerde yayınlanmamış |
| OKX'in içeride bir sandbox'ı var mı? | ✅ **Evet** — `MPP_SA_SANDBOX_*`, `OKX_FACILITATOR_BASE_URL` |
| SDK mimari olarak testnet'e kapalı mı? | ❌ **Hayır** — her dilde baseUrl override var, Go'da 2 testnet belgeli |
| "Mainnet-only" ne tür bir kısıt? | **Erişim/dokümantasyon kısıtı**, mimari kısıt değil |

**Aksiyon:** Bu, "imkânsız" değil "**OKX'e sorulacak**" bir madde. Talep net:
*"X Layer testnet (1952) veya Base Sepolia için `OKX_FACILITATOR_BASE_URL` alabilir
miyiz?"* Java testinin yorumuna göre böyle bir uçta muhtemelen API anahtarı bile
gerekmiyor. Cevap gelene kadar aşağıdaki A/B/C seçenekleri geçerli.

### 10.2 Soru 2 — X Layer testnet'te kendi facilitator'ımızı işletmek

**Somut gereksinim listesi:**

**1. Ağ ve RPC**

| | Değer |
|---|---|
| Chain ID | `1952` (`0x7a0`), CAIP-2: `eip155:1952` |
| RPC | `https://testrpc.xlayer.tech/terigon` |
| Limit | IP başına **100 istek/saniye** (mainnet ve testnet aynı) |
| Gas token | **OKB** (testnet OKB) |
| Mimari | Polygon CDK tabanlı zkEVM L2, Ethereum'a settle ediyor |

**2. Gas kaynağı — faucet var**

`https://web3.okx.com/xlayer/faucet` → "Get OKB from X Layer testnet".
**Kullanıcı başına günde 0.2 OKB.** Facilitator'ın sıcak cüzdanı gas'ı buradan
karşılar. Bir demo için fazlasıyla yeterli; sürekli çalışan bir servis için günlük
tavan sıkıntı olabilir.

**3. Üç HTTP ucu** (`go/x402/FACILITATOR.md`)

```
GET  /supported  → {"kinds":[{"x402Version":2,"scheme":"exact","network":"eip155:1952"}]}
POST /verify     → {"isValid":bool,"invalidReason":string}
POST /settle     → {"success":bool,"transaction":"0x…","network":…,"payer":"0x…"}
```

**4. Facilitator signer — dokuz metot**

`GetAddresses`, `ReadContract`, `VerifyTypedData`, `WriteContract`, `SendTransaction`,
`WaitForTransactionReceipt`, `GetBalance`, `GetChainID`, `GetCode`.
Arkasında: RPC bağlantısı, **nonce takibi**, gas tahmini, işlem gönderimi, onay
bekleme (polling), hata sınıflandırma (nonce hatası / düşük gas → retry).

FACILITATOR.md bunu *"~300 satır referans implementasyon"* olarak tarif ediyor
(`e2e/facilitators/go/main.go`) ve ekliyor: *"Coming Soon: Facilitator signer helpers
will reduce this to ~10 lines."* — yani şu an yardımcılar **yok**.

> 💡 Kinora TypeScript olduğu için Go referansını birebir yazmak gerekmiyor:
> `@x402/evm/exact/facilitator` alt yolu mevcut (§9.3'te paket yapısında görüldü).
> Yani iş, signer'ı `viem` ile besleyip üç ucu Express'e bağlamaya iniyor —
> Go'daki 300 satırdan daha kısa, ama yine de yeni ve test edilmemiş bir servis.

**5. Testnet'te AYNEN geçerli olan kısımlar** (mainnet'e özel değil)

- Protokolün tamamı: 402 → `payment-required` → imza → `payment-signature` → 200
- EIP-3009 `transferWithAuthorization` / EIP-712 imza doğrulama mantığı
- Üç ucun şeması ve `SchemeNetworkFacilitator` arayüzü
- Permit2 (`0x0000…22D473030F116dDEE9F6B43aC78BA3`) ve Multicall3
  (`0xcA11bde05977b3631167028862bE2a173976CA11`) — CREATE2 ile **tüm EVM
  zincirlerinde aynı adres**
- Hook'lar (`OnBeforeSettle`, `OnAfterSettle`, …) ve hata kurtarma desenleri

**6. Yalnızca mainnet'e özel olan kısımlar** (demo'da atlanabilir)

- OKX SA API brokerliği ve `OKXFacilitatorClient` (zaten kullanmıyoruz bu yolda)
- FACILITATOR.md'nin "Production Considerations" başlığının tamamı: HSM/KMS anahtar
  saklama, EIP-1559 gas stratejisi, çoklu replika + load balancer, rate limiting,
  fraud detection, metrik/alarm altyapısı, düşük bakiye uyarıları
- Solana'ya özgü `SettlementCache` (duplicate settlement) — EVM'de konu dışı

**7. 🚨 Yol kesen risk: testnet USDT0'ı nasıl bulacağız?**

Faucet **OKB veriyor — gas token**. Ama alıcının ödeyeceği varlık
**USDT0 `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`**. İki şey doğrulanmadı:

1. O kontrat testnet'te gerçekten **`transferWithAuthorization` (EIP-3009)
   implement ediyor mu?** `constants.go` öyle varsayıyor ama bu bir yapılandırma
   kaydı, kanıt değil.
2. Testnet USDT0 **nereden alınacak?** Faucet listesinde yok. Köprüleme
   (Sepolia → X Layer testnet) tek seçenek olabilir, ya da hiç yolu olmayabilir.

**Bu doğrulanmadan C seçeneğine başlanmamalı** — facilitator'ı yazıp sonra ödeyecek
token bulamamak, işin tamamını çöpe atar. Doğrulama maliyeti düşük: RPC'ye bir
`eth_call` ile kontratın `transferWithAuthorization` selector'ını sorgulamak
(~15 dakika).

**Efor:** ~2-4 gün · **Risk: YÜKSEK** (token engeli çözülmezse sıfıra düşen iş)

### 10.3 Ara seçenek — Base Sepolia (X Layer değil, ama en temiz testnet)

Araştırma sırasında çıkan, sorulmamış ama en pürüzsüz yol:

- **`eip155:84532`**, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, 6 decimals, EIP-3009
- **Kinora'nın hâlihazırda kullandığı `@x402/evm` paketinde zaten tanımlı** (bundle
  taramasında `eip155:84532` mevcut — X Layer'ın aksine)
- **Public facilitator var:** `https://x402.org/facilitator` — kayıt yok, API anahtarı
  yok, x402 dokümantasyonunun kendi ifadesiyle *"convenient for development"*,
  testnet için tasarlanmış
- **Faucet net:** `https://faucet.circle.com/` (Circle'ın resmî USDC musluğu)
- OKX'in Go SDK'sı da bu ağı resmen destekliyor (10.0'daki tablo)

**Yani: kendi facilitator'ımızı işletmeye gerek yok, token bulma sorunu yok,
gerçek para yok, yeni paket ailesi yok.** İkinci ray gerçekten çalışır.

**Bedeli:** OKX açısı neredeyse tamamen kaybolur. `onchainos wallet addresses`
çıktısında **Base Sepolia adresi yok** — cüzdanın sahip olduğu tek testnet adresi
`xlayer_test` (1952). Yani alıcı ajan OKX Agentic Wallet **olamaz**; ayrı bir EVM
anahtarı gerekir ve TEE avantajı da gider. Bu seçenek "ikinci ödeme rayı"nı kanıtlar,
"OKX entegrasyonu"nu değil.

**Efor:** ~1-1.5 gün · **Risk: DÜŞÜK**

### 10.4 Soru 3 — Settlement'sız Agentic Wallet demosu ✅ **en iyi getiri/risk oranı**

**Cevap: evet, mümkün — ve düşündüğünden daha güçlü bir biçimde.**

Anahtar, OKX CLI'nin **iki fazlı** ödeme akışı. `onchainos payment quote <url>`
komutu (skill'in Path A adım A2'si) şunları yapıp **durur**:

> *"The CLI probes the endpoint, parses the 402, checks your wallet balance, ranks
> candidates, and writes a `paymentId`."*

Yani: uca gider, 402'yi alır, `accepts[]`'i çözer, cüzdan bakiyesini kontrol eder,
adayları sıralar — **hiçbir şey imzalamaz, hiçbir şey göndermez.** Ödeme ancak
ayrı bir `payment pay --payment-id … --yes` çağrısıyla olur ve skill bunun önüne
atlanamaz bir onay kapısı koyuyor (*"You MUST stop and confirm before paying —
do not auto-pay"*).

**Kinora'da nereye takılır:**

Lisans ucu 402 cevabına ikinci bir `accepts[]` kalemi ekler
(`eip155:1952` veya `196`, USDT0, `quotePrice`'ın USD karşılığı). Başka hiçbir şey
değişmez — Hedera rayı gerçekten ödeme alan taraf olarak kalır. Sonra demoda:

```
onchainos payment quote http://<kinora>/licence/grant?...&licenceId=42
```

OKX'in kendi CLI'si bizim 402'mizi parse edip ağ / token / tutar / alıcı adresini
ekrana basar. **Bu bir mock değil** — gerçek protokol birlikte çalışabilirliği:
OKX'in aracı, bizim sunucumuzun ürettiği x402 cevabını okuyor.

**Anlatı olarak da dürüst duruyor:** *"Lisans ucu iki rayda fiyat veriyor. Hedera
rayı bu demoda gerçekten settle ediyor; X Layer rayı OKX Agentic Wallet tarafından
okunabiliyor ve fiyatlanabiliyor — settlement mainnet facilitator'ı gerektirdiği
için demoda tetiklenmiyor."*

**Yanında bedavaya gelen okuma-yazma-etmeyen komutlar:**
`onchainos wallet balance --chain xlayer` (alıcının ödeme gücü),
`onchainos wallet addresses`, güvenlik taraması ile `payTo` adresinin kontrolü.

**Değişecek dosyalar:** `src/x402/config.ts` (X Layer sabitleri),
`src/x402/server.ts:99-113` (`accepts` → dizi), `src/a2a/seller-executor.ts:177-207`
(ikinci `PaymentInstruction` seçeneği), panel metni.
**Facilitator yok, EVM signer yok, yeni paket ailesi yok, `.env`'e sır eklenmiyor.**

**⚠️ Doğrulanması gereken tek teknik nokta:** `x402ResourceServer`, kendisine şeması
kayıtlı **olmayan** bir ağı `accepts[]`'te ilan etmeyi kabul eder mi? Etmezse
`@x402/evm`'in `ExactEvmScheme`'i yalnızca *ilan* için kaydedilir (settle asla
çağrılmaz). Yarım saatlik bir deneme sorusu.

**⚠️ Dürüstlük şartı — bu maddeyi hafife alma.** Ödenemeyecek bir kalemi 402'de ilan
etmek, protokol seviyesinde **yanlış beyandır**: o kalemi seçen bir alıcı ajan imza
atar, settle olmaz, parası ya da zamanı gider. Demo bağlamında ve açıkça
etiketlendiğinde savunulabilir; **ASP olarak listelenmiş, herkese açık bir uçta
kabul edilemez.** Uygulanırsa ya `X402_DEMO_MODE` gibi bir bayrağın arkasında
tutulmalı, ya da kalem gerçekten ödenebilir hale getirilmeli (B veya C).

**Efor:** ~3-5 saat · **Risk: DÜŞÜK** (yukarıdaki dürüstlük şartına uyulursa)

### 10.5 Seçeneklerin karşılaştırması

| | Seçenek | Ağ | Facilitator | Gerçek para | OKX açısı | Efor | Risk |
|---|---|---|---|---|---|---|---|
| **A** | Quote seviyesi demo (§10.4) | 196 / 1952 (ilan) | yok | ❌ | ✅ güçlü | **3-5 saat** | düşük |
| **B** | Base Sepolia gerçek ray (§10.3) | `84532` | public x402.org | ❌ | ⚠️ zayıf | 1-1.5 gün | düşük |
| **C** | X Layer testnet + kendi facilitator (§10.2) | `1952` | kendimiz | ❌ | ✅ güçlü | 2-4 gün | **yüksek** |
| **D** | X Layer mainnet + OKX facilitator (§9'daki M) | `196` | OKX | ✅ **evet** | ✅ tam | 1.5-3 gün | orta |
| **E** | OKX'ten sandbox URL iste (§10.1) | ? | OKX non-prod | ❌ | ✅ tam | 0 geliştirme | belirsiz süre |

### 10.6 Öneri

**A + E paralel.** A'yı hemen yap (yarım gün, hiçbir riske girmeden OKX araçları
gerçekten Kinora'nın 402'siyle konuşuyor); aynı anda E'yi başlat (OKX'e non-prod
facilitator URL'i sor — Java testinin yorumuna bakılırsa kimlik doğrulaması bile
gerekmeyebilir). E'den olumlu cevap gelirse A doğrudan çalışan bir raya terfi eder
ve C'nin 2-4 günlük facilitator işi tamamen gereksizleşir.

**C'ye girmeden önce mutlaka §10.2'deki 7. maddeyi doğrula** (testnet USDT0 var mı,
EIP-3009 destekliyor mu) — 15 dakikalık bir kontrol, 2-4 günlük işi kurtarır ya da iptal eder.

**B'yi yalnızca "ikinci rayın gerçekten çalıştığını" kanıtlamak öncelikliyse seç;**
OKX entegrasyonu anlatısı aranıyorsa B yanlış kapı.

**D (§9'daki M) hâlâ geçerli ama artık tek testnet seçeneği değil** — 10.0'daki
düzeltme sayesinde "ya mainnet ya hiç" ikilemi ortadan kalktı.

---

## 11. X Layer Testnet USDT0 — EIP-3009 Doğrulaması

**Soru:** `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` (OKX'in `constants.go`'da X Layer
testnet varsayılan varlığı olarak ilan ettiği USDT0) gerçekten EIP-3009
`transferWithAuthorization` implement ediyor mu?

# ✅ EVET — implement ediyor.

Dahası, OKX'in ilan ettiği EIP-712 domain'i (`name: "USD₮0"`, `version: "1"`)
zincirdeki `DOMAIN_SEPARATOR()` ile **bit bit örtüşüyor.** Yani yalnızca "fonksiyon
var" değil, "**bu konfigürasyonla üretilen imzalar zincirde doğrulanır**".

> ⚠️ **Metodolojik uyarı — dikkatin haklıydı ve tarif edilen adım dizisi tek başına
> yanlış cevap verirdi.** Token adresindeki bytecode bir **ERC-1967 proxy** (1.528 bayt)
> ve içinde `0xe3ee160e` selector'ı **YOK**. Adım 2'de durulsaydı sonuç yanlışlıkla
> "HAYIR" çıkardı. Selector, proxy'nin işaret ettiği **implementation** kontratında
> (14.659 bayt). Polygon UChildUSDT0 örneğinin gösterdiği "zincir zincir doğrula"
> ilkesi burada "**katman katman doğrula**" olarak da geçerliymiş.

### 11.1 Zincir ve kontrat kimliği

```
$ curl -s -X POST https://testrpc.xlayer.tech/terigon \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
{"jsonrpc":"2.0","result":"0x7a0","id":1}                    # 0x7a0 = 1952 ✓

$ ... "method":"eth_blockNumber"
{"jsonrpc":"2.0","result":"0x2451312","id":1}                # canlı zincir
```

### 11.2 Adım 1-2 — `eth_getCode`: proxy katmanı (selector YOK)

```
$ ... "method":"eth_getCode",
      "params":["0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c","latest"]

{"jsonrpc":"2.0","result":"0x608060405261000c61000e565b005b7f000000000000000000000000
78fe5db026a0eae44cae40be6a7d6e50ba5ec5ee73ffffffffffffffffffffffffffffffffffffffff163303
6100d1575f357fffffffff000000000000000000000000000000000000000000000000000000001674f1ef286
...","id":1}
```

| Kontrol | Sonuç |
|---|---|
| Bytecode uzunluğu | 1.528 bayt |
| `e3ee160e` proxy içinde | ❌ **YOK** |
| `4f1ef286` (`upgradeToAndCall`) | ✅ var → **proxy** |
| ERC-1967 slot sabiti gömülü | ✅ var |

**Proxy hedefi (ERC-1967 implementation slot):**

```
$ ... "method":"eth_getStorageAt","params":[
      "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc","latest"]
{"jsonrpc":"2.0","result":"0x00000000000000000000000073406f06efcbfabd8437196abd8a213b26452510","id":1}
```

→ **implementation = `0x73406f06efcbfabd8437196abd8a213b26452510`**
(admin slot → `0x78fe5db026a0eae44cae40be6a7d6e50ba5ec5ee`)

### 11.3 Implementation bytecode'unda selector taraması

Selector'lar ezberden alınmadı; yerel bir keccak-256 implementasyonu ile hesaplandı
(boş girdi self-test'i `c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470`
ile doğrulandı).

`eth_getCode(0x73406f06…)` → **14.659 bayt**. Tarama sonucu:

| Selector | Fonksiyon | Durum |
|---|---|---|
| `0xe3ee160e` | `transferWithAuthorization(…,uint8,bytes32,bytes32)` — **v,r,s** | ✅ **FOUND** |
| `0xcf092995` | `transferWithAuthorization(…,bytes)` — bytes imza | ✅ **FOUND** |
| `0xef55bec6` | `receiveWithAuthorization(…,uint8,bytes32,bytes32)` | ✅ FOUND |
| `0x88b7ab63` | `receiveWithAuthorization(…,bytes)` | ✅ FOUND |
| `0x5a049a70` | `cancelAuthorization(address,bytes32,uint8,bytes32,bytes32)` | ✅ FOUND |
| `0xe94a0102` | `authorizationState(address,bytes32)` | ✅ FOUND |
| `0x3644e515` | `DOMAIN_SEPARATOR()` | ✅ FOUND |
| `0xd505accf` | `permit(...)` — EIP-2612 bonus | ✅ FOUND |
| `0x54fd4d50` | `version()` | ❌ yok (getter yok — §11.5) |

**EIP-3009'un tamamı mevcut, hem v,r,s hem bytes varyantıyla.** Bu önemli: OKX'in
`constants.go`'su iki ABI de tanımlıyor (`TransferWithAuthorizationVRSABI` varsayılan,
`…BytesABI` akıllı cüzdanlar için) — **kontrat ikisini de karşılıyor.**

### 11.4 Adım 3 — canlı `eth_call` doğrulaması (bytecode değil, davranış)

```
$ ... eth_call {"to":"0x9e29b3aa…","data":"0x06fdde03"}    # name()
{"result":"0x…0020…0007 555344e282ae30 00…"}               → "USD₮0"  (7 bayt, U+20AE)

$ ... "data":"0x95d89b41"                                   # symbol()
{"result":"0x…0007 555344e282ae30 …"}                       → "USD₮0"

$ ... "data":"0x313ce567"                                   # decimals()
{"result":"0x…0006"}                                        → 6 ✓

$ ... "data":"0x3644e515"                                   # DOMAIN_SEPARATOR()
{"result":"0xd2406dc8a5f31c1f65263669534de22dea0363db6ca41e1094e98442907ff982"}

$ ... "data":"0x18160ddd"                                   # totalSupply()
{"result":"0x0de0b6b3a7640000"}                             → 1e18 raw = 1.000.000.000.000 USD₮0

$ ... "data":"0xe94a0102" + pad(0x01) + pad(0xdead)         # authorizationState(...)
{"result":"0x00…00"}                                        → false
```

`authorizationState` **revert etmeden `false` döndürüyor** — fonksiyon yalnızca
bytecode'da değil, çağrılabilir ve çalışıyor.

### 11.5 Kesin kanıt — EIP-712 domain yeniden üretimi

`version()` getter'ı yok, dolayısıyla OKX'in `Version: "1"` iddiası doğrudan
okunamıyor. Bunun yerine domain separator **yeniden hesaplandı** ve zincirdekiyle
karşılaştırıldı:

```
DOMAIN_SEPARATOR = keccak256(abi.encode(
    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
    keccak256(name), keccak256(version), chainId, verifyingContract))
```

18 aday kombinasyon denendi (name: `USD₮0` / `USDT0` ascii · version: `"1"` / `"2"` /
domain'de version yok · verifyingContract: proxy / implementation):

```
*** MATCH ***  d2406dc8…907ff982   name="USD₮0"  version="1"  chainId=1952  verifying=PROXY
               91192353…689388ae   name="USD₮0"  version="1"  chainId=1952  verifying=impl
               95db42eb…20afcf4a   name="USD₮0"  version="2"  chainId=1952  verifying=proxy
               de406257…c0c14752   name="USD₮0"  (version yok) chainId=1952 verifying=proxy
               f8371b23…643850c1   name="USDT0" (ascii) version="1" … verifying=proxy
               … (kalan 13 aday eşleşmedi)

on-chain DOMAIN_SEPARATOR: d2406dc8a5f31c1f65263669534de22dea0363db6ca41e1094e98442907ff982
```

**Tek eşleşme, OKX'in `constants.go` kaydının birebir kendisi:**

| Alan | OKX `constants.go` | Zincirden doğrulanan |
|---|---|---|
| `Address` | `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` | ✅ aynı (verifyingContract = proxy) |
| `Name` | `USD₮0` (`"USD₮0"`) | ✅ `name()` ve domain hash'i doğruluyor |
| `Version` | `"1"` | ✅ domain yeniden üretimiyle kanıtlandı |
| `Decimals` | `6` | ✅ `decimals()` = 6 |
| Transfer yöntemi | EIP-3009 (varsayılan) | ✅ v,r,s + bytes varyantları mevcut |

`verifyingContract` **proxy adresi** (implementation değil) — imzalayan taraf için
doğru davranış, ve OKX'in konfigürasyonunun işaret ettiği adres de bu.

### 11.6 §10.2'nin 7. maddesi üzerindeki etkisi

§10.2'de C seçeneğini (X Layer testnet + kendi facilitator'ımız) bloke eden iki
belirsizlik vardı:

| Belirsizlik | Durum |
|---|---|
| 1. Kontrat EIP-3009 implement ediyor mu? | ✅ **ÇÖZÜLDÜ — evet**, üstelik domain'i de doğru |
| 2. Testnet USDT0 nereden bulunacak? | ⚠️ **HÂLÂ AÇIK** |

**İkinci madde hâlâ tek engel.** X Layer testnet faucet'i (`web3.okx.com/xlayer/faucet`)
sayfa metninde *"OKB, USDG, and more on X Layer testnet"* diyor — **USDT0 adı
geçmiyor**. Zincirde 1 trilyon USD₮0 basılmış durumda (`totalSupply` = 1e18 raw),
yani token mevcut ve dağıtılabilir; sorun bize nasıl ulaşacağı.

Kalan üç yol, maliyet sırasına göre:
1. Faucet'i cüzdanla açıp gerçek claim listesini görmek (~5 dk) — sayfa dinamik
   olduğu için metinden okunamadı, tarayıcıda bakmak gerekiyor.
2. `USDG` yeterli mi diye bakmak: faucet USDG veriyorsa ve OKX SDK'sına asset
   olarak USDG verilebiliyorsa (`price: { asset, amount }` açıkça destekleniyor),
   USDT0 hiç gerekmeyebilir — **ama USDG'nin EIP-3009 desteği de aynı yöntemle
   ayrıca doğrulanmalı.**
3. Admin/mint yetkisi `0x78fe5db0…`'de — bize kapalı.

**Sonuç: C seçeneğinin teknik riski belirgin biçimde düştü** (protokol tarafı temiz
çıktı), ama tedarik riski duruyor. §10.6'daki öneri değişmiyor: **A + E paralel**,
C'ye ancak faucet'te ödenebilir bir varlık bulunursa girilir.

### 11.7 Yeniden üretim

Bu bölümdeki her sonuç tek bir komutla tekrar edilebilir:

```bash
RPC=https://testrpc.xlayer.tech/terigon
T=0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c
IMPL_SLOT=0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc

# implementation adresi
curl -s -X POST $RPC -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getStorageAt\",\"params\":[\"$T\",\"$IMPL_SLOT\",\"latest\"]}"

# implementation bytecode'unda selector
curl -s -X POST $RPC -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["0x73406f06efcbfabd8437196abd8a213b26452510","latest"]}' \
  | grep -c e3ee160e     # 1 = var

# domain separator
curl -s -X POST $RPC -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$T\",\"data\":\"0x3644e515\"},\"latest\"]}"
# beklenen: 0xd2406dc8a5f31c1f65263669534de22dea0363db6ca41e1094e98442907ff982
```
