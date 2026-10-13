/* Kağıt Kanat — arayüz, girdi ve ses modülü (KK.UI)
   Sözleşme: init / getBest / handleEvents / update. State'i SADECE okur. */
(function () {
  'use strict';
  window.KK = window.KK || {};
  // Not: Türkçe metinler \u kaçışlı yazıldı; sayfanın charset'i eksik olsa da doğru görünür.

  // ---------- Sabitler ----------
  var BEST_KEY = 'kk.best';
  var MUTE_KEY = 'kk.muted';
  var MASTER_VOL = 1.0;        // toplam ses seviyesi (limiter sayesinde bozulmadan yüksek)
  var PANEL_DELAY = 0.4;       // ölüm panelinin görünme gecikmesi (sn)
  var RESTART_DELAY = 0.6;     // ekrana dokununca yeniden başlama gecikmesi (sn)

  function noop() {}

  // ---------- Kalıcı depolama (her erişim try/catch) ----------
  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, val) {
    try { window.localStorage.setItem(key, String(val)); } catch (e) { /* bellekte kalır */ }
  }

  var best = parseInt(readStore(BEST_KEY), 10);
  if (!(best >= 0)) best = 0;
  var muted = readStore(MUTE_KEY) === '1';

  // ---------- Ses (WebAudio sentezi) ----------
  var A = { ctx: null, master: null, noise: null };

  // İlk kullanıcı etkileşiminde çağrılır: bağlamı oluştur / uyandır
  function unlockAudio() {
    if (!A.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { A.ctx = new AC(); } catch (e) { return; }
      A.master = A.ctx.createGain();
      A.master.gain.value = muted ? 0 : MASTER_VOL;
      // Telefon hoparlörleri ~200 Hz altını çalamaz; bizim tok seslerin gövdesi 22-165 Hz.
      // Hafif saturasyon harmonik ekler (70 Hz → 140, 210, 280 Hz...), beyin temeli kendisi tamamlar.
      var pre = A.ctx.createGain(); pre.gain.value = 1.7;
      var drive = A.ctx.createWaveShaper();
      var n = 1024, curve = new Float32Array(n), k = 2.2;
      for (var i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
      drive.curve = curve; drive.oversample = '2x';
      // Limiter: tepeleri kırpar, genel sesi yüksek tutar
      var lim = A.ctx.createDynamicsCompressor();
      lim.threshold.value = -9; lim.knee.value = 4; lim.ratio.value = 16; lim.attack.value = 0.002; lim.release.value = 0.18;
      var out = A.ctx.createGain(); out.gain.value = 1.0;
      A.master.connect(pre); pre.connect(drive); drive.connect(lim); lim.connect(out); out.connect(A.ctx.destination);
      A.noise = makeNoiseBuffer(A.ctx, 1);
    }
    if (A.ctx.state !== 'running') { // 'suspended' ya da iOS'taki 'interrupted'
      try { var p = A.ctx.resume(); if (p && p.catch) p.catch(noop); } catch (e) { /* yoksay */ }
    }
  }

  // 1 sn beyaz gürültü tamponu (fıs ve darbe için ortak)
  function makeNoiseBuffer(c, seconds) {
    var len = Math.floor(c.sampleRate * seconds);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Üstel zarf: ~sessiz → tepe (a sn) → ~sessiz (d sn)
  function envelope(gainNode, t0, peak, a, d) {
    var g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  // Düğümleri sırayla bağla (eski Safari connect() zincirini desteklemez)
  function chain() {
    for (var i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]);
  }

  function canPlay() {
    return !muted && A.ctx && A.ctx.state === 'running';
  }

  // flap: tok bir kanat vuruşu — alçak "fıs" + kısa, derin bir gövde sesi
  function sfxFlap() {
    var c = A.ctx, t = c.currentTime;
    var src = c.createBufferSource();
    src.buffer = A.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.2; // her vuruş biraz farklı
    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(1100, t);
    bp.frequency.exponentialRampToValueAtTime(320, t + 0.09);
    var g = c.createGain();
    envelope(g, t, 0.45, 0.006, 0.085);
    chain(src, bp, g, A.master);
    src.start(t, Math.random() * 0.8);
    src.stop(t + 0.11);
    // gövde: 120 Hz'den 70 Hz'e inen kısa sinüs ("tok" hissi buradan)
    var o = c.createOscillator(), og = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    envelope(og, t, 0.5, 0.004, 0.08);
    chain(o, og, A.master);
    o.start(t); o.stop(t + 0.1);
  }

  // Tek nota: üçgen dalga + bir oktav altında yumuşak sinüs (daha dolgun, daha az tiz)
  function bell(t, freq, peak) {
    var c = A.ctx;
    var o1 = c.createOscillator(), o2 = c.createOscillator();
    var g1 = c.createGain(), g2 = c.createGain();
    o1.type = 'triangle'; o1.frequency.value = freq;
    o2.type = 'sine'; o2.frequency.value = freq / 2;
    envelope(g1, t, peak, 0.004, 0.24);
    envelope(g2, t, peak * 0.8, 0.004, 0.3);
    chain(o1, g1, A.master);
    chain(o2, g2, A.master);
    o1.start(t); o2.start(t);
    o1.stop(t + 0.3); o2.stop(t + 0.36);
  }

  // score: donmuş saatlere uygun, ciddi bir saat "tok"u — kısa tahta tıkırtısı + derin rezonans
  function sfxScore() {
    var c = A.ctx, t = c.currentTime;
    var n = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain();
    n.buffer = A.noise;
    bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 6;     // tahta "tık"
    envelope(ng, t, 0.55, 0.001, 0.025);
    chain(n, bp, ng, A.master);
    n.start(t, Math.random() * 0.5); n.stop(t + 0.04);
    var o = c.createOscillator(), og = c.createGain();                   // gövde: 165 Hz (E3)
    o.type = 'sine';
    o.frequency.setValueAtTime(175, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.2);
    envelope(og, t, 0.4, 0.003, 0.22);
    chain(o, og, A.master);
    o.start(t); o.stop(t + 0.26);
    var s2 = c.createOscillator(), sg = c.createGain();                  // bir oktav altında yumuşak taban
    s2.type = 'triangle'; s2.frequency.value = 82.4;
    envelope(sg, t, 0.22, 0.01, 0.3);
    chain(s2, sg, A.master);
    s2.start(t); s2.stop(t + 0.34);
  }

  // hit: aşağı kayan düşük sinüs + alçak geçirenden gürültü patlaması
  function sfxHit() {
    var c = A.ctx, t = c.currentTime;
    var o = c.createOscillator(), og = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.25);
    envelope(og, t, 1.0, 0.004, 0.3);
    chain(o, og, A.master);
    o.start(t); o.stop(t + 0.34);

    var n = c.createBufferSource(), lp = c.createBiquadFilter(), ng = c.createGain();
    n.buffer = A.noise;
    lp.type = 'lowpass'; lp.frequency.value = 280;
    envelope(ng, t, 0.7, 0.003, 0.12);
    chain(n, lp, ng, A.master);
    n.start(t, Math.random() * 0.5); n.stop(t + 0.12);
  }

  // Sentetik yankı: üstel sönen gürültüden üretilmiş 3 sn'lik "salon" yankısı (dosya gerekmez)
  function getReverb() {
    if (A.reverb) return A.reverb;
    var c = A.ctx, len = Math.floor(c.sampleRate * 3), ir = c.createBuffer(2, len, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = ir.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    var conv = c.createConvolver(); conv.buffer = ir;
    var wet = c.createGain(); wet.gain.value = 0.55;
    chain(conv, wet, A.master);
    A.reverb = conv;
    return conv;
  }

  // die: "yok oluş" — kara deliğe çekilir gibi kısa bir emiş, sonra derin bir çöküş ve uzun yankı
  function sfxDie() {
    var c = A.ctx, t = c.currentTime + 0.12, rv = getReverb();
    // 1) Emiş: yükselip aniden kesilen filtrelenmiş gürültü
    var n1 = c.createBufferSource(), f1 = c.createBiquadFilter(), g1 = c.createGain();
    n1.buffer = A.noise; n1.loop = true;
    f1.type = 'bandpass'; f1.Q.value = 2;
    f1.frequency.setValueAtTime(300, t); f1.frequency.exponentialRampToValueAtTime(2400, t + 0.35);
    g1.gain.setValueAtTime(0.0001, t); g1.gain.exponentialRampToValueAtTime(0.35, t + 0.33); g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    chain(n1, f1, g1); g1.connect(A.master); g1.connect(rv);
    n1.start(t); n1.stop(t + 0.4);
    var t2 = t + 0.36;
    // 2) Çöküş: 70 Hz'den 22 Hz'e inen derin sinüs (göğüste hissedilen kısım)
    var sub = c.createOscillator(), sg = c.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, t2); sub.frequency.exponentialRampToValueAtTime(22, t2 + 1.6);
    envelope(sg, t2, 0.9, 0.01, 1.6);
    chain(sub, sg, A.master); sg.connect(rv);
    sub.start(t2); sub.stop(t2 + 1.7);
    // 3) Karanlık akor: hafif akortsuz iki testere dalga, alçak geçirenle kapanarak söner
    [110, 110 * 1.006, 73.4].forEach(function (fr, i) {
      var o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(fr, t2); o.frequency.exponentialRampToValueAtTime(fr * 0.5, t2 + 1.8);
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400, t2); lp.frequency.exponentialRampToValueAtTime(90, t2 + 1.8);
      envelope(g, t2, 0.13, 0.02, 1.8);
      chain(o, lp, g); g.connect(A.master); g.connect(rv);
      o.start(t2); o.stop(t2 + 1.9);
    });
    // 4) Gürleme: alçak geçirenden geçen uzun gürültü
    var n2 = c.createBufferSource(), f2 = c.createBiquadFilter(), g2 = c.createGain();
    n2.buffer = A.noise; n2.loop = true;
    f2.type = 'lowpass'; f2.frequency.setValueAtTime(600, t2); f2.frequency.exponentialRampToValueAtTime(50, t2 + 1.5);
    envelope(g2, t2, 0.5, 0.005, 1.5);
    chain(n2, f2, g2); g2.connect(A.master); g2.connect(rv);
    n2.start(t2); n2.stop(t2 + 1.6);
  }

  // milestone: puan sayacı tutuşunca — yükselen alev "fuuş"u ve alçak bir gürleme
  function sfxMilestone() {
    var c = A.ctx, t = c.currentTime;
    var n = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    n.buffer = A.noise; n.loop = true;
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.45);
    envelope(g, t, 0.55, 0.12, 0.5);
    chain(n, bp, g, A.master);
    n.start(t); n.stop(t + 0.7);
    var o = c.createOscillator(), og = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.4);
    envelope(og, t, 0.45, 0.05, 0.5);
    chain(o, og, A.master);
    o.start(t); o.stop(t + 0.6);
  }

  var SFX = { flap: sfxFlap, score: sfxScore, hit: sfxHit, die: sfxDie, milestone: sfxMilestone };

  function setMuted(v) {
    muted = !!v;
    writeStore(MUTE_KEY, muted ? '1' : '0');
    if (A.master && A.ctx) {
      A.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOL, A.ctx.currentTime, 0.02);
    }
    renderMute();
  }

  // ---------- DOM ----------
  var cfg = null;          // init parametreleri
  var el = {};             // eleman referansları
  var prevMode = null;     // önceki karedeki mod
  var lastKeyboard = false; // son girdi klavyeden mi? (odak yönetimi için)
  var shown = { ready: null, dead: null, hint: null }; // gereksiz DOM yazımını önle

  var ICON_ON =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/>' +
    '<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var ICON_OFF =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/>' +
    '<path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function build(root) {
    root.classList.add('kk-ui');

    // Canvas'ın ekrandaki dikdörtgenine hizalı çerçeve
    var frame = h('div', 'kk-frame');

    // Hazır ekranı
    var ready = h('div', 'kk-layer kk-ready');
    var title = h('h1', 'kk-title');
    title.appendChild(h('span', 'kk-title-a', 'Paper'));
    title.appendChild(h('span', 'kk-title-b', 'Wing'));
    var tap = h('p', 'kk-tap', 'Tap to fly');
    var readyBest = h('p', 'kk-ready-best');
    ready.appendChild(title);
    ready.appendChild(tap);
    ready.appendChild(readyBest);

    // Ölüm paneli
    var dead = h('div', 'kk-layer kk-dead');
    dead.setAttribute('role', 'group');
    dead.setAttribute('aria-label', 'Game over');
    var card = h('div', 'kk-card');
    var badge = h('span', 'kk-badge', 'New best!');
    var head = h('h2', 'kk-card-title', 'Crashed');
    var scoreLbl = h('p', 'kk-label', 'Score');
    var scoreVal = h('p', 'kk-score', '0');
    var deadBest = h('p', 'kk-card-best');
    var again = h('button', 'kk-btn kk-again', 'Fly again');
    again.type = 'button';
    card.appendChild(badge);
    card.appendChild(head);
    card.appendChild(scoreLbl);
    card.appendChild(scoreVal);
    card.appendChild(deadBest);
    card.appendChild(again);
    var hint = h('p', 'kk-hint', 'or tap anywhere');
    dead.appendChild(card);
    dead.appendChild(hint);

    // Sessiz düğmesi (her modda görünür)
    var mute = h('button', 'kk-btn kk-mute');
    mute.type = 'button';

    // Ekran okuyucu duyurusu
    var live = h('p', 'kk-sr');
    live.setAttribute('aria-live', 'polite');

    frame.appendChild(ready);
    frame.appendChild(dead);
    frame.appendChild(mute);
    root.appendChild(frame);
    root.appendChild(live);

    el = {
      root: root, frame: frame, ready: ready, readyBest: readyBest,
      dead: dead, badge: badge, scoreVal: scoreVal, deadBest: deadBest,
      again: again, hint: hint, mute: mute, live: live
    };
  }

  function renderMute() {
    if (!el.mute) return;
    el.mute.innerHTML = muted ? ICON_OFF : ICON_ON;
    el.mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    el.mute.setAttribute('aria-label', muted ? 'Sound on' : 'Sound off');
    el.mute.title = muted ? 'Sound on' : 'Sound off';
  }

  // Çerçeveyi canvas'ın ekrandaki konumuna oturt (letterbox ile hizalı kalsın)
  function syncFrame() {
    if (!cfg || !cfg.canvas || !el.frame) return;
    var r = cfg.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var s = el.root.style;
    s.setProperty('--kk-x', r.left + 'px');
    s.setProperty('--kk-y', r.top + 'px');
    s.setProperty('--kk-w', r.width + 'px');
    s.setProperty('--kk-h', r.height + 'px');
    s.setProperty('--kk-r', Math.max(0, window.innerWidth - r.right) + 'px');
  }

  // ---------- Girdi ----------
  function isButton(target) {
    return !!(target && target.closest && target.closest('.kk-btn'));
  }

  // Ortak eylem: moda göre kanat çırp ya da yeniden başla
  function act() {
    var s = cfg.getState();
    if (!s) return;
    if (s.mode === 'dead') {
      if (s.modeTime > RESTART_DELAY) cfg.onRestart();
      // daha erken dokunuş: yoksay (yanlışlıkla yeniden başlamayı önler)
    } else {
      cfg.onFlap();
    }
  }

  function onPointerDown(e) {
    lastKeyboard = false;
    unlockAudio();
    if (isButton(e.target)) return;           // butonlar kendi click'ini işler
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.cancelable) e.preventDefault();     // metin seçimi/odak kaymasını önle
    act();
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var code = e.code || '';
    var key = e.key || '';
    var isFlapKey = code === 'Space' || code === 'ArrowUp' || code === 'KeyW' ||
      key === ' ' || key === 'ArrowUp' || key === 'w' || key === 'W';
    var isMuteKey = code === 'KeyM' || key === 'm' || key === 'M';
    if (!isFlapKey && !isMuteKey) return;

    lastKeyboard = true;
    unlockAudio();
    // Odaklı butonda Space/Enter butonun kendi işi
    if (isButton(e.target) && (code === 'Space' || key === ' ')) return;
    e.preventDefault();                        // sayfa kaydırmasını önle
    if (e.repeat) return;                      // basılı tutma tekrarlarını yoksay
    if (isMuteKey) { setMuted(!muted); return; }
    act();
  }

  // Butona fareyle/dokunarak basıldıysa odağı bırak (sonraki Space buton yerine uçuşa gitsin)
  function releaseFocus(e, btn) {
    if (e.detail > 0) btn.blur();
  }

  function bindInput(root) {
    root.addEventListener('pointerdown', onPointerDown);
    // iOS ses kilidi yalnızca pointerup/touchend gibi 'gerçek' etkileşimlerde açılabiliyor
    root.addEventListener('pointerup', unlockAudio);
    root.addEventListener('touchend', unlockAudio);
    window.addEventListener('keydown', onKeyDown);

    // Uzun basma menüsü, çift dokunma yakınlaştırma, kaydırma, iOS jestleri
    root.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    root.addEventListener('dblclick', function (e) { e.preventDefault(); });
    root.addEventListener('touchstart', function (e) {
      if (!isButton(e.target) && e.cancelable) e.preventDefault(); // butonların click'i bozulmasın
    }, { passive: false });
    root.addEventListener('touchmove', function (e) {
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    ['gesturestart', 'gesturechange'].forEach(function (type) {
      document.addEventListener(type, function (e) { e.preventDefault(); }, { passive: false });
    });

    el.mute.addEventListener('click', function (e) {
      unlockAudio();
      setMuted(!muted);
      releaseFocus(e, el.mute);
    });

    el.again.addEventListener('click', function (e) {
      var s = cfg.getState();
      releaseFocus(e, el.again);
      if (s && s.mode === 'dead' && s.modeTime > RESTART_DELAY) cfg.onRestart(); // erken basışa ve çift tetiklemeye karşı
    });

    // Sekme arka plana geçince sesi askıya al
    document.addEventListener('visibilitychange', function () {
      if (!A.ctx) return;
      try {
        var p = document.hidden ? A.ctx.suspend() : A.ctx.resume();
        if (p && p.catch) p.catch(noop);
      } catch (err) { /* yoksay */ }
    });

    // Canvas boyutu/konumu değişince çerçeveyi güncelle
    window.addEventListener('resize', syncFrame);
    window.addEventListener('orientationchange', syncFrame);
    if (window.ResizeObserver && cfg.canvas) {
      new ResizeObserver(syncFrame).observe(cfg.canvas);
    }
  }

  // ---------- Katman yönetimi ----------
  function toggle(node, key, on) {
    if (shown[key] === on) return;
    shown[key] = on;
    node.classList.toggle('is-on', on);
  }

  // Moda ilk girildiği an (bir kez)
  function enterMode(mode, s) {
    el.root.setAttribute('data-mode', mode);
    if (mode === 'dead') {
      var score = s.score | 0;
      var isRecord = score > best;
      if (isRecord) {
        best = score;
        writeStore(BEST_KEY, best);
      }
      el.scoreVal.textContent = String(score);
      el.deadBest.textContent = 'Best: ' + best;
      el.badge.classList.toggle('is-on', isRecord && score > 0);
      el.live.textContent = 'Crashed. Score ' + score + (isRecord && score > 0 ? '. New best!' : '. Best ' + best + '.');
    } else if (mode === 'ready') {
      el.readyBest.textContent = 'Best: ' + best;
      if (document.activeElement === el.again) el.again.blur();
    }
  }

  // ---------- Genel API ----------
  KK.UI = {
    init: function (opts) {
      cfg = opts || {};
      cfg.onFlap = cfg.onFlap || noop;
      cfg.onRestart = cfg.onRestart || noop;
      cfg.getState = cfg.getState || function () { return null; };
      build(cfg.root);
      renderMute();
      bindInput(cfg.root);
      syncFrame();
      el.readyBest.textContent = 'Best: ' + best;
    },

    getBest: function () { return best; },

    handleEvents: function (events, state) {
      if (!events || !events.length) return;
      var play = canPlay();
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (ev === 'hit') {
          try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) { /* yoksay */ }
        }
        if (play && SFX[ev]) {
          try { SFX[ev](); } catch (e) { /* ses hatası oyunu durdurmasın */ }
        }
      }
    },

    update: function (state) {
      if (!state || !el.root) return;
      var mode = state.mode;
      if (mode !== prevMode) {
        enterMode(mode, state);
        prevMode = mode;
      }
      var t = state.modeTime || 0;
      var deadOn = mode === 'dead' && t > PANEL_DELAY;
      toggle(el.ready, 'ready', mode === 'ready');
      toggle(el.dead, 'dead', deadOn);
      toggle(el.hint, 'hint', mode === 'dead' && t > RESTART_DELAY);

      // Klavyeyle oynayan için "Tekrar uç" düğmesine odak ver
      if (deadOn && t > RESTART_DELAY && lastKeyboard && document.activeElement !== el.again && shown.dead && !el._focused) {
        el._focused = true;
        try { el.again.focus({ preventScroll: true }); } catch (e) { el.again.focus(); }
      }
      if (mode !== 'dead') el._focused = false;
    }
  };
})();
