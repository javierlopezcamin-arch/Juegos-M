/* Tótem — elige tema, gira y sale un juego al azar.
   Sin dependencias, sin compilación: todo vive en este fichero. */
(function () {
  'use strict';

  var CATALOG_URL = 'data/games.json';
  var DEFAULT_DURATION = 10;
  var HISTORY_MAX = 20;
  var K = {
    fav: 'totem:v1:favorites',
    history: 'totem:v1:history',
    bag: 'totem:v1:bag',
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

  function idb(mode, fn) {
    return db().then(function (d) {
      if (!d) return null;
      return new Promise(function (resolve) {
        var tx = d.transaction(STORE, mode);
        var result = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(result && 'result' in result ? result.result : null); };
        tx.onerror = function () { resolve(null); };
        tx.onabort = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function recGet(id) { return idb('readonly', function (s) { return s.get(id); }); }
  function recPut(rec) { return idb('readwrite', function (s) { return s.put(rec); }); }
  function recDelete(id) { return idb('readwrite', function (s) { return s.delete(id); }); }
  function recKeys() { return idb('readonly', function (s) { return s.getAllKeys(); }); }

  /* ---------------- estado ---------------- */

  var state = {
    themes: [],
    byTheme: {},
    byId: {},
    theme: null,
    surprise: false,
    game: null,
    favorites: load(K.fav, []),
    history: load(K.history, []),
    bag: load(K.bag, {}),
    settings: Object.assign({ voice: true, rate: 1 }, load(K.settings, {})),
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
        materials: g.materials || []
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

  /* ---------------- favoritos e historial ---------------- */

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

  /* ---------------- reproducción: grabación, mp3 o voz del sistema ---------------- */

  var player = { audio: null, url: null, mode: null };

  function stopPlayback() {
    if (player.audio) { player.audio.pause(); player.audio = null; }
    if (player.url) { URL.revokeObjectURL(player.url); player.url = null; }
    if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) {} }
    player.mode = null;
    setListening(false);
  }

  function setListening(on) {
    var btn = $('btn-listen');
    btn.classList.toggle('is-on', on);
    $('btn-listen-label').textContent = on ? 'Parar' : 'Escuchar';
  }

  function playBlob(blob) {
    player.url = URL.createObjectURL(blob);
    playUrl(player.url, null);
  }

  function playUrl(url, onError) {
    var audio = new Audio(url);
    player.audio = audio;
    audio.onended = function () { stopPlayback(); };
    audio.onerror = function () {
      player.audio = null;
      if (onError) onError(); else stopPlayback();
    };
    audio.play().catch(function () {
      player.audio = null;
      if (onError) onError(); else stopPlayback();
    });
    setListening(true);
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
    utter.onend = function () { setListening(false); };
    utter.onerror = function () { setListening(false); };
    try { speechSynthesis.cancel(); speechSynthesis.speak(utter); setListening(true); }
    catch (e) { toast('No se pudo leer la consigna'); }
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
        if (!state.game || !blob.size) { renderRecorder(); return; }
        recPut({ id: state.game.id, blob: blob, mime: type, at: Date.now() }).then(function () {
          return refreshRecorded();
        }).then(function () {
          renderRecorder();
          toast('Grabación guardada en este móvil');
        });
      };
      rec.recorder.start();
      renderRecorder();
    }).catch(function () {
      toast('No se pudo acceder al micrófono');
    });
  }

  function stopRecording() {
    if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop();
  }

  function isRecording() { return !!(rec.recorder && rec.recorder.state === 'recording'); }

  function exportRecording(id, title) {
    recGet(id).then(function (found) {
      if (!found || !found.blob) { toast('Aquí no hay ninguna grabación'); return; }
      var url = URL.createObjectURL(found.blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = (id || slugify(title)) + '.' + extFor(found.mime);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
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
    beep();
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

  var audioCtx = null;
  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 528;
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1.2);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + 1.25);
    } catch (e) { /* sin sonido, queda la vibración */ }
  }

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
    state.themes.forEach(function (theme) {
      var count = (state.byTheme[theme.id] || []).length;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme';
      btn.style.setProperty('--c', theme.color);
      btn.innerHTML = '<span class="theme__count">' + count + '</span>' +
        '<span class="theme__name"></span><span class="theme__sub"></span>';
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
    $('stage').classList.remove('has-card');
    $('card').hidden = true;
    $('actions').hidden = true;
    $('recorder').hidden = true;
    $('btn-fav').hidden = true;
    $('btn-spin').hidden = false;
    stopTimer(true);
    showView('play');
  }

  function randomTheme() {
    var withGames = state.themes.filter(function (t) { return (state.byTheme[t.id] || []).length; });
    if (!withGames.length) return null;
    return withGames[randomInt(withGames.length)];
  }

  function spin() {
    var themeId = state.theme ? state.theme.id : null;
    if (state.surprise) {
      var t = randomTheme();
      if (!t) return;
      themeId = t.id;
      setThemeColor(t.color);
    }
    var game = draw(themeId);
    if (!game) { toast('Este tema todavía no tiene juegos'); return; }

    var btn = $('btn-spin');
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var delay = reduced ? 0 : 700;

    if (delay) {
      btn.classList.add('is-spinning');
      setTimeout(function () { btn.classList.remove('is-spinning'); showGame(game); }, delay);
    } else {
      showGame(game);
    }
  }

  function showGame(game) {
    state.game = game;
    stopPlayback();
    stopTimer(true);
    pushHistory(game.id);

    $('btn-spin').hidden = true;
    $('stage').classList.add('has-card');
    $('card').hidden = false;
    $('actions').hidden = false;
    $('btn-fav').hidden = false;

    var themeName = (state.themes.filter(function (t) { return t.id === game.theme; })[0] || {}).name || '';
    $('card-meta').textContent = (state.surprise ? themeName + ' · ' : '') + game.duration + ' min';
    $('card-title').textContent = game.title;

    var steps = $('card-steps');
    steps.textContent = '';
    game.steps.forEach(function (step) {
      var li = document.createElement('li');
      li.textContent = step;
      steps.appendChild(li);
    });

    $('btn-fav').setAttribute('aria-pressed', isFavorite(game.id) ? 'true' : 'false');
    renderRecorder();
    $('recorder').hidden = true;

    if (state.settings.voice) listen(game);
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
    $('set-rate').value = state.settings.rate;
    $('set-rate-value').textContent = Number(state.settings.rate).toFixed(1);

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
      ' temas. Para añadir más, edita data/games.json.';
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
    $('btn-surprise').addEventListener('click', function () {
      var t = randomTheme();
      if (!t) return;
      openTheme(t.id, true);
    });
    $('btn-settings').addEventListener('click', function () { showView('settings'); });
    $('btn-back').addEventListener('click', function () { history.back(); });
    $('btn-back-settings').addEventListener('click', function () { history.back(); });
    $('btn-spin').addEventListener('click', spin);
    $('btn-again').addEventListener('click', spin);

    $('btn-listen').addEventListener('click', function () {
      if (!state.game) return;
      if (player.audio || (window.speechSynthesis && speechSynthesis.speaking)) stopPlayback();
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
      recDelete(state.game.id).then(function () {
        refreshRecorded().then(renderRecorder);
        toast('Grabación borrada');
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
      toast(now ? 'Guardado en favoritos' : 'Quitado de favoritos');
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

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
