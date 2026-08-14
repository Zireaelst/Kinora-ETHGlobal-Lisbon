# OKX entegrasyonu — saha bulguları

X Layer ödeme rayını kurarken karşılaşılan, çoğu dokümantasyonda yazmayan şeyler.
Hepsi 13–14 Ağustos 2026'da, `onchainos` CLI v4.4.9 ile ve X Layer testnet
(`eip155:1952`) üzerinde doğrulandı. İddiaların yanında onları üreten komut var.

İlgili analiz: [`../ANALYSIS.md`](../ANALYSIS.md) §9–12.

---

## 1. OKX tarafındaki bulgular

### 1.1 🔴 Mock merchant yanlış EIP-712 `version` ilan ediyor

OKX'in resmî testnet mock merchant'ı:

```
$ curl -s https://www.okx.com/api/v1/pay/mock-merchant/resource
{"accepts":[{"scheme":"exact","network":"eip155:1952",
  "asset":"0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d",
  "extra":{"version":"1","name":"USDC_TEST"}}, …]}
```

Kontrat aynı fikirde değil ve imzayı doğrulayan kontrat:

```
$ eth_call USDC_TEST version()            → "2"
$ eth_call USDC_TEST DOMAIN_SEPARATOR()   → 0x7513e76c…baef959
```

O domain separator yalnızca `version="2"` ile yeniden üretilebiliyor
(`name="USDC_TEST"`, `chainId=1952`, `verifyingContract=<token>`); `"1"` ile
`0x9d05c77b…` çıkıyor. **Version `"1"` altında atılan bir imza farklı digest
üretir ve `transferWithAuthorization` onu reddeder.**

İki olasılık: mock merchant hatalı, ya da facilitator `extra.version`'ı yok sayıp
kontratın gerçek separator'ını okuyor — ki bu hatayı maskeler. Biz zincirin
doğruladığı değeri yayınlıyoruz (`src/x402/config.ts` → `XLAYER_USDC_TEST`) ve
`X402_XLAYER_EIP712_VERSION` ile geçersiz kılınabilir bıraktık.

> Not: aynı yöntemle USD₮0 (`0x9e29b3aa…`) da doğrulandı ve **onun** için OKX'in
> Go SDK'sının ilan ettiği `name="USD₮0"`, `version="1"` değerleri doğru çıktı.
> Yani sorun genel bir hata değil, bu token'a özgü.

### 1.2 🔴 CLI'nin varsayılan yapılandırmasında base URL eksik

Birkaç alt komut, `--base-url` verilmeden anlamsız bir hatayla düşüyor:

```
$ onchainos wallet chains
  → 0 zincir

$ onchainos wallet add
$ onchainos wallet balance --chain 1952
  → {"ok":false,"error":"request failed: builder error: relative URL without a base"}
```

`--base-url https://web3.okx.com` eklenince hepsi çalışıyor: 32 zincir listeleniyor
(`1952 / xlayer_test / XLayer Testnet` dahil), bakiye görünüyor, hesap açılıyor.

Hata mesajı temel sebebi göstermiyor — "relative URL without a base" bir HTTP
istemcisi hatası, eksik yapılandırma değil gibi okunuyor.

### 1.3 🟡 `payment quote` X Layer'ı aday olarak sıralamıyor

`--base-url` verilse bile:

```
$ onchainos payment quote --base-url https://web3.okx.com "<402 veren url>"
  accepts[]   : [0] exact/hedera:testnet 41000000
                [1] exact/eip155:1952   114800   ← okundu
  candidates  : yalnizca [0]
  walletError : balance_unavailable
  summary     : "Will pay 41 0.0.0 (exact, hedera:testnet)"
```

Yani CLI `accepts[]`'in **ikisini de doğru çözüyor** ama X Layer kalemini
ödenebilir aday saymıyor. Aynı anda `wallet balance --chain 1952 --base-url …`
bakiyeyi buluyor (10 USDC_TEST), dolayısıyla `balance_unavailable` quote'un kendi
ön kontrol yolundan geliyor.

**Çözüm:** `--selected-index` doğrudan `accepts[]` indeksini alıyor, aday
listesinden bağımsız. `--selected-index 1` ile ödeme sorunsuz geçti.

Yan etki: CLI varsayılan olarak ödeyemeyeceği rayı (Hedera — OKX cüzdanının
Hedera adresi yok) öneriyor.

