#!/usr/bin/env node
/* Valida data/games.json antes de publicar.
   Uso: node tools/check-games.mjs
   Devuelve 1 si hay errores; los avisos no rompen la publicación. */

import { readFileSync, existsSync } from 'node:fs';

const FILE = 'data/games.json';
const errors = [];
const warnings = [];

let raw;
try {
  raw = JSON.parse(readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error(`✖ ${FILE} no es un JSON válido: ${e.message}`);
  process.exit(1);
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

const themes = Array.isArray(raw.themes) ? raw.themes : [];
const games = Array.isArray(raw.games) ? raw.games : [];

if (!themes.length) errors.push('No hay ningún tema definido en "themes".');
if (!games.length) errors.push('No hay ningún juego definido en "games".');

const themeIds = new Set();
themes.forEach((theme, i) => {
  const where = `themes[${i}]`;
  if (!theme.id || !ID.test(theme.id)) errors.push(`${where}: el id debe ir en minúsculas y con guiones ("${theme.id}").`);
  else if (themeIds.has(theme.id)) errors.push(`${where}: el id "${theme.id}" está repetido.`);
  else themeIds.add(theme.id);
  if (!theme.name) errors.push(`${where}: falta "name".`);
  if (theme.color && !HEX.test(theme.color)) errors.push(`${where}: el color "${theme.color}" no es un hexadecimal de seis dígitos.`);
  if (!theme.subtitle) warnings.push(`${where}: sin "subtitle"; la pastilla del tema saldrá sin descripción.`);
});

const gameIds = new Set();
const countByTheme = Object.fromEntries([...themeIds].map((id) => [id, 0]));

games.forEach((game, i) => {
  const where = `games[${i}]${game && game.title ? ` (${game.title})` : ''}`;
  if (!game || typeof game !== 'object') { errors.push(`${where}: no es un objeto.`); return; }

  if (!game.title || !String(game.title).trim()) errors.push(`${where}: falta "title".`);
  if (!game.theme) errors.push(`${where}: falta "theme".`);
  else if (!themeIds.has(game.theme)) errors.push(`${where}: el tema "${game.theme}" no existe en "themes".`);
  else countByTheme[game.theme]++;

  if (game.id !== undefined) {
    if (!ID.test(game.id)) errors.push(`${where}: el id "${game.id}" debe ir en minúsculas y con guiones.`);
    else if (gameIds.has(game.id)) errors.push(`${where}: el id "${game.id}" está repetido.`);
    else gameIds.add(game.id);
  } else {
    warnings.push(`${where}: sin "id"; se derivará del título y cambiará si renombras el juego.`);
  }

  if (!Array.isArray(game.steps) || !game.steps.length) {
    errors.push(`${where}: "steps" debe ser una lista con al menos un paso.`);
  } else {
    game.steps.forEach((step, j) => {
      if (typeof step !== 'string' || !step.trim()) errors.push(`${where}: el paso ${j + 1} está vacío.`);
    });
    if (game.steps.length > 5) warnings.push(`${where}: ${game.steps.length} pasos; en el móvil se lee mejor con cuatro o menos.`);
  }

  if (game.duration !== undefined) {
    const d = Number(game.duration);
    if (!Number.isFinite(d) || d <= 0) errors.push(`${where}: "duration" debe ser un número de minutos mayor que cero.`);
    else if (d > 60) warnings.push(`${where}: ${d} minutos es mucho para una actividad de tótem.`);
  }

  if (game.script !== undefined && (typeof game.script !== 'string' || !game.script.trim())) {
    errors.push(`${where}: "script" debe ser texto.`);
  }
  if (game.script === undefined) {
    warnings.push(`${where}: sin "script"; en voz alta se leerán los pasos tal cual.`);
  } else if (/[*_#`]|\p{Extended_Pictographic}/u.test(game.script)) {
    warnings.push(`${where}: el "script" lleva marcado o emojis, que suenan mal leídos en voz alta.`);
  }

  if (game.audio) {
    if (!existsSync(game.audio)) errors.push(`${where}: el audio "${game.audio}" no existe en el repositorio.`);
    else if (!game.audio.endsWith('.mp3')) warnings.push(`${where}: el audio no es un MP3; Alexa solo admite MP3.`);
  }
});

for (const [theme, count] of Object.entries(countByTheme)) {
  if (count === 0) errors.push(`El tema "${theme}" se queda sin juegos.`);
  else if (count < 3) warnings.push(`El tema "${theme}" solo tiene ${count} juegos: se repetirán enseguida.`);
}

warnings.forEach((w) => console.log(`⚠ ${w}`));
errors.forEach((e) => console.error(`✖ ${e}`));

if (errors.length) {
  console.error(`\n${errors.length} error(es). El catálogo no está listo para publicar.`);
  process.exit(1);
}
console.log(`\n✔ ${games.length} juegos en ${themes.length} temas. Catálogo correcto.`);
