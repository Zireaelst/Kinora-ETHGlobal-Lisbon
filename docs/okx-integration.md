# OKX.AI entegrasyonu — ne yapıldı, nerede duruyor

Kinora'ya OKX ekosisteminden eklenen her şey, tek yerde. Kararların *neden* öyle
alındığı [`../ANALYSIS.md`](../ANALYSIS.md)'de; yol boyunca çıkan hatalar
[`okx-findings.md`](okx-findings.md)'de.

---

## Kimlik ve listeleme

| | |
|---|---|
| **Ajan** | Kinora Music — **#11036** |
| **Rol** | Satıcı (ASP), ERC-8004 kimliği, XLayer üzerinde |
| **Kayıt işlemi** | [`0x829308643ccbcf012118a716592475318230c345e98d8983464b5b456d097edc`](https://www.oklink.com/xlayer/tx/0x829308643ccbcf012118a716592475318230c345e98d8983464b5b456d097edc) |
| **Sahip cüzdan** | `0xe93f1546c2082e9cb278b9a7d3ded3bb562ea36d` (OKX Agentic Wallet, Account 1) |
| **Durum** | Kayıtlı; aktifleştirme `okx-a2a` ortamı hazır olunca yapılacak (Node ≥ 22.14.0 gerekiyor) |

**Listelenen servis:** Fractional Music Licensing · API servisi · 0.1 USDT ·
endpoint `https://kinora-ethglobal-lisbon-production.up.railway.app/negotiate/jsonrpc`

> Endpoint yolu `/a2a/jsonrpc` değil `/negotiate/jsonrpc` — çünkü OKX'in listeleme
> doğrulayıcısı URL içindeki `a2a` kelimesini "yanlış servis tipi ilan edilmiş"
> sanıp listelemeyi blokluyor. Yanlış pozitif; protokol değişmedi, yalnızca
> JSON-RPC'nin bağlandığı adres taşındı.

## Canlı servis

`https://kinora-ethglobal-lisbon-production.up.railway.app`

| Yol | Ne yapar |
|---|---|
| `/negotiate/jsonrpc` | A2A pazarlık ucu — dışarıdan bir ajanın giriş noktası |
| `/.well-known/agent-card.json` | Ajan kartı, keşif için |
| `/licence/grant` | x402 korumalı lisans ucu; pazarlıksız istek 403 |
| `/catalog` | Ücretsiz katalog |
| `/` · `/api/*` | Demo paneli |
| `/healthz` | Sağlık kontrolü |

Üçü tek portta çalışıyor (`src/prod-server.ts`) çünkü Railway servis başına tek
port veriyor; yolları çakışmadığı için mümkün. Kurulum:
[`deploy-railway.md`](deploy-railway.md).

## İkinci ödeme rayı — X Layer

Lisans ucu aynı lisansı **iki zincirde birden** fiyatlıyor. HBAR'ı olmayan bir
alıcı ajan da lisans alabilsin diye:

```
<- HTTP 402
   asking 0.246 ℏ    (24600000 tinybar, asset 0.0.0)        to 0.0.9695366  on hedera:testnet
   asking 0.0006888 ℏ (68880 base unit, asset 0xcb8bf24c…)  to 0xff7d4f3c…  on eip155:1952
```

**Yalnızca para yer değiştiriyor.** Kimlik (HCS-14 UAID), denetim kaydı (HCS) ve
royalty'li sertifika (HTS) Hedera'da kalıyor — sertifika da ödeyene değil,
alıcının UAID'sinin işaret ettiği hesaba gidiyor.

| | |
|---|---|
| Ağ | X Layer testnet (`eip155:1952`) |
| Varlık | USDC_TEST `0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d`, 6 ondalık, EIP-3009 |
| EIP-712 domain | `name="USDC_TEST"`, `version="2"` — zincirden doğrulandı, OKX'in mock merchant'ı `"1"` diyor ([findings §1.1](okx-findings.md)) |
| Facilitator | OKX (`src/x402/okx-facilitator.ts`, yeni bağımlılık yok) |
| Bayrak | `X402_XLAYER_RAIL=on` — varsayılan kapalı |

Kanıtlanmış alım: OKX Agentic Wallet lisans #5'i X Layer'dan ödedi —
[`0x07095b35…d96af285`](https://www.oklink.com/xlayer-test/tx/0x07095b35b89fff65d15d24ac0958b4fe5c9031e9bb3f4a97440d71f3d96af285),
0.1148 USDC_TEST alıcıdan satıcıya, karşılığında şifresi çözülmüş master referansı.

## Eklenen dosyalar

| Dosya | Ne için |
|---|---|
| `src/x402/okx-facilitator.ts` | OKX facilitator istemcisi (HMAC-SHA256, `/verify` `/settle` `/supported`) |
| `src/prod-server.ts` | Üç servisi tek porta bindiren üretim girişi |
| `src/startup-check.ts` | Eksik/bozuk konfigürasyonu açılışta tek seferde raporlar |
| `src/env.ts` | Boş env değişkenini "tanımsız" sayar (`envString`/`envOr`/`envNumber`) |
| `scripts/check-okx.ts` | `npm run check:okx` — OKX kimlik bilgilerini tek başına test eder |
| `scripts/check-env.ts` | `npm run check:env` — Hedera kimliklerini sır basmadan doğrular |
| `scripts/xlayer-demo.ts` | `npm run demo:xlayer` — ödenebilir bir lisans üretip sunucuyu açık tutar |
| `railway.json`, `.nvmrc` | Deploy yapılandırması |

## Ortam kaynakları

| | |
|---|---|
| Satıcı hesabı | [`0.0.9695366`](https://hashscan.io/testnet/account/0.0.9695366) |
| Alıcı hesabı | [`0.0.10062841`](https://hashscan.io/testnet/account/0.0.10062841) |
| HCS denetim topic | [`0.0.10062827`](https://hashscan.io/testnet/topic/0.0.10062827) |
| HCS kimlik topic | [`0.0.10062828`](https://hashscan.io/testnet/topic/0.0.10062828) |
| HTS sertifika koleksiyonu | [`0.0.10062876`](https://hashscan.io/testnet/token/0.0.10062876) — %5 royalty |
| X Layer satıcı adresi | `0xff7d4f3ca688851c17fabf22970e06b8a8dd98dc` (Agentic Wallet, Account 2) |

## Açık kalanlar

**Volume yok.** `DATA_DB_PATH` bir kalıcı diske bağlı değil, yani her redeploy
katalogu ve lisans geçmişini siliyor. Şu ana kadar üç kez yeniden seed edildi.
Ajan aktifleştirildikten sonra bu, dışarıdan gelen gerçek alıcıların
`unknown_track` alması demek. `⌘K` → volume → `/data`, sonra
`DATA_DB_PATH=/data/catalogue.db`.

**Aktifleştirme bekliyor.** `okx-a2a` Node ≥ 22.14.0 istiyor; makinede 22.13.1
var. `brew install node@22` sonrası `okx-a2a doctor --fix` ile açılıyor.

**Kalıcı endpoint.** Kayıtlı URL Railway'in ürettiği alan adına bağlı. Kendi
alan adına geçilecekse ayrı bir güncelleme işlemi gerekiyor.
