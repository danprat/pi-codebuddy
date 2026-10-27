# pi-codebuddy

[![Pi Package](https://img.shields.io/badge/pi--package-provider-blue.svg)](https://github.com/danprat/pi-codebuddy)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.4+-fbf0df.svg?logo=bun&logoColor=black)](https://bun.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Plugin provider resmi dan lengkap untuk menghubungkan [Pi Coding Agent](https://github.com/earendil-works/pi) / [Pi-Bolt](https://github.com/opensec-git/Pi-Bolt) dengan ekosistem model AI coding dari **Tencent CodeBuddy** (mendukung edisi International `codebuddy.ai` maupun China `copilot.tencent.com`).

Plugin ini menyertakan autentikasi browser OAuth resmi, penanganan streaming SSE mulus, bypass **Channel Verification (Kode 11128)**, pelacakan kuota/billing, serta arsitektur **Multi-Account Pooling & Auto-Failover**.

---

## Daftar Isi

1. [Fitur Unggulan](#-fitur-unggulan)
2. [Tabel Model & Spesifikasi (Konteks hingga 1M)](#-tabel-model--spesifikasi)
3. [Panduan Instalasi Lengkap](#-panduan-instalasi-lengkap)
4. [Tutorial Penggunaan Langkah-demi-Langkah](#-tutorial-penggunaan-langkah-demi-langkah)
   - [Langkah 1: Login & Autentikasi](#langkah-1-login--autentikasi)
   - [Langkah 2: Menjalankan Model](#langkah-2-menjalankan-model)
   - [Langkah 3: Menggunakan Fitur Multi-Akun](#langkah-3-menggunakan-fitur-multi-akun)
   - [Langkah 4: Memeriksa Sisa Kuota & Billing](#langkah-4-memeriksa-sisa-kuota--billing)
   - [Langkah 5: Beralih Wilayah (Intl vs CN)](#langkah-5-beralih-wilayah-intl-vs-cn)
5. [Daftar Perintah CLI (Commands)](#-daftar-perintah-cli-commands)
6. [Solusi Masalah Teknis & FAQ (Troubleshooting)](#-solusi-masalah-teknis--faq)
7. [Pengujian & Pengembangan Lokal](#-pengujian--pengembangan-lokal)

---

## 🚀 Fitur Unggulan

- **Kapasitas Konteks Penuh hingga 1M (1.000.000 token)**:
  Mendukung jendela konteks raksasa pada model flagship (`deepseek-v4.1-flash`, `deepseek-v4-pro`, `glm-5.2`, `glm-5.3`, `kimi-k3-1`, dan `hy4-preview`), cocok untuk pengerjaan proyek berskala besar tanpa terpotong.
- **Autentikasi Browser OAuth Resmi**:
  Login langsung di terminal menggunakan alur resmi device/state polling dari CodeBuddy via `/login codebuddy`. Token otomatis disegarkan (*auto-refresh*) sebelum masa berlakunya habis.
- **Multi-Akun & Auto-Failover**:
  Dapat menghubungkan lebih dari 1 akun. Jika akun utama terkena limit kuota (429), frekuensi (6004), atau restriksi (11140), plugin **secara otomatis beralih ke akun cadangan** secara transparan tanpa menghentikan percakapan.
- **Bypass Channel Verification (Kode 11128)**:
  Mengimplementasikan kelompok header resmi `X-Conversation-*` (`X-Conversation-ID` berbasis RFC-4122-v5, `X-Conversation-Request-ID`, dan `X-Conversation-Message-ID`) sehingga permintaan selalu terverifikasi sebagai client resmi.
- **Streaming SSE Mulus Tanpa Karakter Patah**:
  Menyaring array kosong `tool_calls: []` yang dikirim CodeBuddy pada setiap delta, memastikan kalimat mengalir rapi dalam satu paragraf dan tidak tercetak vertikal per kata.
- **Pelacakan Kuota Akurat (`/codebuddy.usage`)**:
  Menampilkan sisa saldo kredit, masa aktif paket langganan berkala (harian/mingguan/bulanan), dan paket bonus dengan visual *progress bar* dan hitung mundur waktu reset.
- **Dukungan Dua Wilayah (`/codebuddy.region`)**:
  Dukungan bawaan untuk **International** (`codebuddy.ai`) dan **China** (`copilot.tencent.com`).

---

## 📊 Tabel Model & Spesifikasi

| Model ID | Nama Model | Konteks (Context Window) | Output Maksimal | Reasoning / Thinking | Vision (Gambar) |
|---|---|---|---|---|---|
| `deepseek-v4.1-flash` | DeepSeek-V4.1-Flash | **1.0M (1.000.000)** | 393.2K | - | Ya |
| `deepseek-v4-pro` | DeepSeek-V4-Pro | **1.0M (1.000.000)** | 393.2K | Ya | - |
| `glm-5.2` | GLM-5.2 | **1.0M (1.000.000)** | 131.1K | Ya | Ya |
| `glm-5.3` | GLM-5.3 | **1.0M (1.000.000)** | 131.1K | Ya | Ya |
| `glm-5.3-flash` | GLM-5.3 Flash | **1.0M (1.000.000)** | 131.1K | - | Ya |
| `minimax-m3` | MiniMax-M3 | **1.0M (1.000.000)** | 131.1K | Ya | Ya |
| `kimi-k3-1` | Kimi-K3 | **1.0M (1.000.000)** | 1.0M | Ya | Ya |
| `hy4-preview` | Hy4 Preview | **1.0M (1.000.000)** | 64.0K | Ya | - |
| `kimi-k2.8-preview` | Kimi-K2.8 Preview | 300K | 131.1K | Ya | - |
| `kimi-k2.7` | Kimi-K2.7-Code | 262K | 65.5K | Ya | - |
| `kimi-k2.6` | Kimi-K2.6 | 262K | 65.5K | Ya | - |
| `glm-5.1` | GLM-5.1 | 200K | 48.0K | Ya | Ya |
| `glm-5.0` | GLM-5.0 | 200K | 48.0K | Ya | - |
| `glm-4.7` | GLM-4.7 | 200K | 48.0K | - | - |
| `hy3` | Hunyuan 3 | 192K | 64.0K | Ya | - |
| `hy3-preview` | Hy3 Preview | 192K | 64.0K | Ya | - |
| `kimi-k2.5` | Kimi-K2.5 | 164K | 32.0K | Ya | - |
| `deepseek-v3-2-volc`| DeepSeek-V3.2 | 96K | 32.0K | - | - |

---

## 📦 Panduan Instalasi Lengkap

### Metode A: Pasang Langsung dari GitHub (Direkomendasikan)

Jika Anda sudah menginstal Pi atau Pi-Bolt, cukup jalankan perintah berikut di terminal:

```bash
# Pasang paket langsung dari remote GitHub:
pi install git:github.com/danprat/pi-codebuddy

# Atau jika menggunakan Pi-Bolt:
pi-bolt install git:github.com/danprat/pi-codebuddy
```

### Metode B: Pasang dari Repositori Lokal

Jika Anda mengkloning repositori ini ke komputer Anda:

```bash
git clone https://github.com/danprat/pi-codebuddy.git
cd pi-codebuddy
bun install

# Daftarkan direktori lokal ke Pi / Pi-Bolt:
pi install .
# atau
pi-bolt install .
```

### Metode C: Jalankan Sementara (Tanpa Instalasi Permanen)

Untuk mencoba plugin sekali jalan:

```bash
pi-bolt -e /path/ke/pi-codebuddy
```

---

## 📖 Tutorial Penggunaan Langkah-demi-Langkah

### Langkah 1: Login & Autentikasi

1. Buka sesi interaktif Pi CLI:
   ```bash
   pi-bolt
   ```
2. Jalankan perintah login:
   ```text
   /login codebuddy
   ```
   *(Atau pilih opsi menu `/login` $\rightarrow$ `Sign in with an account` $\rightarrow$ `CodeBuddy`)*.
3. Pi akan menampilkan instruksi dan membuka browser Anda secara otomatis (atau memberikan tautan otorisasi).
4. Klik **Authorize / Sign In** pada halaman CodeBuddy.
5. Terminal Pi akan otomatis mendeteksi persetujuan login, menyinkronkan token ke `~/.pi/agent/auth.json`, dan siap digunakan.

> **Tips API Key Manual:** Jika Anda memiliki token akses langsung, Anda juga dapat menggunakannya tanpa browser dengan menyetel variabel lingkungan:
> ```bash
> export CODEBUDDY_API_KEY="token_anda_di_sini"
> ```

---

### Langkah 2: Menjalankan Model

Jalankan perintah Pi dengan memilih model berawalan `codebuddy/`:

```bash
# Menggunakan DeepSeek V4.1 Flash (Konteks 1M, Super Cepat)
pi-bolt --model codebuddy/deepseek-v4.1-flash

# Menggunakan GLM 5.2 (Konteks 1M dengan Reasoning Canggih)
pi-bolt --model codebuddy/glm-5.2

# Menggunakan MiniMax M3
pi-bolt --model codebuddy/minimax-m3

# Menggunakan Kimi K3
pi-bolt --model codebuddy/kimi-k3-1
```

Di dalam antarmuka interaktif, Anda juga dapat beralih model kapan saja menggunakan:
```text
/model codebuddy/deepseek-v4.1-flash
```

---

### Langkah 3: Menggunakan Fitur Multi-Akun

Plugin ini mengelola banyak akun secara otomatis di file `~/.pi/agent/codebuddy-accounts.json`.

#### Menambahkan Akun Kedua atau Ketiga
Cukup jalankan kembali perintah login:
```text
/login codebuddy
```
Masuk dengan akun Google / GitHub Anda yang lain di browser. Akun baru akan otomatis ditambahkan ke dalam daftar kolam akun tanpa menghapus akun yang lama.

#### Melihat Daftar Akun Terhubung
```text
/codebuddy.accounts
```
*Contoh keluaran:*
```text
Linked CodeBuddy Accounts:
───────────────────────────────────────────────────────
* 1. developer1@gmail.com [INTL]
  2. developer2@gmail.com [INTL]
───────────────────────────────────────────────────────
Commands: /codebuddy.accounts switch <index|id> or remove <index|id>
```
*(Tanda `*` menandakan akun yang sedang aktif).*

#### Berpindah Akun Aktif Secara Manual
```text
# Beralih ke akun nomor 2
/codebuddy.accounts switch 2

# Atau menggunakan email / ID akun:
/codebuddy.accounts switch developer2@gmail.com
```

#### Menghapus Akun
```text
/codebuddy.accounts remove 2
```

#### Cara Kerja Auto-Failover Otomatis
Jika Anda memiliki 2 akun atau lebih:
- Ketika Akun #1 mencapai batas pemakaian harian (HTTP 429), batas frekuensi (Kode 6004), atau terkena restriksi (Kode 11140), plugin **secara otomatis mengalihkan request ke Akun #2**.
- Anda tidak perlu mengulang prompt atau memulai sesi baru dari awal.

---

### Langkah 4: Memeriksa Sisa Kuota & Billing

Untuk melihat detail sisa kredit, masa aktif paket, dan waktu reset kuota Anda:

```text
/codebuddy.usage
```

*Contoh keluaran:*
```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CodeBuddy Quota Usage (INTL) — Plan: Free Plan Subscription
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Monthly Allowance #1 (Free Plan Subscription)
  Used:      0.14 / 100.00 [█░░░░░░░░░░░░░░░] 0%
  Remaining: 99.86
  Resets in: 4d 11h (2026-10-31)

Use /codebuddy.region to toggle between intl and cn.
```

---

### Langkah 5: Beralih Wilayah (Intl vs CN)

Secara default, plugin terhubung ke gateway internasional (`www.codebuddy.ai`). Jika Anda memiliki akun Tencent Cloud China (login via WeChat / QQ / Ponsel):

```text
# Beralih ke wilayah China:
/codebuddy.region cn

# Beralih kembali ke wilayah Internasional:
/codebuddy.region intl

# Mengetahui wilayah yang sedang aktif:
/codebuddy.region
```

Setelah berpindah wilayah, jalankan `/login codebuddy` untuk menghubungkan akun wilayah tersebut.

---

## 🛠 Daftar Perintah CLI (Commands)

| Perintah | Contoh Pemakaian | Deskripsi |
|---|---|---|
| `/codebuddy.usage` | `/codebuddy.usage` | Melihat kuota paket langganan aktif, sisa kredit, visual *progress bar*, dan waktu reset kuota. |
| `/codebuddy.models` | `/codebuddy.models` | Menampilkan tabel lengkap model yang tersedia beserta batas konteks dan dukungan reasoning. |
| `/codebuddy.region` | `/codebuddy.region intl`<br>`/codebuddy.region cn` | Melihat wilayah saat ini atau berganti antara gateway Internasional (`codebuddy.ai`) dan China (`copilot.tencent.com`). |
| `/codebuddy.accounts` | `/codebuddy.accounts`<br>`/codebuddy.accounts switch 2`<br>`/codebuddy.accounts remove 2` | Melihat seluruh akun yang terhubung, berpindah akun aktif, atau menghapus akun lama. |
| `/codebuddy.doctor` | `/codebuddy.doctor` | Menampilkan diagnostik koneksi, endpoint aktif, akun aktif, latensi respons terakhir, dan riwayat error. |
| `/codebuddy.refresh` | `/codebuddy.refresh` | Memverifikasi dan menyegarkan token aktif langsung ke server CodeBuddy. |

---

## ❓ Solusi Masalah Teknis & FAQ

### 1. Pesan `Error: request illegal` (Kode 11128 / Channel Verification)
- **Penyebab:** Server CodeBuddy mewajibkan header pelacakan percakapan resmi (`X-Conversation-ID`, `X-Conversation-Request-ID`, `X-Conversation-Message-ID`).
- **Solusi:** Plugin ini sudah otomatis menyertakan seluruh header tersebut dengan format RFC-4122-v5 deterministik berbasis hash query awal Anda.

### 2. Pesan `We detected unusual activity on this account` (Kode 11140)
- **Penyebab:** Server Tencent menerapkan *Risk-Control Flag* (风控限制) pada akun tertentu (sering kali terjadi pada akun Gmail baru tanpa verifikasi nomor telepon yang sempat melakukan pemanggilan beruntun).
- **Solusi:**
  1. Tambahkan akun Google / GitHub kedua Anda dengan mengetik `/login codebuddy`.
  2. Beralih ke akun baru tersebut (`/codebuddy.accounts switch 2`).
  3. Plugin akan otomatis melakukan failover jika ada akun yang terflag.
  4. Untuk memulihkan akun lama, buka [codebuddy.ai](https://www.codebuddy.ai) di browser dan ajukan permohonan pembukaan blokir (*Appeal/Feedback*).

### 3. Teks Jawaban Turun Baris per Kata / Token
- **Penyebab:** Server CodeBuddy mengirimkan `tool_calls: []` kosong di setiap chunk delta SSE.
- **Solusi:** Telah diperbaiki secara tuntas pada versi ini dengan memfilter array kosong sehingga teks dirender menyambung dalam satu paragraf utuh.

### 4. Memeriksa Status Koneksi
Gunakan perintah diagnosa mandiri:
```text
/codebuddy.doctor
```
Perintah ini akan menampilkan status koneksi, endpoint yang dihubungi, akun yang aktif, dan latensi jaringan Anda ke server CodeBuddy.

---

## 🧪 Pengujian & Pengembangan Lokal

Proyek ini dibangun menggunakan **Bun** dan **TypeScript**:

```bash
# Menjalankan seluruh pengujian unit:
bun test

# Memeriksa kepatuhan tipe TypeScript:
bun run typecheck
```

Seluruh 17 pengujian unit meliputi pengujian transformer payload, parsing batas kuota/frekuensi 6004, penanganan error 11140, verifikasi header `X-Conversation-*`, dan integritas streaming chunk lulus 100%.

---

## 📄 Lisensi

Didistribusikan di bawah lisensi terbuka [MIT License](LICENSE).
Dikembangkan untuk komunitas pengguna Pi Coding Agent.
