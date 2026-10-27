# pi-codebuddy

Plugin provider CodeBuddy AI untuk [Pi](https://github.com/earendil-works/pi) / [Pi-Bolt](https://github.com/opensec-git/Pi-Bolt).

Mengintegrasikan model coding unggulan dari **Tencent CodeBuddy** (baik edisi International `codebuddy.ai` maupun China `copilot.tencent.com`) langsung ke dalam CLI Pi dengan autentikasi browser OAuth, streaming SSE asli, pelacakan kuota/billing, dan dukungan multi-akun.

Referensi arsitektur diadaptasi dari:
- [9router / codebuddy-intl.js](https://github.com/decolua/9router/blob/master/open-sse/executors/codebuddy-intl.js) (request transformation, SSE reasoning, frequency limit error parser 6004).
- [pi-antigravity](https://github.com/Rahularya01/pi-antigravity) (pola ekstensi Pi AI, custom `streamSimple`, multi-akun dengan failover otomatis, commands, dan diagnostik doctor).

---

## Fitur Utama

- **Model Lengkap**: Akses langsung ke lini model CodeBuddy:
  - **GLM**: `glm-5.2`, `glm-5.1`, `glm-5.3`, `glm-5.3-flash`, `glm-5.0`, `glm-5.0-turbo`, `glm-4.7`
  - **MiniMax**: `minimax-m3` (1M context), `minimax-m2.7`
  - **Kimi**: `kimi-k3-1`, `kimi-k2.8-preview`, `kimi-k2.7`, `kimi-k2.6`, `kimi-k2.5`
  - **DeepSeek**: `deepseek-v4-pro`, `deepseek-v4.1-flash`, `deepseek-v3-2-volc`
  - **Hunyuan**: `hy3`, `hy3-preview`, `hy4-preview`
- **Autentikasi OAuth Bawaan**: Login browser langsung dengan `/login codebuddy` menggunakan alur resmi device/state polling dari CodeBuddy. Token disegarkan (auto-refresh) secara otomatis.
- **Dukungan Multi-Akun & Auto Failover**: Tambahkan beberapa akun CodeBuddy; plugin secara otomatis mengalihkan permintaan ke akun berikutnya jika terkena limit kuota / frekuensi (HTTP 429 atau kode 6004).
- **Format Payload Khusus CodeBuddy**:
  - Mewajibkan streaming SSE (`stream: true`).
  - Leading system prompt netral untuk mencegah filter injeksi.
  - User messages dienkapsulasi ke typed text blocks (`[{ type: "text", text: ... }]`).
  - Reasoning effort & summary (`reasoning_summary = "auto"`).
  - Parsing streaming reasoning / thinking delta (`thinking_start`, `thinking_delta`, `thinking_end`).
- **Pelacakan Kuota & Billing (`/codebuddy.usage`)**: Menampilkan sisa kuota (paket langganan berkala harian/mingguan/bulanan dan paket bonus kuota) beserta visual progress bar dan countdown waktu reset.
- **Dukungan Dua Wilayah (`/codebuddy.region`)**: Beralih dengan mudah antara `intl` (`codebuddy.ai`) dan `cn` (`copilot.tencent.com`).
- **Diagnostik Sistem (`/codebuddy.doctor`)**: Memeriksa konektivitas, endpoint aktif, akun aktif, latensi terakhir, dan status provider.

---

## Instalasi

### 1. Pemasangan di Pi / Pi-Bolt

Jalankan perintah instalasi dari direktori proyek atau pasang paket lokal:

```bash
# Instalasi permanen ke konfigurasi Pi:
pi install /path/ke/Codebuddy

# Atau coba langsung tanpa instalasi permanen:
pi -e /path/ke/Codebuddy
```

Jika menggunakan Pi-Bolt:
```bash
pi-bolt -e /path/ke/Codebuddy
```

---

## Autentikasi

### Opsi A: Login Browser OAuth (Direkomendasikan)

Di dalam antarmuka interaktif Pi, jalankan:

```text
/login codebuddy
```

Pi akan memberikan URL otorisasi. Buka URL tersebut di browser, setujui login CodeBuddy, dan Pi akan otomatis mendeteksi keberhasilan login serta menyimpan kredensial.

### Opsi B: API Key / Token Manual

Anda juga dapat mengatur variabel lingkungan:

```bash
export CODEBUDDY_API_KEY="token_akses_codebuddy_anda"
```

---

## Penggunaan Model

Jalankan sesi Pi dengan model CodeBuddy pilihan Anda:

```bash
# Menggunakan GLM-5.2
pi --model codebuddy/glm-5.2

# Menggunakan MiniMax-M3 (1M context)
pi --model codebuddy/minimax-m3

# Menggunakan DeepSeek-V4-Pro
pi --model codebuddy/deepseek-v4-pro

# Menggunakan Kimi-K3
pi --model codebuddy/kimi-k3-1
```

---

## Perintah Tersedia (CLI Commands)

| Perintah | Deskripsi |
|---|---|
| `/codebuddy.usage` | Menampilkan ringkasan sisa kuota, paket berkala, paket bonus, dan waktu reset. |
| `/codebuddy.models` | Menampilkan daftar model yang tersedia, dukungan reasoning, dan limit konteks. |
| `/codebuddy.region [intl\|cn]` | Melihat wilayah saat ini atau beralih antara `intl` (`codebuddy.ai`) dan `cn` (`copilot.tencent.com`). |
| `/codebuddy.accounts` | Melihat daftar akun terhubung, beralih akun aktif (`switch <id>`), atau menghapus akun (`remove <id>`). |
| `/codebuddy.doctor` | Menampilkan diagnostik lengkap provider, endpoint aktif, akun aktif, latensi, dan log kesalahan. |
| `/codebuddy.refresh` | Memverifikasi dan menyegarkan koneksi serta kredensial aktif ke server CodeBuddy. |

---

## Struktur Kode

```text
Codebuddy/
├── package.json               # Manifest Pi package (pi.extensions)
├── tsconfig.json              # Konfigurasi TypeScript NodeNext
├── src/
│   ├── index.ts               # Extension entry point & command registration
│   ├── auth/                  # OAuth state polling, token refresh & multi-account manager
│   ├── client/                # Konfigurasi region (intl vs cn), headers, and endpoints
│   ├── stream/                # SSE parser, request transformation, reasoning & tool handling
│   ├── usage/                 # Billing meter API parser & formatting kuota
│   ├── models/                # Katalog model CodeBuddy
│   ├── diagnostics/           # Store diagnosa untuk /codebuddy.doctor
│   └── utils/                 # Redaksi rahasia & sanitasi waktu reset
└── test/                      # Unit tests (Bun test runner)
```

---

## Menjalankan Pengujian

Proyek ini dibangun dan diuji menggunakan **Bun**:

```bash
bun test
bun run typecheck
```

---

## Lisensi

[MIT License](LICENSE)
