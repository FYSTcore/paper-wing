/* Paper Wing — müzik motoru (KK.Music)
 * Oyun (ui.js) ve müzik editörü (editor.html) AYNI motoru kullanır: editörde duyulan, oyunda çalan sestir.
 *
 * Tema verisi (her gök cismi için bir tane, düzenlenebilir):
 *   root  : kök nota (MIDI; 48 = C3)           scale : gam adı (SCALES)
 *   prog  : 4 akorun gam derecesi (0 = kök)     pad / arpW : dalga tipi (sine, triangle, sawtooth, square)
 *   cut   : pad parlaklığı (alçak geçiren, Hz)  rev   : yankı payı (0..1)    oct : arp oktav kaydırması (yarım ton)
 *   arp   : 16 adım; her adımda akor tonu 0..5 (1, 3, 5, 1↑, 3↑, 5↑) ya da -1 (sus)
 *   bass / kick / snare / hat : o enstrümanın çaldığı adımlar (0..15)
 *   mix   : katman sesleri { pad, arp, bass, drums } (1 = varsayılan)
 * Akorlar gamın kendi notalarıyla kurulur (d, d+2, d+4) → hangi derece seçilirse seçilsin "yanlış nota" olmaz.
 * Tempo oyunun hızına bağlıdır: BPM = 72 + 38·(katsayı − 1). Katmanlar hızla açılır:
 *   pad + arp her zaman · bas ×1.2 · davul ×1.45 · trampet ve 16'lık ×1.75
 */
