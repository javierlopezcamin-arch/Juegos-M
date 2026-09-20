# Llevar el Tótem a Alexa

La app no depende de Alexa en nada, pero se ha construido de forma que migrarla sea
añadir una pieza, no rehacer el trabajo. Este documento deja anotado el camino.

## Qué se reutiliza tal cual

- **`data/games.json`.** Es un catálogo puro, sin una sola referencia a la interfaz. Una skill
  puede descargarlo desde la URL pública de GitHub Pages al arrancar la sesión, o empaquetarlo
  con su código si se prefiere no depender de la red.
- **El campo `script`.** Está escrito para el oído: frases cortas, sin abreviaturas, sin marcado
  ni emojis. Es exactamente lo que necesita una respuesta hablada.
- **Los identificadores.** Van en minúsculas con guiones, son estables y no se reutilizan, así que
  sirven de clave para guardar en los atributos persistentes de la skill qué juegos ya han salido.
- **Los MP3 de `data/audio/`.** `tools/encode-audio.sh` los deja en mono, 24 kHz y 48 kbps, que es
  el formato admitido por la etiqueta `<audio>` de SSML.

## Qué no se reutiliza

La interfaz, el service worker y el almacenamiento local del navegador. Son la capa de pantalla
y no tienen equivalente en un altavoz.

## Esbozo de la skill

Un proyecto aparte, alojado en Alexa (Node), con este modelo de interacción:

| Intención | Ejemplos de lo que diría el usuario |
| --- | --- |
| `ElegirTemaIntent` | "ponme un juego de concentración", "algo de gratitud" |
| `SorpresaIntent` | "sorpréndeme", "lo que sea" |
| `OtroJuegoIntent` | "otro", "dame otro juego" |
| `AMAZON.RepeatIntent` | "repite" |
| `AMAZON.HelpIntent`, `AMAZON.StopIntent`, `AMAZON.CancelIntent` | las integradas |

El tema se resuelve con un tipo de slot propio, `Tema`, cuyos valores son los ids de `themes`
y sus sinónimos hablados.

La lógica de sorteo es la misma que en `app.js`: una bolsa barajada por tema de la que se van
sacando juegos hasta agotarla. Allí vive en `localStorage`; en la skill, en los atributos
persistentes de la sesión, que Alexa guarda por usuario.

La respuesta se construye igual de simple: si el juego tiene `audio`, se envía con
`<audio src="...">`; si no, se lee el `script` directamente.

## Antes de ponerse

Conviene verificar en la documentación de Alexa, que cambia con el tiempo, los límites del
audio en SSML (duración máxima por clip y formato exacto) y si conviene el reproductor de audio
para las locuciones largas. Hace falta además una cuenta de desarrollador de Amazon, y publicar
la skill al público, aunque sea para uso propio, pasa por su proceso de certificación. Para uso
personal basta con probarla en modo desarrollo en el propio dispositivo.