### 1.4 🟡 Hedera tutarı yanlış ölçekleniyor

Yukarıdaki çıktıda `41000000` tinybar (= **0.41 ℏ**) `amountHuman: "41"` olarak
gösteriliyor. CLI 6 decimal varsayıyor; HBAR 8 decimal (tinybar = 10⁻⁸ ℏ). Yalnızca
görüntüleme hatası — ödeme X Layer'dan yapıldığı için tutarı etkilemedi — ama
kullanıcıya 100× yanlış bir rakam gösteriyor.

### 1.5 🟡 `wallet add` aktif hesabı sessizce değiştiriyor

`onchainos wallet add` yeni hesabı oluşturup **aktif hesabı ona çeviriyor**, hiçbir
uyarı vermeden. Fonlar eski hesapta kaldığı için sonraki ödeme boş cüzdandan
denenir. `wallet switch <accountId>` ile geri dönmek gerekiyor.

Ayrıca hesap **silme komutu yok** — yanlışlıkla açılan bir hesap kalıcı.

### 1.6 ✅ Doğru çıkan: testnet gerçekten destekleniyor

Erken analizde (ANALYSIS.md §9.2) "OKX Payments mainnet-only" sonucuna varmıştık;
**yanlıştı.** `typescript/SELLER.md`'deki "X Layer only — no other networks" ifadesi
"Base/Solana değil" demek istiyor, "testnet değil" değil. Kanıt: mock merchant
`eip155:1952` üzerinde canlı 402 döndürüyor ve `/supported` şunu listeliyor:

```
exact / eip155:196     aggr_deferred / eip155:196   upto / eip155:196   period / eip155:196
exact / eip155:1952    aggr_deferred / eip155:1952  upto / eip155:1952
```

Bu, planlanan ~2-4 günlük "kendi facilitator'ımızı yaz" işini tamamen gereksiz kıldı.

---

## 2. Kendi kodumuzda ortaya çıkan hatalar

İkinci ray eklenirken bulunan, X Layer'a özgü olmayan ama onun sayesinde görünen
sorunlar.

### 2.1 Boş env değişkeni varsayılanı eziyordu

`process.env.X ?? fallback` yalnızca `undefined`'ı yakalıyor; dotenv boş bir `X=`
satırını `""` yapıyor. `.env.example`'da listelenip doldurulmayan her opsiyonel
değişken kendi varsayılanını sessizce eziyordu.

X Layer rayının lisansı **1 base unit** (0.000001 USDC_TEST) fiyatlamasıyla ortaya
çıktı: `HBAR_USD_RATE=` → `Number("")` = 0 → fiyat 0 → tabana düştü. Aynı desen altı
yerde daha vardı — `WEB_PORT=` port 0'a bağlanır, `DATA_DB_PATH=` `""` adlı veritabanı
açar, `POLICY_STATEMENT=` ajanı politikasız bırakır.

Düzeltme: `src/env.ts` (`envString` / `envOr` / `envNumber`), boş ve yalnızca-boşluk
değerleri yok sayıyor.

### 2.2 Opsiyonel ray, zorunlu rayı düşürüyordu

Hatalı bir OKX passphrase'i lisans ucunun **tamamını** HTTP 500 yapıyordu. Sebep:
`x402HTTPResourceServer.initialize()` her `accepts[]` kalemini facilitator'ların
`/supported` çıktısına karşı doğruluyor ve doğrulayamadığı rotayı hiç sunmuyor —
yani opsiyonel X Layer rayı çalışan Hedera rayını da götürüyordu.

Düzeltme: facilitator'a önden sorulur, cevap veremezse ray uyarıyla düşürülür,
Hedera ayakta kalır.

> Bunun yan sonucu mimari bir ders: **ödenemeyecek bir rayı ilan etmek mümkün
> değil.** "Quote seviyesinde göster, ödeme sonra" diye planlanan ucuz seçenek
> (ANALYSIS.md §10.4) var olamazdı; dürüstlük şartı kütüphaneye gömülü.

### 2.3 Sertifika, ödeyene gidiyordu — ödeyen Hedera hesabı değilse yanlış yere

Sertifika NFT'si settlement'ın `payer` alanına mint ediliyordu. Hedera rayında doğru;
X Layer rayında `payer` bir EVM adresi ve **Hedera bunu hata olarak görmüyor** — o
adrese takma-ad'lı yepyeni bir hesap otomatik oluşturup NFT'yi oraya gönderiyor.

