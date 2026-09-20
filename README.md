# Tótem

App-web para el móvil inspirada en el Totem de Morphée: eliges un tema, pulsas para girar
y sale un juego al azar. Puedes escucharlo con tu propia voz grabada o con la del móvil,
cronometrarlo y guardarlo en favoritos.

El tótem suena al girar, al revelar el juego y al acabarse el tiempo. Los sonidos se
sintetizan en el propio navegador, así que no pesan nada, y se apagan desde Ajustes.

No tiene servidor, ni base de datos, ni paso de compilación: son ficheros estáticos.
Todo lo que recuerda la app (favoritos, historial, sorteo y grabaciones) vive en el
propio teléfono.

## Añadir un juego

Se edita un único fichero, `data/games.json`, y se puede hacer desde GitHub en el móvil.
Basta con pegar un bloque nuevo al final del array `games`:

```json
{
  "id": "conc-cazador-de-sonidos",
  "theme": "concentracion",
  "title": "Cazador de sonidos",
  "duration": 8,
  "script": "Ponte cómodo y cierra los ojos. Cuenta en silencio cada sonido que oigas...",
  "steps": [
    "Siéntate cómodo y cierra los ojos.",
    "Cuenta en silencio cada sonido distinto que oigas.",
    "Al llegar a cinco, abre los ojos y nómbralos en voz alta."
  ]
}
```

| Campo | Obligatorio | Para qué sirve |
| --- | --- | --- |
| `theme` | sí | Id de uno de los temas de `themes`. |
| `title` | sí | Lo que se ve grande en la ficha. |
| `steps` | sí | Los pasos numerados en pantalla. Mejor cuatro o menos. |
| `id` | recomendable | Identificador estable. Si falta, se deriva del título y cambia al renombrar. |
| `duration` | no | Minutos del temporizador. Por defecto, 10. |
| `script` | no | El texto que se lee en voz alta, escrito para el oído. Si falta, se leen los pasos. |
| `audio` | no | Ruta a un MP3 con tu locución, por ejemplo `data/audio/mi-juego.mp3`. |
| `players` | no | Si el juego necesita compañía, por ejemplo `"2 o más"`. Aparece en la ficha. |
| `ages`, `materials`, `tags` | no | Campos libres, reservados para más adelante. |

Los temas se definen arriba del mismo fichero, en `themes`, con `id`, `name`, `color` y `subtitle`.
Añadir un tema nuevo es igual de sencillo.

Antes de publicar conviene pasar el validador, que también se ejecuta solo en cada push:

```bash
node tools/check-games.mjs
```

## Poner tu voz

1. Abre el juego en el móvil, pulsa **Mi voz** y graba. La grabación se guarda en el teléfono
   y a partir de ese momento suena antes que la voz del sistema.
2. Si quieres conservarla, pulsa **Exportar**: el móvil descarga el fichero tal cual.
3. Conviértelo y colócalo en el repositorio:

   ```bash
   tools/encode-audio.sh ~/Descargas/conc-cazador-de-sonidos.webm
   ```

   Genera `data/audio/<id>.mp3` en mono, 24 kHz y 48 kbps.
4. Añade `"audio": "data/audio/<id>.mp3"` al juego y súbelo. Ya puedes borrar la grabación
   local desde Ajustes.

Ese MP3 sirve igual para una futura skill de Alexa, que es justo el formato que admite SSML.

## Publicar

En **Settings → Pages** del repositorio, elige la rama y la carpeta raíz. La app queda en
`https://<usuario>.github.io/Juegos-M/`. Desde el móvil, el menú del navegador permite
añadirla a la pantalla de inicio: se abre a pantalla completa y funciona sin cobertura.

## Probar en local

```bash
python3 -m http.server 8000
# y abre http://localhost:8000
```

El micrófono y el service worker necesitan `localhost` o HTTPS; abriendo el fichero
directamente con `file://` no funcionan.

## Estructura

```
index.html        Las tres vistas
styles.css        Diseño móvil
app.js            Sorteo, voz, grabación, temporizador y persistencia
data/games.json   El catálogo
data/audio/       Locuciones definitivas
tools/            Validador, conversor de audio y generador de iconos
docs/alexa.md     Cómo sería llevar esto a Alexa
```

## Un aviso

Las grabaciones y los favoritos viven solo en este móvil, sin copia en ningún servidor.
Si borras los datos del navegador o desinstalas la app, se van con ellos. Exporta lo que
quieras conservar.
