#!/usr/bin/env node
/* Genera los audios del catálogo con ElevenLabs y los enlaza solo en games.json.
 *
 * No se ejecuta desde aquí: esta sesión no tiene ni una clave de ElevenLabs
 * ni salida de red hacia su API. Este script lo corres tú, en un ordenador
 * con Node 18 o más nuevo (usa fetch nativo) y, si quieres el audio en el
 * formato definitivo del proyecto, con ffmpeg instalado.
 *
 * Uso:
 *   export ELEVENLABS_API_KEY="tu_clave"
 *   export ELEVENLABS_VOICE_ID="id_de_una_voz_en_español"   # ver más abajo
 *   node tools/generate-audio-elevenlabs.mjs
 *
 * Por defecto genera solo los juegos que todavía no tienen "audio" en
 * games.json, así que se puede parar y volver a lanzar sin repetir trabajo
 * ni gastar caracteres de más.
 *
 *   --force            regenera también los que ya tienen audio
 *   --only=id1,id2     genera solo esos juegos, para probar antes con uno
 *                       o dos (los id están en data/games.json)
 *
 * Cómo elegir la voz: entra en elevenlabs.io → Voice Library, filtra por
 * español y escucha unas cuantas. En la que te convenza, copia su ID (menú
 * de los tres puntos → Copy Voice ID) y pásalo como ELEVENLABS_VOICE_ID. Si
 * no pones ninguna, el script usa una voz de muestra en inglés que lee
 * español de forma correcta gracias al modelo multilingüe, pero no suena
 * tan natural como una voz pensada para español.
 *
 * El catálogo entero son unos 16 000 caracteres: el plan gratuito de
 * ElevenLabs (10 000 al mes) no llega para generarlo todo de una vez, así
 * que hace falta un plan de pago o repartirlo en dos meses con --only.
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Sarah, voz de muestra en inglés
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
const GAMES_FILE = 'data/games.json';
const AUDIO_DIR = 'data/audio';

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;

if (!API_KEY) {
  console.error('Falta ELEVENLABS_API_KEY. Cópiala desde elevenlabs.io → Profile → API Keys.');
  process.exit(1);
}
if (!process.env.ELEVENLABS_VOICE_ID) {
  console.warn('Aviso: usando la voz de muestra en inglés porque no se ha puesto ELEVENLABS_VOICE_ID.');
  console.warn('Para una voz de verdad en español, elige una en elevenlabs.io → Voice Library.\n');
}

const data = JSON.parse(readFileSync(GAMES_FILE, 'utf8'));
mkdirSync(AUDIO_DIR, { recursive: true });

let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { hasFfmpeg = false; }
if (!hasFfmpeg) {
  console.warn('Aviso: no se encuentra ffmpeg. Los audios se guardan tal cual los da ElevenLabs,');
  console.warn('sin convertir al mono/24 kHz/48 kbps que usa el resto del proyecto.\n');
}

const pending = data.games.filter((g) => {
  if (only) return only.has(g.id);
  if (force) return true;
  return !g.audio;
});

if (!pending.length) {
  console.log('No hay nada que generar. Usa --force para regenerar todos, o --only=id1,id2 para elegir.');
  process.exit(0);
}

const totalChars = pending.reduce((n, g) => n + (g.script || g.steps.join(' ')).length, 0);
console.log(`Generando ${pending.length} juegos (${totalChars} caracteres) con la voz ${VOICE_ID}...\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let done = 0;
const failed = [];

for (const game of pending) {
  const text = game.script || game.steps.join(' ');
  process.stdout.write(`  ${game.id} ... `);
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
    const buf = Buffer.from(await res.arrayBuffer());

    const rawPath = `${AUDIO_DIR}/${game.id}.raw.mp3`;
    const finalPath = `${AUDIO_DIR}/${game.id}.mp3`;
    writeFileSync(rawPath, buf);

    if (hasFfmpeg) {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', rawPath,
        '-ac', '1', '-ar', '24000', '-b:a', '48k', '-codec:a', 'libmp3lame', finalPath]);
      unlinkSync(rawPath);
    } else {
      renameSync(rawPath, finalPath);
    }

    game.audio = `${AUDIO_DIR}/${game.id}.mp3`;
    done++;
    console.log('hecho');
  } catch (e) {
    failed.push(game.id);
    console.log('FALLO: ' + e.message);
  }
  await sleep(400); // margen para no chocar con el límite de peticiones por segundo
}

writeFileSync(GAMES_FILE, JSON.stringify(data, null, 2) + '\n');

console.log(`\n${done} audios generados, ${failed.length} fallos.`);
if (failed.length) {
  console.log('Fallaron: ' + failed.join(', '));
  console.log('Vuelve a lanzar el script tal cual: solo reintenta lo que falte.');
}
if (done) {
  console.log('data/games.json ya tiene el campo "audio" de los que salieron bien.');
  console.log('Escucha un par de ellos y, si convencen, valida y sube los cambios:');
  console.log('  node tools/check-games.mjs');
  console.log('  git add data/audio data/games.json && git commit -m "Audios generados con ElevenLabs" && git push');
}