Lisans #4'ün sertifikası böylece bir saniye önce var olmayan `0.0.10062920`'ye gitti;
kayıtlı alıcı `0.0.10062841` boş kaldı ve `create-licence-token.ts`'in kurduğu
association boşa gitti. Hiçbir hata verilmedi — lisans yalnızca onu pazarlıkla alan
kimlikten koptu.

Düzeltme: `payer` yalnızca gerçekten `0.0.x` formatındaysa kullanılıyor; değilse
sertifika alıcının UAID'sinin işaret ettiği hesaba gidiyor.

### 2.4 HTS koleksiyon oluşturma azami ücreti aşıyordu

`create-licence-token.ts` sıfırdan kurulan bir ortamda `INSUFFICIENT_TX_FEE` veriyordu:
custom royalty'li NFT koleksiyonu oluşturmak sıradan bir işlemden çok daha pahalı ve
istemcinin varsayılan tavanı yetmiyor. Yalnızca ilk kurulumda görülüyor — yani
karşılaştırılacak çalışan bir ortamın olmadığı anda.

Düzeltme: `.setMaxTransactionFee(new Hbar(50))`. Tavan fiyat değil; Hedera gerçek
ücreti (birkaç ℏ) alıyor.

### 2.5 `.gitignore` yalnızca tam `.env` eşleşmesi yapıyordu

`.env` düzenlemeden önce alınan zaman damgalı bir yedek (`.env.backup-1786614683`)
içindeki tüm sırlarla birlikte **ignore edilmiyordu** ve `git status`'ta zararsız
görünüyordu. Aynı açık `.env.local` ve editör artıklarını (`.env.save`) da kapsıyor.

Düzeltme: `.env.*` ignore, `!.env.example` geri alınıyor.

### 2.6 Hedera kimlik hataları özel anahtarı terminale basıyor

`BUYER_ACCOUNT_ID` alanına yapıştırılmış bir özel anahtar SDK'dan şunu üretiyor:

```
failed to parse entity id: 302e020100300506032b657004220420cba7…
```

Yani teşhis gömülü *ve* özel anahtar terminale, oradan scrollback'e / CI loglarına /
ekran paylaşımına düşüyor. Ayrıca `AccountId.fromString` bir EVM adresini takma ad
olarak kabul ettiği için `SELLER_ACCOUNT_ID=0x7d2a…` "geçerli" görünüp projenin geri
kalanının kastettiğinden **farklı bir hesabı** işaret ediyordu.

Düzeltme: `npm run check:env` alanı ve hatayı adlandırıyor, değeri asla basmıyor.

---

## 3. Doğrulanmış uçtan uca akış

```
OKX Agentic Wallet  ──payment pay --selected-index 1──►  Kinora x402 ucu
                                                              │
        X Layer testnet: 0.1148 USDC_TEST  alici ──► satici   │
                                                              ▼
                                              sifresi cozulmus masterRef (HTTP 200)
                                                              │
                          Hedera'da, ayni islemin devami:     ▼
                          HCS denetim kaydi  ·  HCS itibar  ·  HTS sertifika NFT
```

Son doğrulanan çalıştırma (lisans #5):

| Adım | Kanıt |
|---|---|
| X Layer ödemesi | tx `0x07095b35b89fff65d15d24ac0958b4fe5c9031e9bb3f4a97440d71f3d96af285` |
| Bakiye hareketi | alıcı −0.1148, satıcı +0.1148 USDC_TEST (zincirden `balanceOf`) |
| Lisans teslimi | HTTP 200 + `masterRef` |
| HCS denetim | topic `0.0.10062827`, seq 2 |
| HCS itibar | topic `0.0.10062828`, feedback #5 |
| HTS sertifika | token `0.0.10062876` seri 2 → `0.0.10062841` (kayıtlı alıcı) |

Ortam kaynakları bu çalışma sırasında sıfırdan oluşturuldu; `frontend/src/lib/chain.ts`
hâlâ orijinal hackathon ortamının id'lerini gösteriyor ve **güncellenmesi gerekiyor.**

---

## 4. Bildirmeye değer

OKX'e iletilecek olsa öncelik sırası: **1.1** (yanlış EIP-712 version — sessiz imza
reddine yol açar), **1.2** (eksik base URL — CLI'yi kullanılamaz gösteriyor),
**1.3** (quote X Layer'ı sıralamıyor), sonra 1.4 ve 1.5.
