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
      A.out = out;                                   // test kancası (kayıt için)
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

  // v1.5 bump: ölümcül olmayan çarpma — kağıt buruşması (bant geçiren gürültü) + tok bir "tunk"
  function sfxBump() {
    var c = A.ctx, t = c.currentTime;
    var n = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain();
    n.buffer = A.noise;
    bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(2200, t); bp.frequency.exponentialRampToValueAtTime(700, t + 0.18);
    envelope(ng, t, 0.6, 0.002, 0.18);
    chain(n, bp, ng, A.master);
    n.start(t, Math.random() * 0.5); n.stop(t + 0.2);
    var o = c.createOscillator(), og = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    envelope(og, t, 0.8, 0.003, 0.22);
    chain(o, og, A.master);
    o.start(t); o.stop(t + 0.26);
  }

  // v1.5 break: kule çöküşü — alçak geçirenden geçen uzun moloz gürültüsü + çatırtılar
  function sfxBreak() {
    var c = A.ctx, t = c.currentTime + 0.03;
    var n = c.createBufferSource(), lp = c.createBiquadFilter(), g = c.createGain();
    n.buffer = A.noise; n.loop = true;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(120, t + 0.6);
    envelope(g, t, 0.45, 0.01, 0.6);
    chain(n, lp, g, A.master);
    n.start(t); n.stop(t + 0.65);
    for (var i = 0; i < 4; i++) {                                      // taş çatırtıları
      var tk = t + 0.04 + i * 0.07 + Math.random() * 0.04;
      var k = c.createBufferSource(), hp = c.createBiquadFilter(), kg = c.createGain();
      k.buffer = A.noise; hp.type = 'highpass'; hp.frequency.value = 1500;
      envelope(kg, tk, 0.25 - i * 0.04, 0.001, 0.04);
      chain(k, hp, kg, A.master);
      k.start(tk, Math.random() * 0.5); k.stop(tk + 0.05);
    }
  }

  var SFX = { flap: sfxFlap, score: sfxScore, hit: sfxHit, die: sfxDie, milestone: sfxMilestone, bump: sfxBump, 'break': sfxBreak };

  // =====================================================================
  // ---------- Müzik (v2.0): oyuna tepki veren, kodla üretilen müzik ----------
  // Dosya yok; her nota WebAudio osilatörüyle anında sentezlenir.
  //  • Her gök cisminin kendi gamı, akor yürüyüşü, tınısı ve yankısı var (12 tema).
  //  • Tempo hıza bağlı: BPM = 72 + 38·(katsayı − 1) → ×1.0'da 72, ×2.0'da 110.
  //    (Tam hızda kule başına 1.1 sn → kule başına ~2 vuruş: ritim uçuşla aynı nabızda.)
  //  • Katmanlar katsayıyla açılır: pad + arp her zaman, bas ×1.2, davul ×1.45, trampet+16'lık ×1.75.
  //  • Çarpınca ateşle birlikte müzik boğuklaşır (alçak geçiren 16 kHz → 650 Hz), geri yanınca açılır.
  //  • Ölünce müzik kısılır; ana ekranda sadece yumuşak pad çalar.
  // Zamanlama: 16'lık adımlar, 0.25 sn ileriyi planlayan "bakış" zamanlayıcısı (takılmasız çalım).
  // =====================================================================
  var MUSIC_VOL = 0.24;
  var SCALES = {
    dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], phrygDom: [0, 1, 4, 5, 7, 8, 10],
    harmMinor: [0, 2, 3, 5, 7, 8, 11], major: [0, 2, 4, 5, 7, 9, 11], minPent: [0, 3, 5, 7, 10, 12, 15]
  };
  // root: MIDI kök nota, prog: akor dereceleri (gam içinde), pad/arp: dalga tipi, cut: pad filtresi (Hz),
  // arp: akor tonları dizisi (0..5 = iki oktav), kick/snare: 16 adımlık desen, rev: yankı payı, oct: arp oktavı
  var THEMES = [
    { name: 'Earth',   root: 50, scale: 'dorian',     prog: [0, 5, 3, 4], pad: 'sawtooth', cut: 1400, arpW: 'triangle', arp: [0, 2, 4, 2, 1, 3, 5, 3], kick: [0, 8], snare: [4, 12], rev: 0.30, oct: 12 },
    { name: 'Moon',    root: 45, scale: 'aeolian',    prog: [0, 3, 5, 4], pad: 'sine',     cut: 900,  arpW: 'sine',     arp: [4, -1, 2, -1, 5, -1, 1, -1], kick: [0], snare: [12], rev: 0.60, oct: 24 },
    { name: 'Venus',   root: 52, scale: 'phrygDom',   prog: [0, 1, 0, 6], pad: 'sawtooth', cut: 1100, arpW: 'sawtooth', arp: [0, 1, 2, 1, 3, 2, 1, 0], kick: [0, 6, 8], snare: [4, 12], rev: 0.40, oct: 12 },
    { name: 'Mercury', root: 54, scale: 'phrygian',   prog: [0, 1, 5, 6], pad: 'square',   cut: 900,  arpW: 'square',   arp: [0, 3, 1, 4, 2, 5, 3, 1], kick: [0, 3, 8, 11], snare: [4, 12], rev: 0.25, oct: 12 },
    { name: 'Sun',     root: 48, scale: 'lydian',     prog: [0, 1, 4, 3], pad: 'sawtooth', cut: 2400, arpW: 'sawtooth', arp: [0, 2, 4, 5, 4, 2, 3, 1], kick: [0, 4, 8, 12], snare: [4, 12], rev: 0.35, oct: 12 },
    { name: 'Mars',    root: 43, scale: 'aeolian',    prog: [0, 5, 6, 4], pad: 'sawtooth', cut: 1000, arpW: 'square',   arp: [0, 0, 2, 0, 3, 0, 2, 4], kick: [0, 2, 8, 10], snare: [4, 12, 14], rev: 0.30, oct: 12 },
    { name: 'Jupiter', root: 46, scale: 'mixolydian', prog: [0, 6, 3, 0], pad: 'sawtooth', cut: 1600, arpW: 'triangle', arp: [0, 2, 4, 5, 2, 4, 5, 3], kick: [0, 8, 10], snare: [4, 12], rev: 0.45, oct: 12 },
    { name: 'Saturn',  root: 51, scale: 'lydian',     prog: [0, 4, 5, 1], pad: 'triangle', cut: 2000, arpW: 'sine',     arp: [0, 4, 2, 5, 1, 4, 3, 5], kick: [0, 8], snare: [4, 12], rev: 0.55, oct: 24 },
    { name: 'Uranus',  root: 47, scale: 'major',      prog: [0, 3, 1, 4], pad: 'triangle', cut: 1500, arpW: 'triangle', arp: [5, 3, 4, 2, 3, 1, 2, 0], kick: [0, 10], snare: [4, 12], rev: 0.55, oct: 24 },
    { name: 'Neptune', root: 49, scale: 'dorian',     prog: [0, 2, 5, 3], pad: 'sine',     cut: 1100, arpW: 'triangle', arp: [0, 2, 1, 3, 2, 4, 3, 5], kick: [0, 7, 8], snare: [4, 12], rev: 0.60, oct: 12 },
    { name: 'Pluto',   root: 53, scale: 'minPent',    prog: [0, 3, 2, 0], pad: 'sine',     cut: 800,  arpW: 'sine',     arp: [0, -1, -1, 2, -1, -1, 4, -1], kick: [0], snare: [8], rev: 0.70, oct: 24 },
    { name: 'TON 618', root: 33, scale: 'harmMinor',  prog: [0, 1, 0, 5], pad: 'sawtooth', cut: 420,  arpW: 'sine',     arp: [4, -1, -1, -1, 5, -1, -1, -1], kick: [0, 3], snare: [], rev: 0.75, oct: 36 }
  ];
  var M = { started: false, timer: 0, nextTime: 0, step: 0, theme: 0, want: 0, chord: 0,
            mult: 1, mode: 'ready', fireOut: false, bpm: 66, layers: null, bus: null, lp: null, send: null };

  function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  // Gam içinde i'inci derece (oktav taşmasıyla): 0..6 = ilk oktav, 7.. = sonraki
  function deg(T, i) { var sc = SCALES[T.scale], n = sc.length, o = Math.floor(i / n); return sc[((i % n) + n) % n] + 12 * o; }
  // d derecesinin üçlü akoru: d, d+2, d+4 (gamın kendi notalarıyla) — iki oktav için 6 ton
  function chordTones(T, d) { return [deg(T, d), deg(T, d + 2), deg(T, d + 4), deg(T, d + 7), deg(T, d + 9), deg(T, d + 11)]; }

  function musicInit() {
    var c = A.ctx;
    M.bus = c.createGain(); M.bus.gain.value = 0;
    M.lp = c.createBiquadFilter(); M.lp.type = 'lowpass'; M.lp.frequency.value = 16000; M.lp.Q.value = 0.7;
    M.bus.connect(M.lp); M.lp.connect(A.master);
    M.send = c.createGain(); M.send.gain.value = THEMES[0].rev;
    M.send.connect(getReverb());
    M.layers = {};
    ['pad', 'arp', 'bass', 'drums', 'perc'].forEach(function (k) {
      var g = c.createGain(); g.gain.value = 0; g.connect(M.bus); g.connect(M.send); M.layers[k] = g;
    });
    M.bus.gain.setTargetAtTime(musicOn ? MUSIC_VOL : 0, c.currentTime, 1.0);    // açılışta yumuşakça gir
    M.nextTime = c.currentTime + 0.1;
    M.started = true; M.dirty = true;
    M.timer = setInterval(musicTick, 40);
  }

  function setLayer(k, v) { var g = M.layers[k]; g.gain.setTargetAtTime(v, A.ctx.currentTime, 0.6); }

  // Oyun durumundan hedefleri güncelle (her kare)
  function musicUpdate(s) {
    if (!A.ctx) return;
    if (!M.started) { if (A.ctx.state === 'running') musicInit(); else return; }
    var every = KK.PLANET_EVERY || 250;
    M.want = s.mode === 'ready' ? 0 : Math.min(THEMES.length - 1, Math.floor(s.score / every));
    if (s.mode === 'ready' && M.mode !== 'ready') { M.theme = 0; M.step = 0; }   // yeni tur Dünya'dan başlar
    var mult = s.mode === 'playing' ? (s.mult || 1) : 1;
    var play = s.mode === 'playing';
    M.bpm = play ? 72 + 38 * (mult - 1) : 66;
    var hush = s.mode === 'dead' || paused;                       // ölünce ve durdurunca kısık/boğuk
    if (M.dirty || s.mode !== M.mode || mult !== M.mult || !!s.fireOut !== M.fireOut || paused !== M.paused || musicOn !== M.on) {
      M.dirty = false;
      setLayer('pad', s.mode === 'dead' ? 0.55 : 1);
      setLayer('arp', play ? 1 : (s.mode === 'ready' ? 0.35 : 0));
      setLayer('bass', play && mult >= 1.2 ? 1 : 0);
      setLayer('drums', play && mult >= 1.45 ? 1 : 0);
      setLayer('perc', play && mult >= 1.75 ? 1 : 0);
      var t = A.ctx.currentTime;
      M.lp.frequency.setTargetAtTime(hush ? 900 : (play && s.fireOut ? 900 : 16000), t, 0.25);
      M.bus.gain.setTargetAtTime(!musicOn ? 0 : hush ? MUSIC_VOL * 0.45 : MUSIC_VOL, t, 0.5);
    }
    M.mode = s.mode; M.mult = mult; M.fireOut = !!s.fireOut; M.paused = paused; M.on = musicOn;
  }

  function musicTick() {
    var c = A.ctx;
    if (!c || c.state !== 'running') return;
    if (M.nextTime < c.currentTime - 0.3) M.nextTime = c.currentTime + 0.05;  // askıdan dönünce yetiş
    while (M.nextTime < c.currentTime + 0.25) {
      musicStep(M.step, M.nextTime);
      M.nextTime += 60 / M.bpm / 4;                                         // 16'lık nota süresi
      M.step++;
    }
  }

  function musicStep(step, t) {
    var bar16 = step % 16, chordLen = 32;                                   // akor başına 2 ölçü
    if (step % chordLen === 0) {
      if (M.want !== M.theme) { M.theme = M.want; M.send.gain.setTargetAtTime(THEMES[M.theme].rev, t, 0.8); }
      M.chord = (step / chordLen) % 4;
      playPad(t, chordLen * 60 / M.bpm / 4);
    }
    var T = THEMES[M.theme], tones = chordTones(T, T.prog[M.chord]);
    var root = T.root;
    var fast = M.mult >= 1.75 && M.mode === 'playing';
    // Arp: 8'likler (hızlıyken 16'lık)
    if (fast || step % 2 === 0) {
      var ai = fast ? step % 8 : (step / 2) % 8;
      var a = T.arp[ai];
      if (a >= 0 && tones[a] != null) pluck(t, midiHz(root + T.oct + tones[a]), T.arpW, M.mode === 'playing' ? 0.075 : 0.05);
    }
    // Bas: 1. ve 3. vuruş, ×1.6 üstünde 8'lik oktav zıplaması
    if (M.mult >= 1.2) {
      if (bar16 === 0 || bar16 === 8) bassNote(t, midiHz(root - 12 + tones[0]), 0.34);
      else if (M.mult >= 1.6 && bar16 % 4 === 2) bassNote(t, midiHz(root + tones[0]), 0.16);
    }
    if (M.mult >= 1.45) {
      if (T.kick.indexOf(bar16) >= 0) kick(t);
      if (bar16 % 2 === 0) hat(t, bar16 % 4 === 2 ? 0.11 : 0.06);
    }
    if (M.mult >= 1.75) {
      if (T.snare.indexOf(bar16) >= 0) snare(t);
      if (bar16 % 2 === 1) hat(t, 0.035, true);
    }
  }

  // ---- Enstrümanlar ----
  function playPad(t, dur) {
    var c = A.ctx, T = THEMES[M.want !== M.theme ? M.theme : M.theme];
    var tones = chordTones(T, T.prog[M.chord]);
    [0, 1, 2].forEach(function (k) {
      var f = midiHz(T.root + tones[k] + (k === 0 ? 0 : 12 * 0));
      var g = c.createGain(), lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = T.cut; lp.Q.value = 0.5;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + Math.min(1.2, dur * 0.3));
      g.gain.setValueAtTime(0.07, t + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.4);
      [-7, 7].forEach(function (cents) {                                     // iki hafif akortsuz ses = genişlik
        var o = c.createOscillator(); o.type = T.pad; o.frequency.value = f; o.detune.value = cents;
        o.connect(lp); o.start(t); o.stop(t + dur + 1.5);
      });
      lp.connect(g); g.connect(M.layers.pad);
    });
  }
  function pluck(t, f, type, peak) {
    var c = A.ctx, o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
    o.type = type; o.frequency.value = f;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(Math.min(9000, f * 6), t); lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.2), t + 0.25);
    envelope(g, t, peak, 0.005, 0.32);
    chain(o, lp, g, M.layers.arp); o.start(t); o.stop(t + 0.4);
  }
  function bassNote(t, f, peak) {
    var c = A.ctx, o = c.createOscillator(), s = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = f; s.type = 'sine'; s.frequency.value = f / 2;
    lp.type = 'lowpass'; lp.frequency.value = 700;
    envelope(g, t, peak, 0.008, 0.45);
    o.connect(lp); s.connect(lp); chain(lp, g, M.layers.bass);
    o.start(t); s.start(t); o.stop(t + 0.5); s.stop(t + 0.5);
  }
  function kick(t) {
    var c = A.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    envelope(g, t, 0.55, 0.002, 0.28);
    chain(o, g, M.layers.drums); o.start(t); o.stop(t + 0.32);
  }
  function hat(t, peak, perc) {
    var c = A.ctx, n = c.createBufferSource(), hp = c.createBiquadFilter(), g = c.createGain();
    n.buffer = A.noise; hp.type = 'highpass'; hp.frequency.value = 7500;
    envelope(g, t, peak, 0.001, 0.045);
    chain(n, hp, g, perc ? M.layers.perc : M.layers.drums); n.start(t, Math.random() * 0.8); n.stop(t + 0.06);
  }
  function snare(t) {
    var c = A.ctx, n = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    n.buffer = A.noise; bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
    envelope(g, t, 0.28, 0.001, 0.16);
    chain(n, bp, g, M.layers.perc); n.start(t, Math.random() * 0.8); n.stop(t + 0.2);
    var o = c.createOscillator(), og = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    envelope(og, t, 0.18, 0.001, 0.09);
    chain(o, og, M.layers.perc); o.start(t); o.stop(t + 0.12);
  }

  function setMuted(v) {
    muted = !!v;
    writeStore(MUTE_KEY, muted ? '1' : '0');
    if (A.master && A.ctx) {
      A.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOL, A.ctx.currentTime, 0.02);
    }
    renderMute();
  }

  // ---------- v2.0: Skinler, dev hediyesi, durdurma ----------
  var SKIN_KEY = 'kk.skin', DEV_KEY = 'kk.dev', MUSIC_KEY = 'kk.music';
  // Dev hediyesi kodunun SHA-256 özeti ('paperwing:' + KOD). Kodun kendisi hiçbir dosyada yok:
  // özetten koda geri dönmek mümkün değil; tahminle bulmak 32^12 ≈ 1.2·10^18 deneme ister.
  var DEV_HASH = '078af0359ac79e276cb61799f7312c35298086ceb461f2eb0909933cfa1543aa';
  var devOn = false;
  var skinSel = readStore(SKIN_KEY) || 'paper';   // uçarken kullanılan (kilidi açık) skin
  var browse = skinSel;                            // ana ekranda göz atılan (kilitli de olabilir)
  var musicOn = readStore(MUSIC_KEY) !== '0';
  var paused = false, resumeAt = 0, devTaps = [];

  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function sha256(text) {
    if (!(window.crypto && crypto.subtle && window.TextEncoder)) return Promise.reject(new Error('no crypto'));
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }
  function checkDev(code) { return sha256('paperwing:' + normCode(code)).then(function (h) { return h === DEV_HASH; }); }

  function skinList() { return (KK.SKINS || []).filter(function (k) { return !k.secret || devOn; }); }
  function skinUnlocked(k) { return k.secret ? devOn : best >= (k.req || 0); }
  function findSkin(id) { var l = skinList(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function stepSkin(d) {
    var l = skinList(); if (!l.length) return;
    var i = 0; for (var k = 0; k < l.length; k++) if (l[k].id === browse) i = k;
    var n = l[(i + d + l.length) % l.length];
    browse = n.id;
    if (skinUnlocked(n)) { skinSel = n.id; writeStore(SKIN_KEY, skinSel); }
    renderSkin();
  }
  function renderSkin() {
    if (!el.skinName) return;
    var l = skinList(), k = findSkin(browse) || l[0], i = l.indexOf(k);
    if (!findSkin(skinSel) || !skinUnlocked(findSkin(skinSel))) skinSel = 'paper';
    el.skinName.textContent = k ? k.name : '';
    el.skinLock.textContent = !k ? '' : skinUnlocked(k) ? (i + 1) + ' / ' + l.length : 'LOCKED · reach ' + k.req;
    el.skins.classList.toggle('is-locked', !!k && !skinUnlocked(k));
    el.skins.classList.toggle('is-dev', !!k && !!k.secret);
  }

  function pause() {
    var s = cfg && cfg.getState();
    if (!s || s.mode !== 'playing' || (paused && !resumeAt)) return;
    paused = true; resumeAt = 0;
    toggle(el.paused, 'paused', true); el.count.textContent = '';
    renderMusicBtn();
  }
  function resume() {
    if (!paused || resumeAt) return;
    toggle(el.paused, 'paused', false);
    resumeAt = performance.now() + 1500;           // 3-2-1 geri sayım (0.5 sn'de bir), sonra devam
  }
  function restartFromPause() {
    paused = false; resumeAt = 0;
    toggle(el.paused, 'paused', false); el.count.textContent = '';
    cfg.onRestart();
  }
  function renderMusicBtn() { if (el.musicBtn) el.musicBtn.textContent = 'Music: ' + (musicOn ? 'On' : 'Off'); }

  function openCode() {
    toggle(el.code, 'code', true);
    el.codeMsg.textContent = ''; el.codeInput.value = '';
    setTimeout(function () { try { el.codeInput.focus(); } catch (e) { /* yoksay */ } }, 50);
  }
  function closeCode() { toggle(el.code, 'code', false); try { el.codeInput.blur(); } catch (e) { /* yoksay */ } }
  function submitCode() {
    var v = el.codeInput.value;
    checkDev(v).then(function (ok) {
      if (!ok) { el.codeMsg.textContent = 'Wrong code'; el.codeCard.classList.remove('kk-shake'); void el.codeCard.offsetWidth; el.codeCard.classList.add('kk-shake'); return; }
      devOn = true; writeStore(DEV_KEY, normCode(v));
      browse = skinSel = 'fyst'; writeStore(SKIN_KEY, skinSel);
      el.codeMsg.textContent = 'Dev gift unlocked ✦';
      renderSkin();
      setTimeout(closeCode, 1300);
    }, function () { el.codeMsg.textContent = 'Not supported here'; });
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
    // Skin seçici: ‹ AD ›  (kilitliyse önizleme + gereken skor)
    var skins = h('div', 'kk-skins');
    var prev = h('button', 'kk-btn kk-arrow', '‹'); prev.type = 'button'; prev.setAttribute('aria-label', 'Previous skin');
    var next = h('button', 'kk-btn kk-arrow', '›'); next.type = 'button'; next.setAttribute('aria-label', 'Next skin');
    var info = h('div', 'kk-skin-info');
    var skinName = h('span', 'kk-skin-name'), skinLock = h('span', 'kk-skin-lock');
    info.appendChild(skinName); info.appendChild(skinLock);
    skins.appendChild(prev); skins.appendChild(info); skins.appendChild(next);
    ready.appendChild(skins);
    var devtap = h('button', 'kk-btn kk-devtap'); devtap.type = 'button'; devtap.setAttribute('aria-hidden', 'true'); devtap.tabIndex = -1;
    ready.appendChild(devtap);

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
    // Durdur düğmesi (sadece uçarken)
    var pauseBtn = h('button', 'kk-btn kk-pause');
    pauseBtn.type = 'button'; pauseBtn.setAttribute('aria-label', 'Pause'); pauseBtn.title = 'Pause';
    pauseBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';
    // Durdurma menüsü
    var pausedL = h('div', 'kk-layer kk-paused');
    var pcard = h('div', 'kk-card kk-pcard');
    pcard.appendChild(h('h2', 'kk-card-title', 'Paused'));
    var resumeBtn = h('button', 'kk-btn kk-again', 'Resume'); resumeBtn.type = 'button';
    var restartBtn = h('button', 'kk-btn kk-ghost', 'Restart'); restartBtn.type = 'button';
    var musicBtn = h('button', 'kk-btn kk-ghost', 'Music: On'); musicBtn.type = 'button';
    pcard.appendChild(resumeBtn); pcard.appendChild(restartBtn); pcard.appendChild(musicBtn);
    pausedL.appendChild(pcard);
    var count = h('div', 'kk-count');
    // Gizli kod kutusu
    var codeL = h('div', 'kk-layer kk-code');
    var ccard = h('form', 'kk-card kk-ccard');
    ccard.appendChild(h('h2', 'kk-card-title', 'Code'));
    var codeInput = h('input', 'kk-input');
    codeInput.type = 'text'; codeInput.autocomplete = 'off'; codeInput.spellcheck = false; codeInput.maxLength = 20;
    codeInput.setAttribute('autocapitalize', 'characters'); codeInput.placeholder = 'XXXX-XXXX-XXXX';
    var codeMsg = h('p', 'kk-code-msg');
    var codeOk = h('button', 'kk-btn kk-again', 'OK'); codeOk.type = 'submit';
    var codeCancel = h('button', 'kk-btn kk-ghost', 'Cancel'); codeCancel.type = 'button';
    ccard.appendChild(codeInput); ccard.appendChild(codeMsg); ccard.appendChild(codeOk); ccard.appendChild(codeCancel);
    codeL.appendChild(ccard);

    // Ekran okuyucu duyurusu
    var live = h('p', 'kk-sr');
    live.setAttribute('aria-live', 'polite');

    frame.appendChild(ready);
    frame.appendChild(dead);
    frame.appendChild(pausedL);
    frame.appendChild(codeL);
    frame.appendChild(count);
    frame.appendChild(pauseBtn);
    frame.appendChild(mute);
    root.appendChild(frame);
    root.appendChild(live);

    el = {
      root: root, frame: frame, ready: ready, readyBest: readyBest,
      dead: dead, badge: badge, scoreVal: scoreVal, deadBest: deadBest,
      again: again, hint: hint, mute: mute, live: live,
      skins: skins, prev: prev, next: next, skinName: skinName, skinLock: skinLock, devtap: devtap,
      pauseBtn: pauseBtn, paused: pausedL, resumeBtn: resumeBtn, restartBtn: restartBtn, musicBtn: musicBtn, count: count,
      code: codeL, codeCard: ccard, codeInput: codeInput, codeMsg: codeMsg, codeCancel: codeCancel
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
    return !!(target && target.closest && target.closest('.kk-btn, .kk-input, .kk-ccard'));
  }

  // Ortak eylem: moda göre kanat çırp ya da yeniden başla
  function act() {
    var s = cfg.getState();
    if (!s || paused || shown.code) return;
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
    if (e.target && e.target.tagName === 'INPUT') { if (e.key === 'Escape') closeCode(); return; }  // kod yazılırken oyun tuşları kapalı
    var code = e.code || '';
    var key = e.key || '';
    if (code === 'Escape' || code === 'KeyP' || key === 'Escape' || key === 'p' || key === 'P') {
      e.preventDefault(); if (paused && !resumeAt) resume(); else pause(); return;
    }
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
    el.prev.addEventListener('click', function (e) { releaseFocus(e, el.prev); stepSkin(-1); });
    el.next.addEventListener('click', function (e) { releaseFocus(e, el.next); stepSkin(1); });
    el.devtap.addEventListener('click', function () {      // sürüm yazısına 4 sn içinde 7 dokunuş → kod kutusu
      var now = Date.now();
      devTaps = devTaps.filter(function (t) { return now - t < 4000; }); devTaps.push(now);
      if (devTaps.length >= 7) { devTaps = []; openCode(); }
    });
    el.codeCard.addEventListener('submit', function (e) { e.preventDefault(); submitCode(); });
    el.codeCancel.addEventListener('click', closeCode);
    el.pauseBtn.addEventListener('click', function (e) { unlockAudio(); releaseFocus(e, el.pauseBtn); pause(); });
    el.resumeBtn.addEventListener('click', function (e) { releaseFocus(e, el.resumeBtn); resume(); });
    el.restartBtn.addEventListener('click', function (e) { releaseFocus(e, el.restartBtn); restartFromPause(); });
    el.musicBtn.addEventListener('click', function (e) {
      releaseFocus(e, el.musicBtn); musicOn = !musicOn; writeStore(MUSIC_KEY, musicOn ? '1' : '0'); M.dirty = true; renderMusicBtn();
    });

    el.again.addEventListener('click', function (e) {
      var s = cfg.getState();
      releaseFocus(e, el.again);
      if (s && s.mode === 'dead' && s.modeTime > RESTART_DELAY) cfg.onRestart(); // erken basışa ve çift tetiklemeye karşı
    });

    // Sekme arka plana geçince sesi askıya al
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause();                 // v2.0: uygulamadan çıkınca oyun kendiliğinden durur
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
      var isRecord = score > best, oldBest = best;
      if (isRecord) {
        best = score;
        writeStore(BEST_KEY, best);
      }
      el.scoreVal.textContent = String(score);
      // v2.0: bu turda açılan skinler
      var fresh = skinList().filter(function (k) { return !k.secret && k.req > oldBest && k.req <= best; }).map(function (k) { return k.name; });
      el.deadBest.textContent = 'Best: ' + best + (fresh.length ? '  \u00b7  New skin: ' + fresh.join(', ') : '');
      el.badge.classList.toggle('is-on', isRecord && score > 0);
      el.live.textContent = 'Crashed. Score ' + score + (isRecord && score > 0 ? '. New best!' : '. Best ' + best + '.');
    } else if (mode === 'ready') {
      el.readyBest.textContent = 'Best: ' + best;
      browse = skinSel; renderSkin();
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
      renderSkin(); renderMusicBtn();
      var saved = readStore(DEV_KEY);                // kayıtlı kod hâlâ doğru mu? (özetle kontrol)
      if (saved) checkDev(saved).then(function (ok) { if (ok) { devOn = true; skinSel = readStore(SKIN_KEY) || skinSel; browse = skinSel; renderSkin(); } }, noop);
    },
    isPaused: function () { return paused; },
    skinFor: function (mode) { return mode === 'ready' ? browse : skinSel; },

    getBest: function () { return best; },
    _audio: A, _music: M,             // test kancaları

    handleEvents: function (events, state) {
      if (!events || !events.length) return;
      var play = canPlay();
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (ev === 'hit' || ev === 'bump') {
          try { if (navigator.vibrate) navigator.vibrate(ev === 'bump' ? [30, 40, 30] : 40); } catch (e) { /* yoksay */ }
        }
        if (play && SFX[ev]) {
          try { SFX[ev](); } catch (e) { /* ses hatası oyunu durdurmasın */ }
        }
      }
    },

    update: function (state) {
      if (!state || !el.root) return;
      try { musicUpdate(state); } catch (e) { /* müzik hatası oyunu durdurmasın */ }
      toggle(el.pauseBtn, 'pauseBtn', state.mode === 'playing' && !paused);
      if (paused && state.mode !== 'playing') { paused = false; resumeAt = 0; toggle(el.paused, 'paused', false); el.count.textContent = ''; }
      if (resumeAt) {                                  // 3-2-1 geri sayım
        var left = resumeAt - performance.now();
        if (left <= 0) { resumeAt = 0; paused = false; el.count.textContent = ''; }
        else el.count.textContent = String(Math.ceil(left / 500));
      }
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
