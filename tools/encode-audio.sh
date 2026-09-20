#!/usr/bin/env bash
# Convierte una grabación exportada desde la app al MP3 definitivo del repositorio.
#
#   tools/encode-audio.sh ~/Descargas/conc-cazador-de-sonidos.webm
#   tools/encode-audio.sh grabacion.m4a conc-cazador-de-sonidos
#
# Produce data/audio/<id>.mp3 en mono, 24 kHz y 48 kbps: el formato que admite
# la etiqueta de audio de SSML, de modo que el mismo fichero sirve para una skill de Alexa.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Uso: tools/encode-audio.sh <grabacion> [id-del-juego]" >&2
  exit 1
fi

src="$1"
[ -f "$src" ] || { echo "No existe el fichero: $src" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "Hace falta ffmpeg. En macOS: brew install ffmpeg" >&2; exit 1; }

base="$(basename "$src")"
id="${2:-${base%.*}}"
out="data/audio/${id}.mp3"

mkdir -p data/audio
ffmpeg -hide_banner -loglevel error -y -i "$src" -ac 1 -ar 24000 -b:a 48k -codec:a libmp3lame "$out"

seconds="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out" 2>/dev/null || echo 0)"
if [ "${seconds%.*}" -gt 240 ] 2>/dev/null; then
  echo "Aviso: ${seconds%.*} s. SSML de Alexa corta en 240 s; para la app no hay problema."
fi

echo "Creado $out"
echo "Añade esta línea al juego en data/games.json:"
echo "  \"audio\": \"$out\""
