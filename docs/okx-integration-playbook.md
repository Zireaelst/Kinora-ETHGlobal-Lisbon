# OKX.AI entegrasyon playbook'u — başka bir projeye taşınabilir

Bu dosya Kinora'ya OKX stack'ini entegre ederken çıkarılan derslerin damıtılmış
hali. Amacı: **yeni bir repoda sıfırdan başlayan bir oturumun aynı bedelleri
tekrar ödememesi.** Bileşen listesi zaten halka açık; buradaki değer, listede
yazmayan kısımlar — yanlış çıkan varsayımlar, doğrulama yöntemleri ve geri
alınamaz adımların sırası.

Kaynak proje: müzik lisans pazaryeri, Hedera üzerine kurulu, OKX'in x402 rayı
ikinci ödeme yolu olarak eklendi ve OKX.AI'ye ASP olarak kaydedildi.

---

## 1. Yeni oturuma verilecek analiz promptu

Yeni repoda açtığın Claude'a bunu olduğu gibi yapıştır. Orijinal promptun
üzerine, bizi yanlış yola sokan şeyleri engelleyen maddeler eklendi.

```
Bu repoyu derinlemesine incele. Amacım: OKX.AI ekosistemindeki bileşenlerden
bu projeye UYGUN olanları entegre etmek. Şu an sadece analiz yap, kod yazma.

## OKX.AI'de entegre/deploy edilebilecek bileşenler

1. X Layer — OKX'in L2 zinciri (eip155:196 mainnet, 1952 testnet), contract
   deploy hedefi, gas-free işlem.
2. OKX Wallet — insan kullanıcı için cüzdan, WalletConnect uyumlu, 60+ zincir.
3. Agentic Wallet — AI ajanı için TEE korumalı cüzdan, CLI/MCP ile natural
   language işlem, risk simülasyonu.
4. Onchain OS — DEX aggregation (500+ DEX), Analyze (gerçek zamanlı onchain
   veri), Payments (x402 / Agent Payments Protocol), DApp Connect.
5. Agent Trade Kit — CEX tarafı, @okx_ai/okx-trade-mcp + -cli, 82 araç
   (market data auth'suz, spot/futures, grid/DCA bot, earn, sinyaller).
6. Hazır skill dosyaları — github.com/okx/onchainos-skills, drop-in.
7. OKX.AI Marketplace / ASP — projeyi Agent Service Provider olarak kaydetme.

## Yapman gerekenler

1. Projenin mevcut mimarisini özetle: stack, ana modüller, mevcut
   cüzdan/chain/ödeme entegrasyonları.
2. Projenin doğasını tanımla (trading/DeFi mi, tamamen başka bir alan mı).
3. Yedi bileşeni TEK TEK değerlendir. Zorla entegrasyon önerme — "bu proje
   için X anlamsız çünkü ..." tamamen geçerli bir sonuçtur ve tercih edilir.
4. Uygun bulduklarını dosya/modül bazında somutla: hangi dosya değişir, ne
   eklenir.
5. Mevcut cüzdan/imza/işlem kodunu listele: hangisi OKX ile değişir, hangisi
   yan yana çalışır.
6. Riskleri ve açık soruları yaz (API key yönetimi, testnet/mainnet, mevcut
   sponsor entegrasyonlarıyla çakışma, .env güvenliği).
7. 2-3 strateji öner (minimal / orta / kapsamlı), her biri için efor ve kapsam.

## DOĞRULAMA KURALLARI — bunlara uy, yoksa analiz yanlış çıkar

- **Tek bir dokümanın kapsam ifadesinden genel sonuç çıkarma.** OKX'in
  TypeScript SELLER.md'si "X Layer only — no other networks" diyor; bu
  "Base/Solana değil" demek, "testnet değil" DEĞİL. Aynı repodaki Go
  SELLER.md testnet'leri açıkça listeliyor. En az iki dil implementasyonunu
  karşılaştır.
- **Zincir üstü iddiaları zincirden doğrula, dokümandan değil.** Token
  desteği, decimals, EIP-712 domain — hepsi eth_call ile teyit edilir.
- **Proxy katmanını atlama.** Token adresinde eth_getCode selector bulamayabilir;
  ERC-1967 implementation slotunu okuyup oradaki bytecode'a bak.
- **Mevcut ortamın çalıştığını varsayma.** .env'deki değerler yanlış hesaba
  ait olabilir; anahtardan hesabı türetip mirror node ile karşılaştır.
- Emin olmadığın her şeyi "açık soru" olarak yaz; tahminle doldurma.

Raporu ANALYSIS.md olarak repo köküne kaydet. Kod değişikliği yapma.
Bitince özeti 5-6 cümleyle söyle.
```

