#!/bin/bash
# Evo Song Manager — pindahkan lagu yang sudah dihapus ke folder trash (MacBook)
#
# Satu file: Guna - Locked Out of Heaven, yang kamu hapus dari aplikasi.
#
# File dipindahkan ke subfolder "trash" di dalam Mixdown-nya dan diberi akhiran .deleted.
# Pemindai hanya membaca file berakhiran .wav, jadi setelah ini file tersebut tidak akan
# pernah terbaca lagi sebagai lagu baru. Nama aslinya tetap utuh di depan akhirannya, jadi
# kalau mau dikembalikan tinggal buang ".deleted".
#
# File TIDAK dihapus, hanya dipindahkan. Aman dijalankan dua kali.
set -u

files=(
  "/Users/jeffryferdian/Documents/First Club/Guna/Guna 6 Okt/Mixdown/Guna - Locked Out of Heaven.wav"
)

moved=0; skipped=0; missing=0
for f in "${files[@]}"; do
  dir=$(dirname "$f")
  for ext in wav m4a; do
    src="${f%.wav}.$ext"
    if [ ! -f "$src" ]; then
      [ "$ext" = "wav" ] && { echo "TIDAK ADA  $src"; missing=$((missing+1)); }
      continue
    fi
    mkdir -p "$dir/trash"
    dest="$dir/trash/$(basename "$src").deleted"
    if [ -e "$dest" ]; then echo "SUDAH ADA  $dest"; skipped=$((skipped+1)); continue; fi
    mv "$src" "$dest"
    echo "PINDAH     $(basename "$src")"
    moved=$((moved+1))
  done
done

echo
echo "Selesai. Dipindahkan: $moved, dilewati: $skipped, tidak ditemukan: $missing"
echo "Tekan Enter untuk menutup."
read -r _
