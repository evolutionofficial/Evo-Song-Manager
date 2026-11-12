# Evo Song Manager - pindahkan lagu yang sudah dihapus ke folder trash
#
# Dibuat 13 Nov 2026 untuk 32 file yang kamu hapus dari aplikasi.
#
# Yang dilakukan: setiap WAV (dan M4A pasangannya kalau ada) dipindahkan ke subfolder "trash"
# di dalam folder Mixdown-nya, lalu diberi akhiran .deleted.
#
# Kenapa diberi akhiran: pemindai hanya membaca file yang berakhiran .wav, jadi dengan akhiran
# .deleted file itu tidak akan pernah terbaca lagi sebagai lagu baru. Nama aslinya tetap utuh di
# depan, jadi kalau suatu saat mau dikembalikan tinggal buang akhiran .deleted-nya.
#
# File TIDAK dihapus, hanya dipindahkan. Aman dijalankan dua kali.

$ErrorActionPreference = 'Stop'
$files = @(
  'G:\FIrst CLUB\CIA\14 April\Cia 14 April\Mixdown\Cia - Xiao Sa Zou Yi Hui.wav',
  'G:\FIrst CLUB\CIA\20 May\Cia -20 May\Mixdown\Cia - Si Bu Liao (AI).wav',
  'G:\FIrst CLUB\CIA\20 May\Cia -20 May\Mixdown\Cia - Si Bu Liao Fix.wav',
  'G:\FIrst CLUB\CIA\20 May\Cia -20 May\Mixdown\Cia - Si Bu Liao.wav',
  'G:\FIrst CLUB\CIA\20 May\Cia -20 May\Mixdown\Cia - Xia Ding Jue Xin Wang Ji Ni.wav',
  'G:\FIrst CLUB\CIA\30 Maret\Cia 30 MAr\Mixdown\Cia - Ai Pia Cia E Ya.wav',
  'G:\FIrst CLUB\CIA\5 May\Cia 5 May\Mixdown\Cia - Annie.wav',
  'G:\FIrst CLUB\CIA\cia\PC\7 Jan\Cia 7 Jan\Mixdown\Cia - Ai Wo de Ren He Wo Ai de Ren Clean.wav',
  'G:\FIrst CLUB\CIA\cia\PC\Xing Yu Xin Yuan\Xing Yu Xin Yuan\Mixdown\Cia -Xing Yu Xin Yuan.wav',
  'G:\FIrst CLUB\KEKET\11 FEB\KEKET 11 FEB\Mixdown\Keket - CAi Shen Dao (All OFF).wav',
  'G:\FIrst CLUB\KEKET\11 FEB\KEKET 11 FEB\Mixdown\Keket - CAi Shen Dao (Male Voc ON).wav',
  'G:\FIrst CLUB\KEKET\11 FEB\KEKET 11 FEB\Mixdown\Keket - Cai Shen Dao (Rvs 2).wav',
  'G:\FIrst CLUB\KEKET\11 FEB\KEKET 11 FEB\Mixdown\Keket - Cai Shen Dao (Rvs).wav',
  'G:\FIrst CLUB\KEKET\11 FEB\KEKET 11 FEB\Mixdown\Keket - Cai Shen Dao (Rvsi).wav',
  'G:\FIrst CLUB\KEKET\18 FEB\Keket 18 feb\Mixdown\Keket - Lean On.wav',
  'G:\FIrst CLUB\KEKET\Keket 26 Feb\Mixdown\Keket - Heaven.wav',
  'G:\FIrst CLUB\KEKET\Keket 27\Mixdown\Keket - Killing Me Softly.wav',
  'G:\FIrst CLUB\KEKET\PC\Christmas\All I want For Christmas\Mixdown\Keket - All I Want For XMas Is You.wav',
  'G:\FIrst CLUB\KEKET\20 May\Keket 20 May\Mixdown\Keket - Beraksi.wav',
  'D:\FIRST CLUB\Carla\25 Okt\Carla 25 Okt\Mixdown\Carla -  Bloody Mary x Thriller.wav',
  'D:\FIRST CLUB\Carla\27 Okt\Carla 27 Okt\Mixdown\Carla - Gigolo x Asereje Vocal.wav',
  'D:\FIRST CLUB\Carla\30 Okt\Carla 30 Okt\Mixdown\Carla - Ni Yao De Ai(2).wav',
  'D:\FIRST CLUB\Guna\17 Okt\Guna 17 Okt\Mixdown\Guna - Tiada Lagi.wav',
  'D:\FIRST CLUB\Guna\21 Okt\Guna 21 Okt\Mixdown\Guna - Skyfull Of Stars.wav',
  'D:\FIRST CLUB\Guna\9 Nov\Guna 9 Nov\Guna 9 Nov\Mixdown\Guna - Emang Dasar.wav',
  'D:\FIRST CLUB\Guna\9 Nov\Guna 9 Nov\Guna 9 Nov\Mixdown\Guna - Nothing Gonna Change My Love For You.wav',
  'D:\FIRST CLUB\KEKET\17 Okt\Keket 17 Okt\Mixdown\Keket - Bi Jing Shen Ai Guo.wav',
  'D:\FIRST CLUB\KEKET\17 Okt\Keket 17 Okt\Mixdown\Keket - Tian Mi Mi Rock.wav',
  'D:\FIRST CLUB\KEKET\PC\13 Jan\keket 13 Jan\Mixdown\Keket - Style.wav',
  'D:\FIRST CLUB\KEKET\PC\28 Jan\Keket 28 Jan\Mixdown\Keket - Swalla Revisi 2.wav',
  'D:\FIRST CLUB\KEKET\PC\28 Jan\Keket 28 Jan\Mixdown\Keket - Swalla Revisi.wav',
  'D:\FIRST CLUB\KEKET\PC\28 Jan\Keket 28 Jan\Mixdown\Keket - Swalla.wav'
)

$moved = 0; $skipped = 0; $missing = 0
foreach ($f in $files) {
  $dir   = Split-Path -Parent $f
  $trash = Join-Path $dir 'trash'
  foreach ($ext in @('.wav', '.m4a')) {
    $src = [System.IO.Path]::ChangeExtension($f, $ext)
    if (-not (Test-Path -LiteralPath $src)) {
      if ($ext -eq '.wav') { Write-Host "TIDAK ADA  $src" -ForegroundColor DarkGray; $missing++ }
      continue
    }
    if (-not (Test-Path -LiteralPath $trash)) { New-Item -ItemType Directory -Path $trash | Out-Null }
    $dest = Join-Path $trash ((Split-Path -Leaf $src) + '.deleted')
    if (Test-Path -LiteralPath $dest) { Write-Host "SUDAH ADA  $dest" -ForegroundColor DarkYellow; $skipped++; continue }
    Move-Item -LiteralPath $src -Destination $dest
    Write-Host "PINDAH     $(Split-Path -Leaf $src)" -ForegroundColor Green
    $moved++
  }
}

Write-Host ""
Write-Host "Selesai. Dipindahkan: $moved, dilewati: $skipped, tidak ditemukan: $missing" -ForegroundColor Cyan
Write-Host "Tekan Enter untuk menutup."
[void][System.Console]::ReadLine()
