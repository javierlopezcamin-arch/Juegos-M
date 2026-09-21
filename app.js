/* Tótem — elige tema, gira y sale un juego al azar.
   Sin dependencias, sin compilación: todo vive en este fichero. */
(function () {
  'use strict';

  var APP_VERSION = '3';
  var CATALOG_URL = 'data/games.json';
  var DEFAULT_DURATION = 10;
  var HISTORY_MAX = 20;
  var K = {
    fav: 'totem:v1:favorites',
    history: 'totem:v1:history',
    bag: 'totem:v1:bag',
    stickers: 'totem:v1:stickers',
    settings: 'totem:v1:settings'
  };

  /* ---------------- almacenamiento tolerante a fallos ---------------- */

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* modo privado */ }
  }

  /* ---------------- grabaciones en IndexedDB ---------------- */

  var DB_NAME = 'totem-audio';
  var STORE = 'recordings';
  var dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve) {
        if (!('indexedDB' in window)) return resolve(null);
        var req;
        try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return resolve(null); }
        req.onupgradeneeded = function () {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      });
    }
    return dbPromise;
  }

  /* Cada llamada dice si de verdad se ha escrito o solo si no ha reventado:
     "resuelve sin fallar" y "ha guardado algo" no son la misma pregunta,
     y confundirlas es como acabó mostrándose "guardado" cuando no lo estaba. */
  function idb(mode, fn) {
    return db().then(function (d) {
      if (!d) return { ok: false, value: null };
      return new Promise(function (resolve) {
        var tx, result;
        try {
          tx = d.transaction(STORE, mode);
          result = fn(tx.objectStore(STORE));
        } catch (e) { return resolve({ ok: false, value: null }); }
        tx.oncomplete = function () { resolve({ ok: true, value: result && 'result' in result ? result.result : null }); };
        tx.onerror = function () { resolve({ ok: false, value: null }); };
        tx.onabort = function () { resolve({ ok: false, value: null }); };
      });
    }).catch(function () { return { ok: false, value: null }; });
  }

  function recGet(id) {
    return idb('readonly', function (s) { return s.get(id); }).then(function (r) { return r.value; });
  }
  function recKeys() {
    return idb('readonly', function (s) { return s.getAllKeys(); }).then(function (r) { return r.value || []; });
  }
  function recDelete(id) {
    return idb('readwrite', function (s) { return s.delete(id); }).then(function (r) { return r.ok; });
  }

  /* Guardar no basta con que la transacción no falle: se comprueba releyendo,
     porque algunos navegadores dan por completada una escritura que luego,
     al recargar, no está. Si la relectura no trae el mismo audio, es un fallo. */
  function recPut(rec) {
    return idb('readwrite', function (s) { return s.put(rec); }).then(function (r) {
      if (!r.ok) return false;
      return recGet(rec.id).then(function (back) { return !!(back && back.blob && back.blob.size === rec.blob.size); });
    });
  }

  /* ---------------- estado ---------------- */

  var state = {
    themes: [],
    byTheme: {},
    byId: {},
    theme: null,
    surprise: false,
    game: null,
    busy: false,   // hay un giro o una celebración en marcha: ignora un segundo toque
    favorites: load(K.fav, []),
    history: load(K.history, []),
    bag: load(K.bag, {}),
    stickers: load(K.stickers, []),
    settings: Object.assign({ voice: true, rate: 1, sounds: true, allSteps: false }, load(K.settings, {})),
    recorded: []
  };

  /* ---------------- utilidades ---------------- */

  function $(id) { return document.getElementById(id); }

  function slugify(text) {
    return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function randomInt(n) { return Math.floor(Math.random() * n); }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = randomInt(i + 1);
      var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    }
    return list;
  }

  var ICONS = {
    diana: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.6"/>',
    chispa: '<path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z"/>',
    corazon: '<path d="M12 20s-7-4.6-7-9.3A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.7C19 15.4 12 20 12 20z"/>',
    brujula: '<circle cx="12" cy="12" r="8.5"/><path d="M15.2 8.8l-1.7 4.7-4.7 1.7 1.7-4.7z"/>'
  };

  function svgIcon(name) {
    var inner = ICONS[name];
    return inner ? '<svg viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg>' : '';
  }

  var toastTimer = null;
  function toast(message) {
    var el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  /* ---------------- catálogo ---------------- */

  function normalize(raw) {
    var themes = (raw.themes || []).map(function (t) {
      return {
        id: t.id || slugify(t.name),
        name: t.name || t.id,
        color: t.color || '#c8a06a',
        icon: t.icon || '',
        subtitle: t.subtitle || ''
      };
    });
    var known = {};
    themes.forEach(function (t) { known[t.id] = true; });

    var games = (raw.games || []).filter(function (g) {
      return g && g.title && known[g.theme] && Array.isArray(g.steps) && g.steps.length;
    }).map(function (g) {
      var duration = Number(g.duration);
      return {
        id: g.id || slugify(g.title),
        theme: g.theme,
        title: g.title,
        duration: duration > 0 ? duration : DEFAULT_DURATION,
        steps: g.steps.map(String),
        script: g.script || g.steps.join(' '),
        audio: g.audio || null,
        players: g.players || '',
        ages: g.ages || '',
        materials: g.materials || [],
        tags: g.tags || []
      };
    });
    return { themes: themes, games: games };
  }

  function loadCatalog() {
    return fetch(CATALOG_URL, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    }).then(function (raw) {
      var data = normalize(raw);
      state.themes = data.themes;
      state.byTheme = {};
      state.byId = {};
      data.themes.forEach(function (t) { state.byTheme[t.id] = []; });
      data.games.forEach(function (g) {
        state.byId[g.id] = g;
        state.byTheme[g.theme].push(g);
      });
      return data;
    });
  }

  /* ---------------- bolsa barajada por tema ---------------- */

  function poolIds(themeId) {
    return (state.byTheme[themeId] || []).map(function (g) { return g.id; });
  }

  function bagFor(themeId) {
    var pool = poolIds(themeId);
    var entry = state.bag[themeId];
    if (!entry || !Array.isArray(entry.pending) || !Array.isArray(entry.seen)) {
      entry = { pending: shuffle(pool.slice()), seen: [] };
    } else {
      entry.pending = entry.pending.filter(function (id) { return pool.indexOf(id) !== -1; });
      entry.seen = entry.seen.filter(function (id) { return pool.indexOf(id) !== -1; });
      var known = entry.pending.concat(entry.seen);
      pool.forEach(function (id) {
        if (known.indexOf(id) === -1) entry.pending.splice(randomInt(entry.pending.length + 1), 0, id);
      });
    }
    state.bag[themeId] = entry;
    return entry;
  }

  function draw(themeId) {
    var pool = poolIds(themeId);
    if (!pool.length) return null;
    var entry = bagFor(themeId);

    if (!entry.pending.length) {
      var last = entry.seen[entry.seen.length - 1];
      var next = shuffle(pool.slice());
      if (next.length > 1 && next[0] === last) {
        var swap = 1 + randomInt(next.length - 1);
        next[0] = next[swap]; next[swap] = last;
      }
      entry.pending = next;
      entry.seen = [];
    }

    var id = entry.pending.shift();
    entry.seen.push(id);
    save(K.bag, state.bag);
    return state.byId[id];
  }

  function returnToBag(game) {
    var entry = state.bag[game.theme];
    if (!entry) return;
    var seen = entry.seen.lastIndexOf(game.id);
    if (seen !== -1) entry.seen.splice(seen, 1);
    if (entry.pending.indexOf(game.id) === -1) {
      // Vuelve a la cola, pero no a los primeros puestos: si no, reaparece enseguida.
      var floor = Math.min(2, entry.pending.length);
      entry.pending.splice(floor + randomInt(entry.pending.length - floor + 1), 0, game.id);
    }
    save(K.bag, state.bag);
  }

  /* ---------------- favoritos, historial y pegatinas ---------------- */

  function isFavorite(id) { return state.favorites.indexOf(id) !== -1; }

  function toggleFavorite(id) {
    var i = state.favorites.indexOf(id);
    if (i === -1) state.favorites.push(id); else state.favorites.splice(i, 1);
    save(K.fav, state.favorites);
    return isFavorite(id);
  }

  function pushHistory(id) {
    state.history.unshift({ id: id, at: Date.now() });
    state.history = state.history.slice(0, HISTORY_MAX);
    save(K.history, state.history);
  }

  function addSticker(game) {
    state.stickers.push({ id: game.id, theme: game.theme, at: Date.now() });
    if (state.stickers.length > 200) state.stickers = state.stickers.slice(-200);
    save(K.stickers, state.stickers);
    return state.stickers.length;
  }

  /* ---------------- reproducción: grabación, mp3 o voz del sistema ---------------- */

  /* state: 'idle' (nada sonando), 'playing' o 'paused'.
     mode: 'audio' (grabación o mp3, con Audio real) o 'speech' (voz del sistema).
     Pausar no debe perder el sitio: por eso stopPlayback (fin de verdad, se
     cambia de juego) y pausePlayback (fin momentáneo, se puede seguir) son
     dos cosas distintas y no la misma llamada disfrazada. */
  var player = { audio: null, url: null, mode: null, state: 'idle' };

  function updateListenButton() {
    var btn = $('btn-listen');
    var label = $('btn-listen-label');
    btn.classList.toggle('is-on', player.state !== 'idle');
    if (player.state === 'playing') label.textContent = 'Pausar';
    else if (player.state === 'paused') label.textContent = 'Seguir';
    else label.textContent = 'Escuchar';
  }

  function stopPlayback() {
    if (player.audio) { player.audio.pause(); player.audio = null; }
    if (player.url) { URL.revokeObjectURL(player.url); player.url = null; }
    if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) {} }
    player.mode = null;
    player.state = 'idle';
    updateListenButton();
  }

  function pausePlayback() {
    if (player.state !== 'playing') return;
    if (player.mode === 'audio' && player.audio) player.audio.pause();
    else if (player.mode === 'speech' && 'speechSynthesis' in window) {
      try { speechSynthesis.pause(); } catch (e) {}
    }
    player.state = 'paused';
    updateListenButton();
  }

  function resumePlayback() {
    if (player.state !== 'paused') return;
    if (player.mode === 'audio' && player.audio) {
      player.audio.play().catch(function () { stopPlayback(); });
    } else if (player.mode === 'speech' && 'speechSynthesis' in window) {
      try { speechSynthesis.resume(); } catch (e) { stopPlayback(); return; }
    } else {
      stopPlayback();
      return;
    }
    player.state = 'playing';
    updateListenButton();
  }

  function playBlob(blob) {
    player.url = URL.createObjectURL(blob);
    playUrl(player.url, null);
  }

  function playUrl(url, onError) {
    var audio = new Audio(url);
    player.audio = audio;
    player.mode = 'audio';
    audio.onended = function () { stopPlayback(); };
    audio.onerror = function () {
      player.audio = null;
      if (onError) onError(); else stopPlayback();
    };
    audio.play().catch(function () {
      player.audio = null;
      if (onError) onError(); else stopPlayback();
    });
    player.state = 'playing';
    updateListenButton();
  }

  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    var voices = speechSynthesis.getVoices() || [];
    var exact = voices.filter(function (v) { return v.lang && v.lang.toLowerCase() === 'es-es'; });
    if (exact.length) return exact[0];
    var any = voices.filter(function (v) { return v.lang && v.lang.toLowerCase().indexOf('es') === 0; });
    return any.length ? any[0] : null;
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) { toast('Este navegador no lee en voz alta'); return; }
    var utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'es-ES';
    utter.rate = state.settings.rate;
    var voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.onend = function () { stopPlayback(); };
    utter.onerror = function () { stopPlayback(); };
    try {
      speechSynthesis.cancel();
      speechSynthesis.speak(utter);
      player.mode = 'speech';
      player.state = 'playing';
      updateListenButton();
    } catch (e) { toast('No se pudo leer la consigna'); }
  }

  function listen(game) {
    stopPlayback();
    recGet(game.id).then(function (rec) {
      if (rec && rec.blob) { playBlob(rec.blob); return; }
      if (game.audio) {
        playUrl(game.audio, function () { speak(game.script); });
        return;
      }
      speak(game.script);
    });
  }

  /* ---------------- grabadora ---------------- */

  var rec = { recorder: null, stream: null, chunks: [], blob: null };

  function extFor(mime) {
    if (!mime) return 'webm';
    if (mime.indexOf('mp4') !== -1) return 'm4a';
    if (mime.indexOf('ogg') !== -1) return 'ogg';
    if (mime.indexOf('wav') !== -1) return 'wav';
    return 'webm';
  }

  function pickMime() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  function startRecording() {
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      toast('Este navegador no permite grabar');
      return;
    }
    stopPlayback();
    sound.muted = true;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      rec.stream = stream;
      rec.chunks = [];
      var mime = pickMime();
      rec.recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      rec.recorder.ondataavailable = function (e) { if (e.data && e.data.size) rec.chunks.push(e.data); };
      rec.recorder.onstop = function () {
        var type = rec.recorder.mimeType || mime || 'audio/webm';
        var blob = new Blob(rec.chunks, { type: type });
        rec.stream.getTracks().forEach(function (t) { t.stop(); });
        rec.stream = null;
        rec.recorder = null;
        sound.muted = false;
        if (!state.game || !blob.size) { renderRecorder(); return; }
        recPut({ id: state.game.id, blob: blob, mime: type, at: Date.now() }).then(function (ok) {
          if (!ok) {
            renderRecorder();
            toast('No se pudo guardar la grabación en este dispositivo');
            return;
          }
          return refreshRecorded().then(function () {
            renderRecorder();
            toast('Grabación guardada en este móvil');
          });
        });
      };
      rec.recorder.start();
      renderRecorder();
    }).catch(function () {
      sound.muted = false;
      toast('No se pudo acceder al micrófono');
    });
  }

  function stopRecording() {
    if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop();
  }

  function isRecording() { return !!(rec.recorder && rec.recorder.state === 'recording'); }

  /* En iOS, un <a download> sobre un blob que Safari no sabe previsualizar
     (como un webm) abre una vista de pantalla completa que se queda ahí
     parada, sin forma de que la página la cierre: hay que pulsar la X a
     mano. El panel nativo de compartir no tiene ese problema, así que es
     la vía preferida siempre que el navegador lo permita con ficheros. */
  var exportHintShown = false;

  function exportRecording(id, title) {
    recGet(id).then(function (found) {
      if (!found || !found.blob) { toast('Aquí no hay ninguna grabación'); return; }
      var name = (id || slugify(title)) + '.' + extFor(found.mime);

      if (navigator.share && navigator.canShare) {
        try {
          var file = new File([found.blob], name, { type: found.mime || 'application/octet-stream' });
          if (navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: title || 'Grabación' }).catch(function () {
              /* el usuario cierra el panel sin elegir nada: no es un error */
            });
            return;
          }
        } catch (e) { /* seguimos por la vía clásica */ }
      }

      downloadBlob(found.blob, name);
    });
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    if (!exportHintShown) {
      exportHintShown = true;
      toast('Si la pantalla se queda en la vista previa, toca la X de arriba para volver');
    }
  }

  function refreshRecorded() {
    return recKeys().then(function (keys) {
      state.recorded = keys || [];
      renderSettings();
      return state.recorded;
    });
  }

  /* ---------------- temporizador ---------------- */

  var timer = { handle: null, endsAt: 0, total: 0, done: false, lock: null };

  function fmt(ms) {
    var total = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function requestLock() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request('screen').then(function (lock) { timer.lock = lock; }).catch(function () {});
  }

  function releaseLock() {
    if (timer.lock) { try { timer.lock.release(); } catch (e) {} timer.lock = null; }
  }

  function startTimer(minutes) {
    stopTimer(true);
    timer.total = minutes * 60000;
    timer.endsAt = Date.now() + timer.total;
    timer.done = false;
    $('timer').hidden = false;
    $('timer').classList.remove('is-done');
    $('btn-timer-start').classList.add('is-on');
    tickTimer();
    timer.handle = setInterval(tickTimer, 250);
    requestLock();
    sound.play('timer');
  }

  function tickTimer() {
    var left = timer.endsAt - Date.now();
    $('timer-time').textContent = fmt(left);
    $('timer-fill').style.width = Math.max(0, Math.min(100, (left / timer.total) * 100)) + '%';
    if (left <= 0 && !timer.done) finishTimer();
  }

  function finishTimer() {
    timer.done = true;
    clearInterval(timer.handle);
    timer.handle = null;
    releaseLock();
    $('timer').classList.add('is-done');
    $('timer-time').textContent = '00:00';
    if (navigator.vibrate) { try { navigator.vibrate([220, 120, 220]); } catch (e) {} }
    sound.play('done');
    toast('Se acabó el tiempo');
  }

  function stopTimer(silent) {
    clearInterval(timer.handle);
    timer.handle = null;
    timer.done = false;
    releaseLock();
    $('timer').hidden = true;
    $('timer').classList.remove('is-done');
    $('btn-timer-start').classList.remove('is-on');
    if (!silent) $('timer-fill').style.width = '100%';
  }

  /* ---------------- sonidos del tótem ----------------
     Se sintetizan aquí mismo: ni ficheros que descargar ni dependencias. */

  var sound = {
    ctx: null,
    muted: false,

    unlock: function () {
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (!this.ctx) this.ctx = new Ctx();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      } catch (e) { return null; }
    },

    note: function (freq, at, dur, type, gain, slideTo) {
      var ctx = this.ctx;
      var t0 = ctx.currentTime + 0.02 + at;   // margen para no programar sobre el instante actual
      var osc = ctx.createOscillator();
      var amp = ctx.createGain();
      osc.type = type || 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      amp.gain.setValueAtTime(0.0001, t0);
      amp.gain.exponentialRampToValueAtTime(gain || 0.09, t0 + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(amp);
      amp.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    },

    play: function (name) {
      if (!state.settings.sounds || this.muted) return;
      var ctx = this.unlock();
      if (!ctx) return;
      var self = this;
      if (ctx.state !== 'running' && ctx.resume) {
        ctx.resume().then(function () { self.render(name); }).catch(function () {});
        return;
      }
      this.render(name);
    },

    render: function (name) {
      var i;
      switch (name) {
        case 'tap':
          this.note(660, 0, 0.07, 'triangle', 0.05);
          break;
        case 'spin':
          // Una rueda que corre y va frenando, dentro de los 0,7 s de la animación.
          var at = 0, gap = 0.028;
          for (i = 0; i < 10; i++) {
            this.note(300 + i * 46, at, 0.05, 'square', 0.035);
            at += gap;
            gap *= 1.18;
          }
          break;
        case 'reveal':
          this.note(130.8, 0, 0.35, 'sine', 0.1);
          [523.25, 659.25, 783.99, 1046.5].forEach(function (f, n) {
            sound.note(f, 0.04 + n * 0.075, 0.38, 'triangle', 0.1);
          });
          break;
        case 'fav':
          this.note(659.25, 0, 0.1, 'triangle', 0.09);
          this.note(987.77, 0.08, 0.16, 'triangle', 0.09);
          break;
        case 'unfav':
          this.note(659.25, 0, 0.1, 'triangle', 0.07);
          this.note(440, 0.08, 0.16, 'triangle', 0.07);
          break;
        case 'stamp':
          [659.25, 880, 1174.66].forEach(function (f, n) {
            sound.note(f, n * 0.09, 0.32, 'triangle', 0.11);
          });
          this.note(1567.98, 0.3, 0.4, 'sine', 0.07);
          break;
        case 'timer':
          this.note(523.25, 0, 0.09, 'square', 0.05);
          this.note(783.99, 0.1, 0.14, 'square', 0.05);
          break;
        case 'done':
          // Fanfarria corta, repetida una vez.
          [0, 0.62].forEach(function (offset) {
            [783.99, 987.77, 1174.66, 1567.98].forEach(function (f, n) {
              sound.note(f, offset + n * 0.12, 0.3, 'triangle', 0.12);
            });
            sound.note(196, offset, 0.5, 'sine', 0.09);
          });
          break;
      }
    }
  };

  /* ---------------- vistas ---------------- */

  var VIEWS = { home: 'view-home', play: 'view-play', settings: 'view-settings' };
  var current = 'home';

  function showView(name, push) {
    if (current === 'play' && name !== 'play') { stopPlayback(); stopRecording(); }
    Object.keys(VIEWS).forEach(function (key) {
      var el = $(VIEWS[key]);
      var active = key === name;
      el.classList.toggle('is-active', active);
      el.hidden = !active;
    });
    current = name;
    if (name === 'settings') renderSettings();
    if (push !== false) {
      try { history.pushState({ view: name }, ''); } catch (e) {}
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('popstate', function (e) {
    var view = (e.state && e.state.view) || 'home';
    showView(view, false);
  });

  /* ---------------- pintado ---------------- */

  function setThemeColor(color) {
    document.documentElement.style.setProperty('--theme', color || '#c8a06a');
  }

  function renderThemes() {
    var wrap = $('themes');
    wrap.textContent = '';
    state.themes.forEach(function (theme, index) {
      var count = (state.byTheme[theme.id] || []).length;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme';
      btn.style.setProperty('--c', theme.color);
      // Las bandas de los extremos son más estrechas: así la pila parece un tótem.
      var middle = (state.themes.length - 1) / 2;
      var width = middle ? 100 - 15 * (Math.abs(middle - index) / middle) : 100;
      btn.style.setProperty('--w', width.toFixed(1) + '%');
      btn.innerHTML = '<span class="theme__icon">' + svgIcon(theme.icon) + '</span>' +
        '<span class="theme__text"><span class="theme__name"></span>' +
        '<span class="theme__sub"></span></span>' +
        '<span class="theme__count">' + count + '</span>';
      btn.querySelector('.theme__name').textContent = theme.name;
      btn.querySelector('.theme__sub').textContent = theme.subtitle;
      btn.addEventListener('click', function () { openTheme(theme.id, false); });
      wrap.appendChild(btn);
    });
  }

  function openTheme(themeId, surprise) {
    var theme = state.themes.filter(function (t) { return t.id === themeId; })[0];
    if (!theme) return;
    state.theme = theme;
    state.surprise = !!surprise;
    state.game = null;
    setThemeColor(theme.color);
    $('play-theme').textContent = surprise ? 'Sorpréndeme' : theme.name;
    resetToSpin();
    showView('play');
  }

  function resetToSpin() {
    state.game = null;
    state.busy = false;
    $('card').hidden = true;
    $('actions').hidden = true;
    $('decide').hidden = true;
    $('recorder').hidden = true;
    $('reel').hidden = true;
    $('btn-fav').hidden = true;
    $('btn-spin').hidden = false;
    stopPlayback();
    stopTimer(true);
  }

  function randomTheme() {
    var withGames = state.themes.filter(function (t) { return (state.byTheme[t.id] || []).length; });
    if (!withGames.length) return null;
    return withGames[randomInt(withGames.length)];
  }

  function spin() {
    // Un segundo toque mientras la rueda todavía gira no debe robar un
    // segundo juego de la bolsa sin que nadie llegue a verlo.
    if (state.busy) return;
    var themeId = state.theme ? state.theme.id : null;
    if (state.surprise) {
      var t = randomTheme();
      if (!t) return;
      themeId = t.id;
      setThemeColor(t.color);
    }
    var game = draw(themeId);
    if (!game) { toast('Este tema todavía no tiene juegos'); return; }

    state.busy = true;
    sound.play('spin');

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { showGame(game); return; }
    runReel(themeId, game, function () { showGame(game); });
  }

  /* La ficha elegida llega como en una tragaperras que va frenando. */
  var ROW = 62;

  function runReel(themeId, winner, done) {
    var reel = $('reel');
    var track = $('reel-track');
    var others = (state.byTheme[themeId] || []).filter(function (g) { return g.id !== winner.id; });
    var names = shuffle(others.slice()).slice(0, 7).map(function (g) { return g.title; });
    if (!names.length) names = [winner.title, winner.title];
    names.push(winner.title);

    track.textContent = '';
    names.forEach(function (name, i) {
      var row = document.createElement('div');
      row.className = 'reel__item' + (i === names.length - 1 ? ' is-win' : '');
      row.textContent = name;
      track.appendChild(row);
    });

    $('btn-spin').hidden = true;
    $('card').hidden = true;
    reel.hidden = false;
    track.style.transition = 'none';
    track.style.transform = 'translateY(0)';
    void track.offsetHeight;
    track.style.transition = 'transform 1.05s cubic-bezier(.16,.72,.18,1)';
    track.style.transform = 'translateY(-' + ((names.length - 2) * ROW) + 'px)';

    setTimeout(function () { reel.hidden = true; done(); }, 1090);
  }

  function showGame(game) {
    state.game = game;
    state.busy = false;
    stopPlayback();
    stopTimer(true);
    $('btn-spin').hidden = true;
    $('reel').hidden = true;
    $('card').hidden = false;
    $('actions').hidden = false;
    $('decide').hidden = false;
    $('btn-fav').hidden = false;

    var themeName = (state.themes.filter(function (t) { return t.id === game.theme; })[0] || {}).name || '';
    var meta = [];
    if (state.surprise && themeName) meta.push(themeName);
    meta.push(game.duration + ' min');
    if (game.players) meta.push(game.players);
    $('card-meta').textContent = meta.join(' · ');

    var needs = [];
    if (game.ages) needs.push(game.ages.charAt(0).toUpperCase() + game.ages.slice(1));
    if (game.materials && game.materials.length) needs.push('Necesitas: ' + enumerate(game.materials));
    $('card-needs').textContent = needs.join(' · ');
    $('card-needs').hidden = !needs.length;
    $('card-title').textContent = game.title;

    var list = $('card-steps');
    list.textContent = '';
    game.steps.forEach(function (step) {
      var li = document.createElement('li');
      li.textContent = step;
      list.appendChild(li);
    });
    steps.list = game.steps;
    steps.index = 0;
    renderStep();
    setStepsMode(!!state.settings.allSteps);

    $('btn-fav').setAttribute('aria-pressed', isFavorite(game.id) ? 'true' : 'false');
    sound.play('reveal');
    renderRecorder();
    $('recorder').hidden = true;

    if (state.settings.voice) listen(game);
  }

  var steps = { list: [], index: 0, all: false };

  function renderStep() {
    var list = steps.list;
    $('stepper-text').textContent = list[steps.index] || '';
    $('stepper-hint').textContent = list.length < 2 ? ''
      : (steps.index === list.length - 1 ? 'Toca para volver al primero' : 'Toca para el siguiente paso');

    var dots = $('dots');
    dots.textContent = '';
    if (list.length > 1) {
      list.forEach(function (_, i) {
        var dot = document.createElement('span');
        dot.className = 'dot' + (i === steps.index ? ' is-on' : '');
        dots.appendChild(dot);
      });
    }
  }

  function setStepsMode(all) {
    steps.all = all;
    $('stepper').hidden = all;
    $('dots').hidden = all;
    $('card-steps').hidden = !all;
    $('btn-all-steps').textContent = all ? 'Ver paso a paso' : 'Ver todos los pasos';
  }

  function markDone() {
    // Igual que en spin(): un segundo toque mientras se celebra la pegatina
    // no debe volver a contar el mismo juego como jugado otra vez.
    if (state.busy) return;
    var game = state.game;
    if (!game) return;
    state.busy = true;
    pushHistory(game.id);
    var total = addSticker(game);
    stopPlayback();
    stopTimer(true);
    sound.play('stamp');
    showStamp(game, total);
  }

  function showStamp(game, total) {
    var theme = state.themes.filter(function (t) { return t.id === game.theme; })[0];
    $('stamp-art').innerHTML = svgIcon(theme ? theme.icon : '');
    $('stamp-art').style.setProperty('--c', theme ? theme.color : '#c8a06a');
    $('stamp-label').textContent = total === 1 ? 'Tu primera pegatina' : 'Ya van ' + total + ' pegatinas';
    $('stamp').hidden = false;
    setTimeout(function () {
      $('stamp').hidden = true;
      resetToSpin();
    }, 1700);
  }

  function openGameById(id) {
    var game = state.byId[id];
    if (!game) { toast('Ese juego ya no está en el catálogo'); return; }
    var theme = state.themes.filter(function (t) { return t.id === game.theme; })[0];
    state.theme = theme || null;
    state.surprise = false;
    setThemeColor(theme ? theme.color : null);
    $('play-theme').textContent = theme ? theme.name : '';
    showView('play');
    showGame(game);
  }

  function renderRecorder() {
    var has = state.game && state.recorded.indexOf(state.game.id) !== -1;
    var recording = isRecording();
    $('btn-rec-toggle').textContent = recording ? 'Parar' : (has ? 'Grabar otra vez' : 'Grabar');
    $('btn-rec-toggle').classList.toggle('is-recording', recording);
    $('btn-rec-play').hidden = !has || recording;
    $('btn-rec-export').hidden = !has || recording;
    $('btn-rec-delete').hidden = !has || recording;
    $('recorder-state').textContent = recording
      ? 'Grabando… habla y pulsa Parar al terminar.'
      : (has ? 'Tienes tu voz guardada para este juego.' : 'Graba la consigna con tu voz.');
    $('btn-record').classList.toggle('is-on', !!has);
  }

  function renderSettings() {
    $('set-voice').checked = !!state.settings.voice;
    $('set-sounds').checked = !!state.settings.sounds;
    $('set-rate').value = state.settings.rate;
    $('set-rate-value').textContent = Number(state.settings.rate).toFixed(1);

    $('count-stamps').textContent = state.stickers.length;
    var board = $('board');
    board.textContent = '';
    state.stickers.slice(-72).forEach(function (stamp) {
      var theme = state.themes.filter(function (t) { return t.id === stamp.theme; })[0];
      var el = document.createElement('span');
      el.className = 'sticker';
      el.style.setProperty('--c', theme ? theme.color : '#c8a06a');
      el.innerHTML = svgIcon(theme ? theme.icon : '');
      var game = state.byId[stamp.id];
      if (game) el.title = game.title;
      board.appendChild(el);
    });

    var favs = state.favorites.filter(function (id) { return state.byId[id]; });
    $('count-fav').textContent = favs.length;
    fillList($('list-fav'), favs.map(function (id) {
      return { id: id, name: state.byId[id].title, note: themeName(state.byId[id].theme) };
    }), 'Abrir');

    var recs = state.recorded.filter(function (id) { return state.byId[id]; });
    $('count-rec').textContent = recs.length;
    fillList($('list-rec'), recs.map(function (id) {
      return { id: id, name: state.byId[id].title, note: 'grabación en este móvil' };
    }), 'Exportar', function (id) { exportRecording(id); });

    var seen = {};
    var history = state.history.filter(function (h) {
      if (!state.byId[h.id] || seen[h.id]) return false;
      seen[h.id] = true;
      return true;
    }).slice(0, 10);
    fillList($('list-history'), history.map(function (h) {
      return { id: h.id, name: state.byId[h.id].title, note: when(h.at) };
    }), 'Abrir');

    var total = Object.keys(state.byId).length;
    $('catalog-info').textContent = total + ' juegos en ' + state.themes.length +
      ' temas, versión ' + APP_VERSION + '. Para añadir más, edita data/games.json.';
  }

  function enumerate(items) {
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(', ') + ' y ' + items[items.length - 1];
  }

  function themeName(id) {
    var t = state.themes.filter(function (x) { return x.id === id; })[0];
    return t ? t.name : '';
  }

  function when(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return 'hace un momento';
    if (diff < 3600000) return 'hace ' + Math.round(diff / 60000) + ' min';
    if (diff < 86400000) return 'hace ' + Math.round(diff / 3600000) + ' h';
    return 'hace ' + Math.round(diff / 86400000) + ' días';
  }

  function fillList(ul, items, actionLabel, action) {
    ul.textContent = '';
    items.forEach(function (item) {
      var li = document.createElement('li');
      var name = document.createElement('span');
      name.className = 'list__name';
      name.textContent = item.name;
      var small = document.createElement('small');
      small.textContent = item.note;
      name.appendChild(small);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'list__go';
      btn.textContent = actionLabel;
      btn.addEventListener('click', function () {
        if (action) action(item.id); else openGameById(item.id);
      });
      li.appendChild(name);
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  /* ---------------- eventos ---------------- */

  function wire() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button') : null;
      if (!btn) return;
      sound.unlock();
      if (btn.getAttribute('data-sound') !== 'off') sound.play('tap');
    }, true);

    $('btn-surprise').addEventListener('click', function () {
      var t = randomTheme();
      if (!t) return;
      openTheme(t.id, true);
    });
    $('btn-settings').addEventListener('click', function () { showView('settings'); });
    $('btn-back').addEventListener('click', function () { history.back(); });
    $('btn-back-settings').addEventListener('click', function () { history.back(); });
    $('btn-spin').addEventListener('click', spin);

    $('btn-again').addEventListener('click', function () {
      // Descartar no gasta: el juego vuelve a la bolsa.
      if (state.game) returnToBag(state.game);
      spin();
    });

    $('btn-done').addEventListener('click', markDone);

    $('stepper').addEventListener('click', function () {
      if (steps.list.length < 2) return;
      steps.index = (steps.index + 1) % steps.list.length;
      renderStep();
    });

    $('btn-all-steps').addEventListener('click', function () {
      setStepsMode(!steps.all);
      state.settings.allSteps = steps.all;
      save(K.settings, state.settings);
    });

    $('btn-listen').addEventListener('click', function () {
      if (!state.game) return;
      if (player.state === 'playing') pausePlayback();
      else if (player.state === 'paused') resumePlayback();
      else listen(state.game);
    });

    $('btn-record').addEventListener('click', function () {
      var panel = $('recorder');
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderRecorder();
    });

    $('btn-rec-toggle').addEventListener('click', function () {
      if (isRecording()) stopRecording(); else startRecording();
    });

    $('btn-rec-play').addEventListener('click', function () {
      if (!state.game) return;
      stopPlayback();
      recGet(state.game.id).then(function (found) {
        if (found && found.blob) playBlob(found.blob);
      });
    });

    $('btn-rec-export').addEventListener('click', function () {
      if (state.game) exportRecording(state.game.id, state.game.title);
    });

    $('btn-rec-delete').addEventListener('click', function () {
      if (!state.game) return;
      recDelete(state.game.id).then(function (ok) {
        return refreshRecorded().then(function () {
          renderRecorder();
          toast(ok ? 'Grabación borrada' : 'No se pudo borrar la grabación');
        });
      });
    });

    $('btn-timer-start').addEventListener('click', function () {
      if (!state.game) return;
      if (timer.handle || timer.done) stopTimer();
      else startTimer(state.game.duration);
    });
    $('btn-timer-stop').addEventListener('click', function () { stopTimer(); });

    $('btn-fav').addEventListener('click', function () {
      if (!state.game) return;
      var now = toggleFavorite(state.game.id);
      $('btn-fav').setAttribute('aria-pressed', now ? 'true' : 'false');
      sound.play(now ? 'fav' : 'unfav');
      toast(now ? 'Guardado en favoritos' : 'Quitado de favoritos');
    });

    $('btn-test-sound').addEventListener('click', function () {
      if (!state.settings.sounds) { toast('Enciende los sonidos para probarlos'); return; }
      sound.play('done');
    });

    $('set-sounds').addEventListener('change', function (e) {
      state.settings.sounds = e.target.checked;
      save(K.settings, state.settings);
      if (state.settings.sounds) sound.play('fav');
    });

    $('set-voice').addEventListener('change', function (e) {
      state.settings.voice = e.target.checked;
      save(K.settings, state.settings);
    });

    $('set-rate').addEventListener('input', function (e) {
      state.settings.rate = Number(e.target.value);
      $('set-rate-value').textContent = state.settings.rate.toFixed(1);
      save(K.settings, state.settings);
    });

    $('btn-reset-bag').addEventListener('click', function () {
      state.bag = {};
      save(K.bag, state.bag);
      toast('El sorteo empieza de cero');
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stopPlayback(); return; }
      if (timer.handle) { tickTimer(); requestLock(); }
    });
  }

  /* ---------------- arranque ---------------- */

  function start() {
    wire();
    if ('speechSynthesis' in window) {
      speechSynthesis.onvoiceschanged = function () { pickVoice(); };
    }
    loadCatalog().then(function () {
      renderThemes();
      return refreshRecorded();
    }).catch(function () {
      $('themes').innerHTML = '<p class="panel__hint">No se pudo cargar el catálogo. ' +
        'Comprueba que data/games.json existe y es válido.</p>';
    });

    try { history.replaceState({ view: 'home' }, ''); } catch (e) {}

    /* Pide almacenamiento persistente donde el navegador lo ofrezca, para que
       las grabaciones tengan menos papeletas de que el sistema las borre solo
       por falta de espacio. Ni existe en todos los navegadores ni garantiza
       nada por sí sola, pero no hace daño intentarlo. */
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