window.KK = window.KK || {};
(function () {
  'use strict';
  var SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
    harmMinor: [0, 2, 3, 5, 7, 8, 11], phrygDom: [0, 1, 4, 5, 7, 8, 10], minPent: [0, 3, 5, 7, 10, 12, 15],
    locrian: [0, 1, 3, 5, 6, 8, 10]
  };
  var SCALE_NAMES = { major: 'Majör', dorian: 'Dorian', phrygian: 'Frigyen', lydian: 'Lidyen', mixolydian: 'Miksolidyen',
    aeolian: 'Doğal minör', harmMinor: 'Armonik minör', phrygDom: 'Frigyen dominant', minPent: 'Minör pentatonik', locrian: 'Lokriyen' };

  // Eski (v2.0) tanımlar: arp 8 adımlık 8'liklerdi → 16 adıma çevrilir (çift adımlar)
  var LEGACY = [
    ['Earth', 50, 'dorian', [0, 5, 3, 4], 'sawtooth', 1400, 'triangle', [0, 2, 4, 2, 1, 3, 5, 3], [0, 8], [4, 12], 0.30, 12],
    ['Moon', 45, 'aeolian', [0, 3, 5, 4], 'sine', 900, 'sine', [4, -1, 2, -1, 5, -1, 1, -1], [0], [12], 0.60, 24],
    ['Venus', 52, 'phrygDom', [0, 1, 0, 6], 'sawtooth', 1100, 'sawtooth', [0, 1, 2, 1, 3, 2, 1, 0], [0, 6, 8], [4, 12], 0.40, 12],
    ['Mercury', 54, 'phrygian', [0, 1, 5, 6], 'square', 900, 'square', [0, 3, 1, 4, 2, 5, 3, 1], [0, 3, 8, 11], [4, 12], 0.25, 12],
    ['Sun', 48, 'lydian', [0, 1, 4, 3], 'sawtooth', 2400, 'sawtooth', [0, 2, 4, 5, 4, 2, 3, 1], [0, 4, 8, 12], [4, 12], 0.35, 12],
    ['Mars', 43, 'aeolian', [0, 5, 6, 4], 'sawtooth', 1000, 'square', [0, 0, 2, 0, 3, 0, 2, 4], [0, 2, 8, 10], [4, 12, 14], 0.30, 12],
    ['Jupiter', 46, 'mixolydian', [0, 6, 3, 0], 'sawtooth', 1600, 'triangle', [0, 2, 4, 5, 2, 4, 5, 3], [0, 8, 10], [4, 12], 0.45, 12],
    ['Saturn', 51, 'lydian', [0, 4, 5, 1], 'triangle', 2000, 'sine', [0, 4, 2, 5, 1, 4, 3, 5], [0, 8], [4, 12], 0.55, 24],
    ['Uranus', 47, 'major', [0, 3, 1, 4], 'triangle', 1500, 'triangle', [5, 3, 4, 2, 3, 1, 2, 0], [0, 10], [4, 12], 0.55, 24],
    ['Neptune', 49, 'dorian', [0, 2, 5, 3], 'sine', 1100, 'triangle', [0, 2, 1, 3, 2, 4, 3, 5], [0, 7, 8], [4, 12], 0.60, 12],
    ['Pluto', 53, 'minPent', [0, 3, 2, 0], 'sine', 800, 'sine', [0, -1, -1, 2, -1, -1, 4, -1], [0], [8], 0.70, 24],
    ['Oort Cloud', 44, 'minPent', [0, 2, 3, 0], 'sine', 900, 'sine', [5, -1, 3, -1, 4, -1, 2, -1], [0], [12], 0.70, 24],
    ['Alpha Centauri', 50, 'lydian', [0, 1, 3, 4], 'sawtooth', 1800, 'triangle', [0, 2, 4, 5, 4, 2, 1, 2], [0, 8, 11], [4, 12], 0.40, 12],
    ['Orion Nebula', 46, 'dorian', [0, 3, 4, 2], 'triangle', 1600, 'sine', [0, 4, 2, 5, 3, 5, 1, 4], [0, 8], [4, 12], 0.60, 24],
    ['Pulsar', 41, 'phrygian', [0, 1, 0, 6], 'square', 700, 'square', [0, 0, 3, 0, 0, 0, 5, 0], [0, 4, 8, 12], [4, 12], 0.35, 12],
    ['Andromeda', 45, 'major', [0, 5, 3, 4], 'sawtooth', 1300, 'triangle', [0, 2, 4, 5, 3, 1, 2, 4], [0, 8], [4, 12], 0.65, 24],
    ['TON 618', 33, 'harmMinor', [0, 1, 0, 5], 'sawtooth', 420, 'sine', [4, -1, -1, -1, 5, -1, -1, -1], [0, 3], [], 0.75, 36]
  ];
  var DEFAULTS = LEGACY.map(function (L) {
    var arp = []; for (var i = 0; i < 8; i++) { arp.push(L[7][i]); arp.push(-1); }
    return { name: L[0], root: L[1], scale: L[2], prog: L[3].slice(), pad: L[4], cut: L[5], arpW: L[6], arp: arp,
      bass: [0, 8], kick: L[8].slice(), snare: L[9].slice(), hat: [0, 2, 4, 6, 8, 10, 12, 14], rev: L[10], oct: L[11],
      mix: { pad: 1, arp: 1, bass: 1, drums: 1 } };
  });
  // v2.5: TON 618 — "Olay ufku". Zaman genişlemesi: tempo ×0.62. Lokriyen: kök akoru eksiltilmiş, hiç oturmaz.
  // A° → B♭ → F → E♭ (A ile E♭ arası tritone). Altta sürekli drone, her akor 2 ölçüde 35 cent aşağı "batar".
  (function (T) {
    T.scale = 'locrian'; T.root = 33; T.prog = [0, 1, 5, 4];
    T.pad = 'sawtooth'; T.cut = 380; T.arpW = 'sine'; T.oct = 24; T.rev = 0.85;
    T.arp = [5, -1, -1, -1, -1, -1, -1, -1, -1, -1, 3, -1, -1, -1, -1, -1];
    T.bass = [0, 8]; T.kick = [0, 10]; T.snare = []; T.hat = [];
    T.tempo = 0.62; T.drone = true; T.bend = -35;
    T.mix = { pad: 1.1, arp: 0.9, bass: 1.1, drums: 1 };
  })(DEFAULTS[DEFAULTS.length - 1]);

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // Eksik/bozuk alanları varsayılanla tamamla (eski kayıtlar ve elle düzenlenmiş JSON için)
  function normalize(t, i) {
    var d = DEFAULTS[Math.min(i, DEFAULTS.length - 1)], o = clone(d);
    if (!t || typeof t !== 'object') return o;
    ['root', 'cut', 'rev', 'oct'].forEach(function (k) { if (typeof t[k] === 'number' && isFinite(t[k])) o[k] = t[k]; });
    if (SCALES[t.scale]) o.scale = t.scale;
    ['pad', 'arpW'].forEach(function (k) { if (/^(sine|triangle|sawtooth|square)$/.test(t[k])) o[k] = t[k]; });
    if (Array.isArray(t.prog) && t.prog.length === 4) o.prog = t.prog.map(function (v) { return Math.max(0, Math.min(6, v | 0)); });
    if (Array.isArray(t.arp)) {
      var a = t.arp.length === 8 ? [].concat.apply([], t.arp.map(function (v) { return [v, -1]; })) : t.arp;
      if (a.length === 16) o.arp = a.map(function (v) { v = v | 0; return v < 0 ? -1 : Math.min(5, v); });
    }
    ['bass', 'kick', 'snare', 'hat'].forEach(function (k) {
      if (Array.isArray(t[k])) o[k] = t[k].map(function (v) { return v | 0; }).filter(function (v) { return v >= 0 && v < 16; });
    });
    if (t.mix && typeof t.mix === 'object') ['pad', 'arp', 'bass', 'drums'].forEach(function (k) {
      if (typeof t.mix[k] === 'number') o.mix[k] = Math.max(0, Math.min(1.5, t.mix[k]));
    });
    return o;
  }
  function normalizeAll(list) {
    return DEFAULTS.map(function (d, i) { return normalize(list && list[i], i); });
  }

  function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function deg(T, i) { var sc = SCALES[T.scale], n = sc.length, o = Math.floor(i / n); return sc[((i % n) + n) % n] + 12 * o; }
  // d derecesinin akoru: d, d+2, d+4 (gamın kendi notalarıyla) — iki oktav için 6 ton
  function chordTones(T, d) { return [deg(T, d), deg(T, d + 2), deg(T, d + 4), deg(T, d + 7), deg(T, d + 9), deg(T, d + 11)]; }
  var NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function noteName(m) { return NOTE[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
  // Akor adı: kökün harfi + üçlü/beşli aralığına göre (majör, m, dim, aug)
  function chordName(T, d) {
    var c = chordTones(T, d), r = T.root + c[0], third = c[1] - c[0], fifth = c[2] - c[0];
    var q = third === 4 && fifth === 7 ? '' : third === 3 && fifth === 7 ? 'm' : third === 3 && fifth === 6 ? 'dim' : third === 4 && fifth === 8 ? 'aug' : 'sus';
    return NOTE[((r % 12) + 12) % 12] + q;
  }

  // ---- Motor ----
  // opts: { ctx, out (bağlanılacak düğüm), noise (gürültü tamponu), reverb (konvolver ya da null), vol }
  function create(opts) {
    var c = opts.ctx, themes = normalizeAll(opts.themes);
    var VOL = opts.vol || 0.24;
    var M = { timer: 0, nextTime: 0, step: 0, theme: 0, want: 0, chord: 0, mult: 1, mode: 'ready',
              bpm: 66, fast: false, last: null };
    var bus = c.createGain(); bus.gain.value = 0;
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 16000; lp.Q.value = 0.7;
    bus.connect(lp); lp.connect(opts.out);
    var send = c.createGain(); send.gain.value = themes[0].rev;
    if (opts.reverb) send.connect(opts.reverb);
    var layers = {};
    ['pad', 'arp', 'bass', 'drums', 'perc'].forEach(function (k) {
      var g = c.createGain(); g.gain.value = 0; g.connect(bus); g.connect(send); layers[k] = g;
    });
    function env(g, t, peak, a, d) {
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
    function T() { return themes[M.theme]; }
    function setLayer(k, v) { layers[k].gain.setTargetAtTime(v, c.currentTime, 0.6); }

    // p: { mode, mult, fireOut, hush, on, want }
    function update(p) {
      M.want = Math.max(0, Math.min(themes.length - 1, p.want | 0));
      var play = p.mode === 'playing', mult = play ? (p.mult || 1) : 1;
      M.bpm = play ? 72 + 38 * (mult - 1) : 66;
      M.fast = play && mult >= 1.75;
      var key = [p.mode, mult, !!p.fireOut, !!p.hush, !!p.on, M.theme].join('|');
      if (key === M.last) return;
      M.last = key;
      var mx = T().mix;
      setLayer('pad', (p.mode === 'dead' ? 0.55 : 1) * mx.pad);
      setLayer('arp', (play ? 1 : (p.mode === 'ready' ? 0.35 : 0)) * mx.arp);
      setLayer('bass', (play && mult >= 1.2 ? 1 : 0) * mx.bass);
      setLayer('drums', (play && mult >= 1.45 ? 1 : 0) * mx.drums);
      setLayer('perc', (play && mult >= 1.75 ? 1 : 0) * mx.drums);
      M.mult = mult; M.mode = p.mode;
      var t = c.currentTime;
      lp.frequency.setTargetAtTime(p.hush ? 900 : 16000, t, 0.25);   // v2.5: ateş sönünce boğuklaştırma kaldırıldı (telefonda müzik kayboluyordu)
      bus.gain.setTargetAtTime(!p.on ? 0 : p.hush ? VOL * 0.45 : VOL, t, 0.5);
    }
    function tick() {
      if (c.state !== 'running') return;
      if (M.nextTime < c.currentTime - 0.3) M.nextTime = c.currentTime + 0.05;   // askıdan dönünce yetiş
      while (M.nextTime < c.currentTime + 0.25) {
        step(M.step, M.nextTime);
        M.nextTime += 60 / (M.bpm * (T().tempo || 1)) / 4;                      // 16'lık nota süresi (v2.5: tema tempo çarpanı)
        M.step++;
      }
    }
    function step(s, t) {
      var b = s % 16, chordLen = 32;                                            // akor başına 2 ölçü
      if (s % chordLen === 0) {
        if (M.want !== M.theme) { M.theme = M.want; M.last = null; send.gain.setTargetAtTime(T().rev, t, 0.8); }
        M.chord = (s / chordLen) % 4;
        var dur = chordLen * 60 / (M.bpm * (T().tempo || 1)) / 4;
        pad(t, dur);
        if (T().drone) drone(t, dur);
      }
      var th = T(), tones = chordTones(th, th.prog[M.chord]), root = th.root;
      if (engine.onStep) engine.onStep(b, M.chord, t);
      var a = th.arp[b];
      if (a >= 0 && tones[a] != null) pluck(t, midiHz(root + th.oct + tones[a]), th.arpW, M.mode === 'playing' ? 0.075 : 0.05);
      else if (M.fast && b % 2 === 1 && th.arp[b - 1] >= 0) pluck(t, midiHz(root + th.oct + 12 + tones[th.arp[b - 1]]), th.arpW, 0.04); // hızlıyken yankı notası
      if (M.mult >= 1.2) {
        if (th.bass.indexOf(b) >= 0) bassNote(t, midiHz(root - 12 + tones[0]), 0.34);
        else if (M.mult >= 1.6 && b % 4 === 2) bassNote(t, midiHz(root + tones[0]), 0.16);
      }
      if (M.mult >= 1.45) {
        if (th.kick.indexOf(b) >= 0) kick(t, th.drone);
        if (th.hat.indexOf(b) >= 0) hat(t, b % 4 === 2 ? 0.11 : 0.06, false);
      }
      if (M.mult >= 1.75) {
        if (th.snare.indexOf(b) >= 0) snare(t);
        if (b % 2 === 1 && !th.drone) hat(t, 0.035, true);
      }
    }
    // ---- Enstrümanlar ----
    function pad(t, dur) {
      var th = T(), tones = chordTones(th, th.prog[M.chord]);
      [0, 1, 2].forEach(function (k) {
        var f = midiHz(th.root + tones[k]);
        var g = c.createGain(), f1 = c.createBiquadFilter();
        f1.type = 'lowpass'; f1.frequency.value = th.cut; f1.Q.value = 0.5;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.07, t + Math.min(1.2, dur * 0.3));
        g.gain.setValueAtTime(0.07, t + dur);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.4);
        [-7, 7].forEach(function (cents) {                                      // iki hafif akortsuz ses = genişlik
          var o = c.createOscillator(); o.type = th.pad; o.frequency.value = f; o.detune.value = cents;
          if (th.bend) { o.detune.setValueAtTime(cents, t); o.detune.linearRampToValueAtTime(cents + th.bend, t + dur + 1.4); }   // v2.5: aşağı "batma"
          o.connect(f1); o.start(t); o.stop(t + dur + 1.5);
        });
        f1.connect(g); g.connect(layers.pad);
      });
    }
    function pluck(t, f, type, peak) {
      var o = c.createOscillator(), f1 = c.createBiquadFilter(), g = c.createGain();
      o.type = type; o.frequency.value = f;
      f1.type = 'lowpass'; f1.frequency.setValueAtTime(Math.min(9000, f * 6), t); f1.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.2), t + 0.25);
      env(g, t, peak, 0.005, 0.32);
      o.connect(f1); f1.connect(g); g.connect(layers.arp); o.start(t); o.stop(t + 0.4);
    }
    function bassNote(t, f, peak) {
      var o = c.createOscillator(), s = c.createOscillator(), g = c.createGain(), f1 = c.createBiquadFilter();
      o.type = 'triangle'; o.frequency.value = f; s.type = 'sine'; s.frequency.value = f / 2;
      f1.type = 'lowpass'; f1.frequency.value = 700;
      env(g, t, peak, 0.008, 0.45);
      o.connect(f1); s.connect(f1); f1.connect(g); g.connect(layers.bass);
      o.start(t); s.start(t); o.stop(t + 0.5); s.stop(t + 0.5);
    }
    function kick(t, heavy) {
      var o = c.createOscillator(), g = c.createGain();
      // v2.5: ağır kick (TON 618): 100 → 30 Hz, 0.6 sn — kalp atışı gibi
      o.type = 'sine'; o.frequency.setValueAtTime(heavy ? 100 : 130, t); o.frequency.exponentialRampToValueAtTime(heavy ? 30 : 42, t + (heavy ? 0.3 : 0.14));
      env(g, t, heavy ? 0.7 : 0.55, 0.002, heavy ? 0.6 : 0.28);
      o.connect(g); g.connect(layers.drums); o.start(t); o.stop(t + (heavy ? 0.66 : 0.32));
    }
    // v2.5: drone — kök (55 Hz testere, 260 Hz alçak geçiren: telefon hoparlörü 110/165/220 Hz harmoniklerini duyar),
    // bir oktav altı sinüs (kulaklıkta hissedilir), çok kısık tritone. Akorla birlikte 35 cent aşağı kayar.
    // Üstüne her akorda "içine çekilme": 2 kHz → 80 Hz inen gürültü.
    function drone(t, dur) {
      var th = T(), f = midiHz(th.root), end = t + dur + 2.2, bend = th.bend || 0;
      var g = c.createGain(), lp2 = c.createBiquadFilter();
      lp2.type = 'lowpass'; lp2.frequency.value = 260; lp2.Q.value = 2;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 1.5);
      g.gain.setValueAtTime(0.11, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, end);
      [[f, 'sawtooth', 1], [f / 2, 'sine', 1.4], [f * Math.pow(2, 6 / 12), 'sine', 0.18]].forEach(function (v) {
        var o = c.createOscillator(), og = c.createGain(); o.type = v[1]; o.frequency.value = v[0]; og.gain.value = v[2];
        o.detune.setValueAtTime(0, t); o.detune.linearRampToValueAtTime(bend, end);
        o.connect(og); og.connect(lp2); o.start(t); o.stop(end + 0.05);
      });
      lp2.connect(g); g.connect(layers.pad);
      if (!opts.noise) return;
      var n = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain();
      n.buffer = opts.noise; n.loop = true; bp.type = 'bandpass'; bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(2000, t); bp.frequency.exponentialRampToValueAtTime(80, t + dur);
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.5); ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(bp); bp.connect(ng); ng.connect(layers.pad); n.start(t); n.stop(t + dur + 0.05);
    }
    function hat(t, peak, perc) {
      if (!opts.noise) return;
      var n = c.createBufferSource(), hp = c.createBiquadFilter(), g = c.createGain();
      n.buffer = opts.noise; hp.type = 'highpass'; hp.frequency.value = 7500;
      env(g, t, peak, 0.001, 0.045);
      n.connect(hp); hp.connect(g); g.connect(perc ? layers.perc : layers.drums); n.start(t, Math.random() * 0.8); n.stop(t + 0.06);
    }
    function snare(t) {
      if (!opts.noise) return;
      var n = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
      n.buffer = opts.noise; bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
      env(g, t, 0.28, 0.001, 0.16);
      n.connect(bp); bp.connect(g); g.connect(layers.perc); n.start(t, Math.random() * 0.8); n.stop(t + 0.2);
      var o = c.createOscillator(), og = c.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
      env(og, t, 0.18, 0.001, 0.09);
      o.connect(og); og.connect(layers.perc); o.start(t); o.stop(t + 0.12);
    }

    var engine = {
      state: M,
      start: function () { if (!M.timer) { M.nextTime = c.currentTime + 0.1; M.timer = setInterval(tick, 40); } },
      stop: function () { clearInterval(M.timer); M.timer = 0; bus.gain.setTargetAtTime(0, c.currentTime, 0.1); M.last = null; },
      update: update,
      setThemes: function (list) { themes = normalizeAll(list); M.last = null; },
      themes: function () { return themes; },
      // Editör için: temayı hemen değiştir ve baştan çal
      jump: function (i) { M.theme = M.want = i; M.step = 0; M.nextTime = c.currentTime + 0.05; M.last = null; send.gain.value = T().rev; },
      onStep: null
    };
    return engine;
  }

  // ---- Kayıt: varsayılan ← music.json (yayınlanmış) ← bu cihazdaki kayıt (editörden) ----
  var LOCAL_KEY = 'kk.music.custom', USE_KEY = 'kk.music.use';
  function readLocal() {
    try { var v = localStorage.getItem(LOCAL_KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function useLocal() { try { return localStorage.getItem(USE_KEY) !== '0'; } catch (e) { return true; } }
  function load() {
    var base = DEFAULTS;
    var p = (window.fetch ? fetch('music.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }) : Promise.resolve(null));
    return p.then(function (pub) {
      var list = pub && Array.isArray(pub.themes) ? normalizeAll(pub.themes) : clone(base);
      var loc = useLocal() ? readLocal() : null;
      if (loc && Array.isArray(loc.themes)) list = normalizeAll(loc.themes);
      return list;
    });
  }

  KK.Music = {
    SCALES: SCALES, SCALE_NAMES: SCALE_NAMES, DEFAULTS: DEFAULTS, normalize: normalize, normalizeAll: normalizeAll,
    chordTones: chordTones, chordName: chordName, noteName: noteName, midiHz: midiHz,
    create: create, load: load, LOCAL_KEY: LOCAL_KEY, USE_KEY: USE_KEY, readLocal: readLocal
  };
})();