---

## 2. Bileşen bileşen: gerçekte ne çıktı

Kinora için verilen kararlar. Kendi projen farklı olabilir ama **gerekçeler**
taşınabilir.

| # | Bileşen | Karar | Neden |
|---|---|---|---|
| 1 | X Layer contract deploy | ❌ | Projenin deploy edecek contract'ı yoktu; "EVM'siz" olmak bir satış argümanıydı |
| 2 | OKX Wallet | ❌ | Ürünün tezi "insan onayı yok" — connect butonu bunu görsel olarak yalanlar |
| 3 | Agentic Wallet | ✅ alıcı tarafı | Hedera'yı imzalayamaz; EVM rayında alıcı ajanın TEE cüzdanı oldu |
| 4a | Onchain OS — Payments (x402) | ✅ **en iyi eşleşme** | Aynı tel protokolü; `accepts[]` dizisi ikinci rayı doğal kılıyor |
| 4b | Onchain OS — DEX/Analyze/DApp | ❌ | Swap/likidite/lending projeyle ilgisiz |
| 5 | Agent Trade Kit | ❌ | CEX trading tamamen yabancı; tek istisna auth'suz fiyat verisi (kozmetik) |
| 6 | Skill dosyaları | ✅ zaten kurulu | `~/.claude/skills/okx-*`, sıfır kod |
| 7 | ASP listeleme | ✅ şartlı | Public HTTPS + USDT fiyat + kalıcı endpoint gerekiyor |

**Genel kural:** OKX'in *trading/piyasa* tarafı yalnızca trading projelerine
uyar. *Ajan altyapısı* tarafı (ödeme protokolü, ajan cüzdanı, pazaryeri) çok
daha geniş bir yelpazeye uyar — ama zincir uyumu şart.

---

## 3. Doğrulanmış sabitler — yeniden türetme

Hepsi zincirden/CLI'den teyit edildi. Kopyala, tekrar araştırma.

### X Layer

| | Değer |
|---|---|
| Mainnet | `eip155:196`, gas token OKB |
| Testnet | `eip155:1952`, RPC `https://testrpc.xlayer.tech/terigon` (100 istek/sn) |
| Testnet faucet | `https://www.okx.com/xlayer/faucet/xlayerfaucet` — OKB + stablecoin |
| Explorer | `https://www.oklink.com/xlayer-test/tx/<hash>` |

### Testnet token'ları (ikisi de zincirden doğrulandı)

| Token | Adres | Decimals | EIP-712 domain |
|---|---|---|---|
| **USDC_TEST** | `0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d` | 6 | `name="USDC_TEST"`, `version="2"` |
| USD₮0 | `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` | 6 | `name="USD₮0"`, `version="1"` |

⚠️ **OKX'in mock merchant'ı USDC_TEST için `version:"1"` ilan ediyor; kontrat
`"2"` diyor ve DOMAIN_SEPARATOR `"2"` ile üretiliyor.** Yanlış version altında
atılan imza zincirde reddedilir. Kontrata güven, dokümana değil.

### OKX facilitator (satıcı tarafı)

```
GET  /api/v6/pay/x402/supported
POST /api/v6/pay/x402/verify     {x402Version:2, paymentPayload, paymentRequirements}
POST /api/v6/pay/x402/settle     + syncSettle
baseUrl: https://web3.okx.com
auth: OK-ACCESS-KEY / -SIGN / -TIMESTAMP / -PASSPHRASE
      SIGN = base64(HMAC-SHA256(timestamp + method + path + body, secretKey))
```

API anahtarı: `https://web3.okx.com/onchainos/dev-portal`.
Desteklenen: `exact`/`upto`/`aggr_deferred`/`period` × `eip155:196` **ve**
`eip155:1952`. Mock merchant: `https://www.okx.com/api/v1/pay/mock-merchant/resource`.

### İki ayrı paket ailesi — karıştırma

| | `@x402/*` | `@okxweb3/x402-*` |
|---|---|---|
| Sahibi | Coinbase / x402-foundation | OKX |
| Sürüm | 2.x (olgun) | 0.1–0.2 (erken) |
| Hedera | ✅ `@x402/hedera` | ❌ |
| X Layer | ❌ varsayılan asset haritasında yok | ✅ tek ağ |
| Facilitator | `HTTPFacilitatorClient` (auth'suz) | `OKXFacilitatorClient` (HMAC) |

Kinora'da çözüm: `@x402/*` kalsın, OKX facilitator'ı **elle** yazıldı (~180
satır, `node:crypto` dışında bağımlılık yok). Sebep: `HTTPFacilitatorClient`'ın
`createAuthHeaders` hook'u argümansız çağrılıyor, OKX ise gövdeyi de imzalıyor.

---

## 4. Tuzaklar — zaman kaybettirenler, pahalıdan ucuza

1. **Ödenemeyecek bir rayı ilan edemezsin.** `x402HTTPResourceServer.initialize()`
   her `accepts[]` kalemini kayıtlı şemalara *ve* facilitator'ın `/supported`
   çıktısına karşı doğrular; tutmazsa sunucu hiç başlamaz. "Önce quote göster,
   ödemeyi sonra ekle" diye bir plan yapma — mümkün değil.
2. **Opsiyonel ray zorunlu rayı düşürür.** Yukarıdaki doğrulama tüm rotayı
   reddediyor. Facilitator'a önden sor, cevap veremezse rayı düşür.
3. **CLI'de `--base-url https://web3.okx.com` şart.** Onsuz `wallet chains`,
   `wallet balance`, `wallet add`, `agent *` komutları
   `relative URL without a base` veriyor.
4. **`payment quote` X Layer'ı aday listesine almıyor** (`balance_unavailable`),
   ama `payment pay --selected-index <n>` doğrudan `accepts[]` indeksiyle çalışıyor.
5. **`wallet add` aktif hesabı sessizce değiştirir** ve silme komutu yoktur.
6. **CLI Hedera tinybar'ı 6 decimal sanıyor** — 0.41 ℏ, "41" görünüyor.
7. **`okx-a2a` Node ≥ 22.14.0 istiyor.** ASP aktifleştirme buna takılır.
   `brew install node@22` (keg-only, mevcut kurulumu bozmaz).
8. **Boş env değişkeni varsayılanı ezer.** `process.env.X ?? default` yalnızca
   `undefined` yakalar; dotenv boş satırı `""` yapar. `Number("")` = 0 →
   fiyat sıfıra çöker. Boş/whitespace'i "tanımsız" sayan bir yardımcı yaz.
9. **Barındırılan LLM modeli kararlı bağımlılık değil.** Groq
   `llama-3.3-70b-versatile`'ı kaldırdı, politika ayrıştırma tamamen durdu.
   Model adını env'den geçersiz kılınabilir yap.
10. **Ödeyen ≠ alıcı.** Çapraz zincir ödemede `payer` bir EVM adresi olur;
    Hedera'da NFT transferi buna takma-ad'lı **yeni hesap açar** ve sertifika
    oraya gider, hata vermeden. Ödeyeni yalnızca gerçekten yerel hesapsa kullan.
11. **`.gitignore`'da `.env` tek başına yetmez.** `.env.backup-*`, `.env.local`,
    `.env.save` yakalanmaz. `.env.*` + `!.env.example` yaz.

---

## 5. Doğrulama tarifleri

### Token EIP-3009 destekliyor mu (kopyala-çalıştır)

```bash
RPC=https://testrpc.xlayer.tech/terigon
T=<token adresi>
# 1) proxy mi?
curl -s -X POST $RPC -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getStorageAt\",\"params\":[\"$T\",\"0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc\",\"latest\"]}"
# sonuç sıfır değilse implementation adresi budur, selector'ı ORADA ara

# 2) fonksiyonel test — revert etmiyorsa EIP-3009 canlı
curl -s -X POST $RPC -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$T\",\"data\":\"0xe94a0102$(printf '%064x' 1)$(printf '%064x' 57005)\"},\"latest\"]}"

# 3) domain: name() 0x06fdde03, version() 0x54fd4d50, DOMAIN_SEPARATOR() 0x3644e515
```

Sonra `DOMAIN_SEPARATOR`'ı yerel keccak ile yeniden üret:
`keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256(name), keccak256(version), chainId, proxyAddress))`
— eşleşen kombinasyon doğru domain'dir. `version()` getter'ı yoksa tek yol budur.

### Selector'lar

| Selector | Fonksiyon |
|---|---|
| `0xe3ee160e` | `transferWithAuthorization(...,uint8,bytes32,bytes32)` — v,r,s |
| `0xcf092995` | `transferWithAuthorization(...,bytes)` |
| `0xe94a0102` | `authorizationState(address,bytes32)` |
| `0x3644e515` | `DOMAIN_SEPARATOR()` |

---

## 6. Entegrasyon deseni: ikinci ödeme rayı

Mevcut bir x402 satıcısına OKX rayı eklemenin şekli:

1. **Sabitler** — ağ, asset adresi, decimals, EIP-712 domain (doğrulanmış).
2. **Facilitator istemcisi** — `FacilitatorClient` arayüzü 3 metot:
   `getSupported` / `verify` / `settle`. OKX auth'u HMAC.
3. **Çoklu facilitator** — `new x402ResourceServer([hederaFac, okxFac])`.
4. **`accepts[]` dizisi** — her ray bir kalem; `extra: {name, version}` şart.
5. **Ön kontrol** — açılışta `getSupported()` çağır, cevap yoksa rayı düşür.
6. **Bayrak** — varsayılan kapalı; payee + kimlik bilgisi eksikse açılma.
7. **Ödeme sonrası** — hangi rayın ödediğini kaydet; explorer linki raya göre.

Alıcı tarafı test: `onchainos payment quote <url> --base-url https://web3.okx.com`
→ `onchainos payment pay --payment-id <id> --selected-index <n> --yes`.

---

## 7. Deploy + ASP listeleme sırası (geri alınamaz adımlar işaretli)

1. Servisi public HTTPS'e al. Railway'de `.railway.internal` **public değildir** —
   Settings → Networking → Public Networking → Generate Domain.
2. **Kalıcı disk (volume) ekle**, sonra veritabanı yolunu ona bağla. Yoksa her
   deploy veriyi siler.
3. Dışarıdan doğrula: agent card public URL mü ilan ediyor, ücretli uç
   pazarlıksız reddediyor mu, uçtan uca bir işlem geçiyor mu.
4. `agent pre-check --role asp` → kimlik alanları → avatar (**≤1 MB**,
   PNG/JPEG/WebP, link kabul edilmez) → servis → `validate-listing`.
5. 🔒 **`agent create`** — kimlik zincire yazılır.
6. 🔒 **`agent activate`** — endpoint **kalıcı** yazılır. Kendi alan adına
   geçecekseniz ÖNCE onu ayarlayın.

⚠️ **Listeleme doğrulayıcısı, servis açıklamasında geçen `a2a` kelimesini
"yanlış servis tipi" sanıp blokluyor** — endpoint yolunuz `/a2a/...` ise
yeniden adlandırın. Yanlış pozitif ama tartışılamıyor.

⚠️ Ücret: pazaryeri tek sabit sayı ister. Uç kendi x402 ücretini alıyorsa
listede `0` (ya da düşük bir vitrin rakamı) yazın — yoksa çift ücretlendirme.

---

## 8. Faydalı komutlar

```bash
# ortam
onchainos preflight --skill-version <skill sürümü>
okx-a2a doctor [--fix]

# cüzdan (hepsinde --base-url https://web3.okx.com)
onchainos wallet status | addresses | chains
onchainos wallet balance --chain 1952 --force

# kimlik
onchainos agent get-my-agents
onchainos agent get-agents --agent-ids <N>
onchainos agent search --query "<cümle>"
onchainos agent activate --agent-id <N> --preferred-language tr-TR

# ödeme
onchainos payment quote <url>
onchainos payment pay --payment-id <id> --selected-index <n> --yes
```

---

## 9. Referanslar

- OKX x402 SDK kaynağı: `github.com/okx/payments` — `typescript/SELLER.md`
  (X Layer mainnet odaklı) ve `go/x402/SELLER.md` (ağ tablosu, testnet'ler dahil)
- Skill dosyaları: `github.com/okx/onchainos-skills`
- Onchain OS docs: `web3.okx.com/onchainos/dev-docs/payments/`
- Bu projedeki detaylı bulgular: [`okx-findings.md`](okx-findings.md)
- Karar geçmişi ve düzeltmeler: [`../ANALYSIS.md`](../ANALYSIS.md) §9-12
