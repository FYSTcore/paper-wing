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
  // v2.5: ayrı müzik / efekt seviyesi (0..100). Kazanç = (v/100)² → %50 ≈ −12 dB, kulağa "yarı ses" gelir
  var VOL_MUS_KEY = 'kk.vol.mus', VOL_SFX_KEY = 'kk.vol.sfx';
  function readVol(k) { var v = parseInt(readStoreEarly(k), 10); return v >= 0 && v <= 100 ? v : 100; }
  function readStoreEarly(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  var volMus = readVol(VOL_MUS_KEY), volSfx = readVol(VOL_SFX_KEY);
  if (readStoreEarly(VOL_MUS_KEY) == null && readStoreEarly('kk.music') === '0') volMus = 0;   // eski 'Music: Off' ayarı korunur
  function volGain(v) { return Math.pow(v / 100, 2); }
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
      // v2.5.1: telefonda "bitli/cızırtılı" ses = ses iş parçacığının yetişememesi (underrun). Varsayılan 'interactive'
      // tampon Android'de ~256 örnek ≈ 5 ms; 30 ms tampon 6 kat pay bırakır, dokunuş gecikmesi fark edilmez.
      // v3.0: hâlâ cızırdayan telefonlar için tampon 30 → 50 ms (pay 6 → 10 kat; dokunuş gecikmesi +20 ms, hissedilmez)
      try { A.ctx = new AC({ latencyHint: 0.05 }); } catch (e) { try { A.ctx = new AC(); } catch (e2) { return; } }
      A.master = A.ctx.createGain();
      A.master.gain.value = muted ? 0 : MASTER_VOL;
      // Telefon hoparlörleri ~200 Hz altını çalamaz; bizim tok seslerin gövdesi 22-165 Hz.
      // Hafif saturasyon harmonik ekler (70 Hz → 140, 210, 280 Hz...), beyin temeli kendisi tamamlar.
      // v2.5.1: sürüş yumuşatıldı (1.7·tanh 2.2 → 1.6·tanh 1.2): tam hızda müzikte bozulma payı −28 dB → −38 dB (≈ %4 → %1.2)
      var pre = A.ctx.createGain(); pre.gain.value = 1.6;
      var drive = A.ctx.createWaveShaper();
      var n = 1024, curve = new Float32Array(n), k = 1.2;
      for (var i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
      drive.curve = curve; drive.oversample = 'none';
      // Limiter: tepeleri kırpar, genel sesi yüksek tutar
      var lim = A.ctx.createDynamicsCompressor();
      lim.threshold.value = -9; lim.knee.value = 4; lim.ratio.value = 16; lim.attack.value = 0.002; lim.release.value = 0.18;
      var out = A.ctx.createGain(); out.gain.value = 0.85;   // v3.0.2: −1.4 dB pay (hoparlör sınırına dayanmasın)
      // v3.0.2: telefon hoparlörü 200 Hz altını çalamaz ama zorlar → membran sınıra dayanıp "bitli" cızırdar.
      // Müziğin enerjisinin %48-82'si 200 Hz altındaydı. Satürasyondan SONRA 140 Hz yüksek geçiren:
      // temel frekans gider, eklenen harmonikler (2×, 3×...) kalır → bas hissi korunur, 200 Hz altı enerji ≈ yarıya iner.
      // Limiterden ÖNCE: filtrenin faz kaymasıyla büyüyen tepeleri limiter yakalar.
      var hp = A.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140; hp.Q.value = 0.707;
      A.master.connect(pre); pre.connect(drive); drive.connect(hp); hp.connect(lim); lim.connect(out); out.connect(A.ctx.destination);
      // v3.1.1: ses bekçisi — çıkışta bozuk sayı (NaN) görülürse tüm ses zinciri baştan kurulur (aşağıda audioWatchdog)
      A.an = A.ctx.createAnalyser(); A.an.fftSize = 256; out.connect(A.an); A.wdBuf = new Float32Array(256); A.wdT = 0;
      A.out = out;                                   // test kancası (kayıt için)
      // v2.5: ayrı kanallar — efektler ve müzik kendi ses seviyeleriyle ana sese (sessiz düğmesi) bağlanır
      A.sfx = A.ctx.createGain(); A.sfx.gain.value = volGain(volSfx); A.sfx.connect(A.master);
      A.mus = A.ctx.createGain(); A.mus.gain.value = volGain(volMus); A.mus.connect(A.master);
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

  // ---------- v3.0.7: skinlere özel kanat sesleri ----------
  // Kısa ton: dalga tipi, başlangıç → bitiş frekansı (üstel kayma), süre, tepe; isteğe bağlı başlangıç gecikmesi
  function tone(type, f0, f1, dur, peak, dly) {
    var c = A.ctx, t = c.currentTime + (dly || 0), o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
    envelope(g, t, peak, 0.004, dur); chain(o, g, A.sfx); o.start(t); o.stop(t + dur + 0.02);
  }
  // Filtreli gürültü patlaması: filtre tipi, frekans başı → sonu, Q, süre, tepe
  function hiss(type, f0, f1, q, dur, peak) {
    var c = A.ctx, t = c.currentTime, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = A.noise; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.9);
    envelope(g, t, peak, 0.003, dur); chain(src, f, g, A.sfx); src.start(t, Math.random() * 0.8); src.stop(t + dur + 0.02);
  }
  var flapN = 0;                                       // melodik skinlerde sıradaki nota
  function vary(f) { return f * (0.97 + Math.random() * 0.06); }   // her vuruş ±%3 farklı (makine tekrarı gibi duyulmasın)
  // Notalar Hz: pentatonik diziler (her sıra uyumlu, hangi notada kesilse kulağı rahatsız etmez)
  var FYST_NOTES = [1318.5, 1568, 1760, 2093, 1760, 1568];      // E6 G6 A6 C7 A6 G6 — holografik arpej
  var AGA_NOTES = [784, 880, 1046.5, 1174.7, 1318.5];             // G5 A5 C6 D6 E6 — majör pentatonik, yumuşak marimba
  var SKIN_FLAP = {
    // CHEERS: şişe kapağı "pop" + cam tıngırtısı (iki kısmi ton, cam gibi uyumsuz oran 1:1.5:2.76)
    cheers: function () {
      tone('sine', 380, 900, 0.045, 0.42);
      var f = vary(2350); tone('sine', f, f, 0.16, 0.10, 0.012); tone('sine', f * 1.5, f * 1.5, 0.11, 0.06, 0.012); tone('sine', f * 2.76, f * 2.76, 0.07, 0.04, 0.012);
      hiss('highpass', 5000, 7000, 0.7, 0.05, 0.08);   // köpük fısı
    },
    // FYST: tiz hava süpürmesi + sırayla çalan parıltı arpeji (her dokunuş bir sonraki nota)
    fyst: function () {
      hiss('bandpass', 2600, 900, 0.9, 0.08, 0.28);
      var n = FYST_NOTES[flapN++ % FYST_NOTES.length];
      tone('sine', n, n, 0.22, 0.13); tone('triangle', n * 2.003, n * 2.003, 0.12, 0.05);   // ince ikinci kat (hafif kayık = parıltı)
    },
    // AGA: yaprak hışırtısı + yumuşak tahta marimba notası
    aga: function () {
      hiss('bandpass', 3200, 1800, 1.2, 0.09, 0.22);
      var n = AGA_NOTES[flapN++ % AGA_NOTES.length]; tone('triangle', n, n, 0.18, 0.16); tone('sine', n / 2, n / 2, 0.14, 0.10);
    },
    // ★ NOVA: parlak tek "ping"
    nova: function () { sfxFlapBase(0.75); tone('sine', vary(1320), 1320, 0.16, 0.14); },
    // ★★ NEBULA: nefes gibi yumuşak bulut — alçak geçiren hava + iki hafif kayık sinüs (koro)
    nebula: function () { hiss('lowpass', 1800, 500, 0.5, 0.14, 0.4); tone('sine', 523.3, 523.3, 0.2, 0.08); tone('sine', 527, 527, 0.2, 0.08); tone('sine', 784, 784, 0.16, 0.05); },
    // ★★★ QUASAR: jet/lazer "zıp" — testere dişi hızla aşağı kayar
    quasar: function () { hiss('bandpass', 1400, 500, 0.8, 0.07, 0.25); tone('sawtooth', vary(1800), 420, 0.07, 0.12); tone('square', 900, 300, 0.05, 0.05); },
    // ★4 SINGULARITY: bükülen uzay "vuuum" — derinden aşağı kayan ton (140 Hz filtresinin üstünde kalır)
    singularity: function () { hiss('lowpass', 900, 250, 1.5, 0.12, 0.3); tone('sine', vary(520), 150, 0.16, 0.38); tone('triangle', 260, 160, 0.12, 0.12); },
    // v3.1.1 ★6 ECLIPSE: alçak, yuvarlak bir gong + yumuşak hava
    eclipse: function () { hiss('lowpass', 1200, 400, 0.6, 0.12, 0.25); tone('sine', vary(440), 432, 0.32, 0.16); tone('triangle', 660, 655, 0.22, 0.06); },
    // ★7 COMET: buz gibi ince ıslık + kristal parıltı
    comet: function () { hiss('highpass', 6500, 3000, 0.7, 0.09, 0.28); tone('sine', vary(2637), 2637, 0.12, 0.08); tone('sine', 3951, 3951, 0.08, 0.04, 0.03); },
    // ★8 BOREALIS: titreşen iki kayık ton (perde gibi dalgalanır) + hafif rüzgâr
    borealis: function () { hiss('bandpass', 2200, 1400, 1.0, 0.12, 0.2); var f = AGA_NOTES[flapN++ % AGA_NOTES.length]; tone('sine', f, f, 0.26, 0.09); tone('sine', f * 1.007, f * 1.007, 0.26, 0.09); },
    // ★9 MAGNETAR: elektrik çıtırtısı — yükselen kare dalga + kısa gürültü patlaması
    magnetar: function () { hiss('bandpass', 4000, 2500, 3.0, 0.05, 0.3); tone('square', 300, vary(2400), 0.06, 0.07); tone('sine', 180, 140, 0.06, 0.3); },
    // ★10 GENESIS: görkemli üçlü akor, notalar 25 ms arayla (arpej)
    genesis: function () { hiss('lowpass', 2400, 700, 0.6, 0.1, 0.25); tone('triangle', 523.3, 523.3, 0.24, 0.11); tone('triangle', 659.3, 659.3, 0.22, 0.09, 0.025); tone('triangle', 784, 784, 0.2, 0.08, 0.05); },
    // ★5 SUPERNOVA: ateş patlaması — çıtırtılı gürültü + kızgın testere + küçük kıvılcım
    supernova: function () { hiss('bandpass', 3500, 1200, 1.4, 0.09, 0.35); tone('sawtooth', vary(620), 190, 0.08, 0.14); tone('sine', 140, 90, 0.08, 0.35); tone('sine', vary(2600), 2600, 0.06, 0.05, 0.03); }
  };

  // flap: skinin kendi sesi varsa o, yoksa standart kanat vuruşu
  function sfxFlap() {
    var fn = SKIN_FLAP[skinSel];
    if (fn) { try { fn(); return; } catch (e) { /* yoksay → standart ses */ } }
    sfxFlapBase(1);
  }
  // flap: tok bir kanat vuruşu — alçak "fıs" + kısa, derin bir gövde sesi (k = ses çarpanı)
  function sfxFlapBase(k) {
    k = k || 1;
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
    envelope(g, t, 0.45 * k, 0.006, 0.085);
    chain(src, bp, g, A.sfx);
    src.start(t, Math.random() * 0.8);
    src.stop(t + 0.11);
    // gövde: 120 Hz'den 70 Hz'e inen kısa sinüs ("tok" hissi buradan)
    var o = c.createOscillator(), og = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    envelope(og, t, 0.5 * k, 0.004, 0.08);
    chain(o, og, A.sfx);
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
    chain(o1, g1, A.sfx);
    chain(o2, g2, A.sfx);
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
    chain(n, bp, ng, A.sfx);
    n.start(t, Math.random() * 0.5); n.stop(t + 0.04);
    var o = c.createOscillator(), og = c.createGain();                   // gövde: 165 Hz (E3)
    o.type = 'sine';
    o.frequency.setValueAtTime(175, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.2);
    envelope(og, t, 0.4, 0.003, 0.22);
    chain(o, og, A.sfx);
    o.start(t); o.stop(t + 0.26);
    var s2 = c.createOscillator(), sg = c.createGain();                  // bir oktav altında yumuşak taban
    s2.type = 'triangle'; s2.frequency.value = 82.4;
    envelope(sg, t, 0.22, 0.01, 0.3);
    chain(s2, sg, A.sfx);
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
    chain(o, og, A.sfx);
    o.start(t); o.stop(t + 0.34);

    var n = c.createBufferSource(), lp = c.createBiquadFilter(), ng = c.createGain();
    n.buffer = A.noise;
    lp.type = 'lowpass'; lp.frequency.value = 280;
    envelope(ng, t, 0.7, 0.003, 0.12);
    chain(n, lp, ng, A.sfx);
    n.start(t, Math.random() * 0.5); n.stop(t + 0.12);
  }

  // Sentetik yankı: üstel sönen gürültüden üretilmiş "salon" yankısı.
  // v3.0: ses iş parçacığının en ağır işi buydu (2 yankı × 2 kanal × 2 sn). Tek kanal + 1.4 sn → 2×1×1.4 = 2.8 vs 8 → %65 daha az iş.
  // Kuyruğun sesi zaten (1−t)³ ile sönüyor: 1.4 sn'lik yankıda son yarım saniye −27 dB'nin altında, duyulmuyordu.
  function getReverb(dest) {
    dest = dest || A.sfx;
    var key = dest === A.mus ? 'reverbM' : 'reverb';
    if (A[key]) return A[key];
    var c = A.ctx, len = Math.floor(c.sampleRate * 1.4), ir = c.createBuffer(1, len, c.sampleRate);
    for (var ch = 0; ch < 1; ch++) {
      var d = ir.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    var conv = c.createConvolver(); conv.buffer = ir;
    var wet = c.createGain(); wet.gain.value = 0.55;
    chain(conv, wet, dest);
    A[key] = conv;
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
    chain(n1, f1, g1); g1.connect(A.sfx); g1.connect(rv);
    n1.start(t); n1.stop(t + 0.4);
    var t2 = t + 0.36;
    // 2) Çöküş: 70 Hz'den 22 Hz'e inen derin sinüs (göğüste hissedilen kısım)
    var sub = c.createOscillator(), sg = c.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, t2); sub.frequency.exponentialRampToValueAtTime(22, t2 + 1.6);
    envelope(sg, t2, 0.9, 0.01, 1.6);
    chain(sub, sg, A.sfx); sg.connect(rv);
    sub.start(t2); sub.stop(t2 + 1.7);
    // 3) Karanlık akor: hafif akortsuz iki testere dalga, alçak geçirenle kapanarak söner
    [110, 110 * 1.006, 73.4].forEach(function (fr, i) {
      var o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(fr, t2); o.frequency.exponentialRampToValueAtTime(fr * 0.5, t2 + 1.8);
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400, t2); lp.frequency.exponentialRampToValueAtTime(90, t2 + 1.8);
      envelope(g, t2, 0.13, 0.02, 1.8);
      chain(o, lp, g); g.connect(A.sfx); g.connect(rv);
      o.start(t2); o.stop(t2 + 1.9);
    });
    // 4) Gürleme: alçak geçirenden geçen uzun gürültü
    var n2 = c.createBufferSource(), f2 = c.createBiquadFilter(), g2 = c.createGain();
    n2.buffer = A.noise; n2.loop = true;
    f2.type = 'lowpass'; f2.frequency.setValueAtTime(600, t2); f2.frequency.exponentialRampToValueAtTime(50, t2 + 1.5);
    envelope(g2, t2, 0.5, 0.005, 1.5);
    chain(n2, f2, g2); g2.connect(A.sfx); g2.connect(rv);
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
    chain(n, bp, g, A.sfx);
    n.start(t); n.stop(t + 0.7);
    var o = c.createOscillator(), og = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.4);
    envelope(og, t, 0.45, 0.05, 0.5);
    chain(o, og, A.sfx);
    o.start(t); o.stop(t + 0.6);
  }

  // v2.5 shieldReady: kalkan doldu — iki parlak nota (C6 → G6, beşli aralık), yumuşak
  function sfxShieldReady() {
    var t = A.ctx.currentTime;
    bell(t, 1046.5, 0.32); bell(t + 0.09, 1568, 0.28);
  }

  // v2.5 shield: kalkan darbeyi yuttu — dışa patlayan alev "puuf"u (3 kHz → 250 Hz), tok bir gümleme
  // ve sönen alevin cızırtısı (4 kHz üstü, 0.5 sn)
  function sfxShield() {
    var c = A.ctx, t = c.currentTime;
    var n = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    n.buffer = A.noise; n.loop = true;
    bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(3000, t); bp.frequency.exponentialRampToValueAtTime(250, t + 0.4);
    envelope(g, t, 0.7, 0.006, 0.42);
    chain(n, bp, g, A.sfx);
    n.start(t); n.stop(t + 0.5);
    var o = c.createOscillator(), og = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.3);
    envelope(og, t, 0.85, 0.004, 0.32);
    chain(o, og, A.sfx);
    o.start(t); o.stop(t + 0.36);
    var h = c.createBufferSource(), hp = c.createBiquadFilter(), hg = c.createGain();
    h.buffer = A.noise; h.loop = true;
    hp.type = 'highpass'; hp.frequency.value = 4000;
    envelope(hg, t + 0.08, 0.16, 0.02, 0.5);
    chain(h, hp, hg, A.sfx);
    h.start(t + 0.08); h.stop(t + 0.65);
  }

  // v1.5 bump: ölümcül olmayan çarpma — kağıt buruşması (bant geçiren gürültü) + tok bir "tunk"
  function sfxBump() {
    var c = A.ctx, t = c.currentTime;
    var n = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain();
    n.buffer = A.noise;
    bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(2200, t); bp.frequency.exponentialRampToValueAtTime(700, t + 0.18);
    envelope(ng, t, 0.6, 0.002, 0.18);
    chain(n, bp, ng, A.sfx);
    n.start(t, Math.random() * 0.5); n.stop(t + 0.2);
    var o = c.createOscillator(), og = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    envelope(og, t, 0.8, 0.003, 0.22);
    chain(o, og, A.sfx);
    o.start(t); o.stop(t + 0.26);
  }

  // v1.5 break: kule çöküşü — alçak geçirenden geçen uzun moloz gürültüsü + çatırtılar
  function sfxBreak() {
    var c = A.ctx, t = c.currentTime + 0.03;
    var n = c.createBufferSource(), lp = c.createBiquadFilter(), g = c.createGain();
    n.buffer = A.noise; n.loop = true;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(120, t + 0.6);
    envelope(g, t, 0.45, 0.01, 0.6);
    chain(n, lp, g, A.sfx);
    n.start(t); n.stop(t + 0.65);
    for (var i = 0; i < 4; i++) {                                      // taş çatırtıları
      var tk = t + 0.04 + i * 0.07 + Math.random() * 0.04;
      var k = c.createBufferSource(), hp = c.createBiquadFilter(), kg = c.createGain();
      k.buffer = A.noise; hp.type = 'highpass'; hp.frequency.value = 1500;
      envelope(kg, tk, 0.25 - i * 0.04, 0.001, 0.04);
      chain(k, hp, kg, A.sfx);
      k.start(tk, Math.random() * 0.5); k.stop(tk + 0.05);
    }
  }

  // v2.2 checkpoint: iki notalı parlak çan (beşli aralık: 784 → 1175 Hz)
  function sfxCheckpoint() {
    var t = A.ctx.currentTime;
    bell(t, 784, 0.5); bell(t + 0.12, 1175, 0.45);
  }
  // v2.2 can geri geldi: yükselen kısa blip
  function sfxLife() {
    var c = A.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(1040, t + 0.12);
    envelope(g, t, 0.35, 0.005, 0.2); chain(o, g, A.sfx); o.start(t); o.stop(t + 0.25);
  }
  // v2.2 yolculuk sonu: majör akor arpeji + uzun yankı
  function sfxComplete() {
    var t = A.ctx.currentTime, rv = getReverb();
    [523, 659, 784, 1047, 1319].forEach(function (f, i) {
      var c = A.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      envelope(g, t + i * 0.09, 0.3, 0.01, 1.6); o.connect(g); g.connect(A.sfx); g.connect(rv);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 1.8);
    });
  }

  // v2.5 finale: kara deliğe çekilme — 3.4 sn boyunca inen ve yükselen emiş (3 kHz → 60 Hz), sonunda derin çöküş
  function sfxFinale() {
    var c = A.ctx, t = c.currentTime, rv = getReverb();
    var n = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    n.buffer = A.noise; n.loop = true; bp.type = 'bandpass'; bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(3000, t); bp.frequency.exponentialRampToValueAtTime(60, t + 3.3);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 3.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.45);
    chain(n, bp, g, A.sfx); g.connect(rv); n.start(t); n.stop(t + 3.5);
    var o = c.createOscillator(), og = c.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(30, t + 3.3);
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.35, t + 3.0); og.gain.exponentialRampToValueAtTime(0.0001, t + 3.45);
    chain(o, lp, og, A.sfx); o.start(t); o.stop(t + 3.5);
  }
  function sfxFinaleEnd() {
    var c = A.ctx, t = c.currentTime, rv = getReverb();
    var o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(24, t + 2.2);
    envelope(g, t, 1.0, 0.005, 2.4); chain(o, g, A.sfx); g.connect(rv); o.start(t); o.stop(t + 2.5);
    var n = c.createBufferSource(), lp = c.createBiquadFilter(), ng = c.createGain();
    n.buffer = A.noise; lp.type = 'lowpass'; lp.frequency.setValueAtTime(4000, t); lp.frequency.exponentialRampToValueAtTime(100, t + 0.8);
    envelope(ng, t, 0.8, 0.003, 0.9); chain(n, lp, ng, A.sfx); ng.connect(rv); n.start(t); n.stop(t + 1);
    setTimeout(sfxComplete, 900);                    // çöküşün ardından yolculuk tamam arpeji
  }

  var SFX = { flap: sfxFlap, score: sfxScore, hit: sfxHit, die: sfxDie, milestone: sfxMilestone, bump: sfxBump, shield: sfxShield, shieldReady: sfxShieldReady, 'break': sfxBreak, checkpoint: sfxCheckpoint, life: sfxLife, complete: sfxFinale, finaleEnd: sfxFinaleEnd };

  // ---------- Müzik (v2.4): motor music.js'te (KK.Music) — oyun ve müzik editörü AYNI motoru kullanır ----------
  // Temalar: varsayılan ← yayınlanmış music.json ← bu cihazda editörle kaydedilen (editor.html)
  var MUSIC_VOL = 0.24, music = null, musicThemes = null, musicLastMode = null;
  var M = { dirty: false };   // eski API uyumu (müzik düğmesi)
  if (KK.Music) KK.Music.load().then(function (list) { musicThemes = list; if (music) music.setThemes(list); });

  // v2.5: ışıkların müziğe göre yanıp sönmesi için zarf: max(a · e^(−7·(şimdi − vuruş)))  → 0.1 sn'de yarıya iner
  var beats = [];
  KK.musicPulse = function () {
    if (!A.ctx || !music || muted || volMus <= 0 || paused) { beats.length = 0; return 0; }
    var now = A.ctx.currentTime, v = 0;
    while (beats.length && now - beats[0].t > 1) beats.shift();
    // v2.6: sönüm e^(−7t) → e^(−5t): yarılanma 0.10 sn → 0.14 sn (göz daha rahat yakalar)
    for (var i = 0; i < beats.length; i++) { var d = now - beats[i].t; if (d >= 0) v = Math.max(v, beats[i].a * Math.exp(-5 * d)); }
    return v;
  };
  // v3.1.1: Hızlanınca seslerin tamamen gitmesi: tek bir filtre bir an bozuk sayı (NaN) üretirse, ana zincirdeki kalıcı
  // filtreler (140 Hz yüksek geçiren, müzik filtresi) o sayıyı hafızasında tutar ve SONSUZA KADAR sessiz kalır.
  // Bekçi saniyede 2 kez çıkışa bakar; bozuksa ses bağlamını kapatıp her şeyi temiz kurar (müzik kaldığı temadan devam eder).
  var audioResets = 0;
  function audioWatchdog() {
    var now = performance.now();
    if (!A.an || now - A.wdT < 500) return;
    A.wdT = now;
    A.an.getFloatTimeDomainData(A.wdBuf);
    for (var i = 0; i < A.wdBuf.length; i += 8) if (!isFinite(A.wdBuf[i])) { resetAudio(); return; }
  }
  function resetAudio() {
    audioResets++;
    try { if (music) music.stop(); } catch (e) { /* yoksay */ }
    music = null; beats.length = 0;            // eski bağlamın zaman damgaları yeni bağlamda geçersiz
    var old = A.ctx;
    ['ctx', 'master', 'noise', 'out', 'sfx', 'mus', 'reverb', 'reverbM', 'an', 'wdBuf'].forEach(function (k) { A[k] = null; });
    try { if (old) old.close(); } catch (e) { /* yoksay */ }
    unlockAudio();
  }
  KK.audioResets = function () { return audioResets; };   // test kancaları
  KK.__audio = function () { return A; };
  function musicUpdate(s) {
    if (!A.ctx || !KK.Music) return;
    audioWatchdog();
    if (!A.ctx) return;
    var want = Math.floor((s.score || 0) / (KK.PLANET_EVERY || 200));
    if (!music) {
      if (A.ctx.state !== 'running') return;
      music = KK.Music.create({ ctx: A.ctx, out: A.mus, noise: A.noise, reverb: getReverb(A.mus), vol: MUSIC_VOL, themes: musicThemes });
      music.jump(want); music.start();
      // v2.5: müzik nabzı — her dörtlükte bir vuruş (ölçü başı tam, diğerleri %65); ışıklar bunu okur
      // v2.6: ölçü başı 1.0, 3. vuruş 0.7, diğerleri 0.45 → "güm . tak ." vurgusu daha belirgin
      music.onStep = function (b, chord, t) { if (b % 4 === 0) beats.push({ t: t, a: b === 0 ? 1 : b === 8 ? 0.7 : 0.45 }); };
    }
    if (s.mode === 'ready' && musicLastMode !== 'ready') music.jump(want);   // yeni tur checkpoint temasından başlar
    musicLastMode = s.mode;
    music.update({ mode: s.mode, mult: s.mult || 1, fireOut: !!s.fireOut, hush: s.mode === 'dead' || s.mode === 'finale' || paused, on: volMus > 0, want: want });
  }

  function setMuted(v) {
    muted = !!v;
    writeStore(MUTE_KEY, muted ? '1' : '0');
    if (A.master && A.ctx) {
      A.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOL, A.ctx.currentTime, 0.02);
      if (!muted) {                                     // v2.5: müzik kanalını ve motoru yeniden ayarla
        if (A.mus) A.mus.gain.setTargetAtTime(volGain(volMus), A.ctx.currentTime, 0.02);
        if (music) music.state.last = null;
        if (A.ctx.state !== 'running') { try { A.ctx.resume(); } catch (e) { /* yoksay */ } }
      }
    }
    renderMute();
  }

  // ---------- v2.0: Skinler, dev hediyesi, durdurma ----------
  var SKIN_KEY = 'kk.skin', DEV_KEY = 'kk.dev', CODES_KEY = 'kk.codes', MUSIC_KEY = 'kk.music';
  // Dev hediyesi kodunun SHA-256 özeti ('paperwing:' + KOD). Kodun kendisi hiçbir dosyada yok:
  // özetten koda geri dönmek mümkün değil; tahminle bulmak 32^12 ≈ 1.2·10^18 deneme ister.
  // v3.0: birden fazla gizli skin — her kodun özeti bir skini açar (kodlar dosyada yok, sadece özetleri)
  var CODE_SKINS = {
    '078af0359ac79e276cb61799f7312c35298086ceb461f2eb0909933cfa1543aa': { id: 'fyst',   msg: 'Dev gift unlocked ✦' },
    '2f76b5a7a11b2f436cccbf9306f1d3c5a02b74d91332de55e701131a27db11bf': { id: 'aga',    msg: 'AGA unlocked ♥' },
    'b8eb0345bf8a22d06380b4a5665f9a6c00de553ed9d5b8515c7d0d842bf2b4a8': { id: 'cheers', msg: 'Cheers! 🍺' }
  };
  var owned = {};          // açılmış gizli skinler: { fyst: true, ... }
  function readCodes() { try { var a = JSON.parse(readStore(CODES_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  var skinSel = readStore(SKIN_KEY) || 'paper';   // uçarken kullanılan (kilidi açık) skin
  var browse = skinSel;                            // ana ekranda göz atılan (kilitli de olabilir)
  var musicOn = readStore(MUSIC_KEY) !== '0';
  var paused = false, resumeAt = 0, devTaps = [];
  // v2.2: ilerleme — son checkpoint (skor) ve bitiş yıldızları (rebirth sayısı)
  var CP_KEY = 'kk.cp', STAR_KEY = 'kk.stars';
  // ---- v2.5: Skor tablosu (bu cihazdaki en iyi 10 tur) ----
  var SCORES_KEY = 'kk.scores', BOARD_N = 10, NAME_ASKED_KEY = 'kk.nameAsked';
  function readScores() {
    try { var a = JSON.parse(readStore(SCORES_KEY) || '[]'); return Array.isArray(a) ? a.filter(function (x) { return x && x.s > 0; }) : []; } catch (e) { return []; }
  }
  // Turu tabloya ekler; tabloya girdiyse sırasını (0..9), girmediyse -1 döndürür
  function addScore(score) {
    if (!(score > 0)) return -1;
    var every = KK.PLANET_EVERY || 200, names = KK.BODY_NAMES || [];
    var e = { s: score, d: Date.now(), p: Math.min(Math.max(0, names.length - 1), Math.floor(score / every)), r: stars };
    var list = readScores(); list.push(e);
    list.sort(function (a, b) { return b.s - a.s || a.d - b.d; });   // eşit puanda önce yapan üstte
    list = list.slice(0, BOARD_N);
    writeStore(SCORES_KEY, JSON.stringify(list));
    return list.indexOf(e);
  }
  var boardTab = null, boardReq = 0;
  function online() { return !!(KK.Online && KK.Online.enabled()); }
  function renderBoard() {
    if (!boardTab) boardTab = online() ? 'week' : 'local';
    var on = online();
    el.tabs.hidden = !on;
    Object.keys(el.tabBtns).forEach(function (k) { var b = el.tabBtns[k]; b.classList.toggle('is-on', k === boardTab); b.setAttribute('aria-selected', k === boardTab ? 'true' : 'false'); });
    el.nameForm.hidden = true; el.boardMe.hidden = true;
    if (boardTab !== 'local' && on) return renderOnline(boardTab);
    renderLocal();
  }
  function renderOnline(which) {
    var ol = el.boardList, req = ++boardReq;
    ol.innerHTML = '';
    if (!KK.Online.name()) {                         // ilk kez: isim seç
      el.nameForm.hidden = false; el.nameInput.value = '';
      ol.appendChild(h('li', 'kk-board-empty', 'Pick a name to join the scoreboard. Your best run goes up automatically.'));
      return;
    }
    // v2.5.1: son gönderim başarısızsa sebebi görünsün (ör. "write 403", "Load failed") ve bekleyen skor yeniden denensin
    var st = KK.Online.status(), pend = KK.Online.pending();
    el.boardMe.hidden = false;
    el.boardMe.textContent = 'You: ' + KK.Online.name() + ' \u00b7 change' + (pend ? '\n\u26a0 ' + pend.score + ' not sent yet' + (st && !st.ok && st.err ? ' (' + st.err + ')' : '') : '');
    if (pend) KK.Online.flush().then(function (ok) { if (ok && req === boardReq) renderOnline(which); }, noop);
    ol.appendChild(h('li', 'kk-board-empty', 'Loading\u2026'));
    KK.Online.top(which === 'week' ? 'week' : 'alltime', 20).then(function (rows) {
      if (req !== boardReq) return;
      ol.innerHTML = '';
      if (!rows.length) { ol.appendChild(h('li', 'kk-board-empty', which === 'week' ? 'No scores this week yet. Be the first!' : 'No scores yet. Be the first!')); return; }
      rows.forEach(function (x, i) {
        var li = h('li', 'kk-board-row' + (x.me ? ' is-new' : ''));
        li.appendChild(h('span', 'kk-board-rank', String(i + 1)));
        li.appendChild(h('span', 'kk-board-score', String(x.score)));
        li.appendChild(h('span', 'kk-board-where', x.name + (x.stars ? ' ' + new Array(Math.min(x.stars, 3) + 1).join('\u2605') : '')));
        li.appendChild(h('span', 'kk-board-date', ''));
        ol.appendChild(li);
      });
    }, function () {
      if (req !== boardReq) return;
      ol.innerHTML = ''; ol.appendChild(h('li', 'kk-board-empty', 'Can\u2019t reach the scoreboard right now. Check your connection.'));
    });
  }
  function renderLocal() {
    var list = readScores(), names = KK.BODY_NAMES || [], ol = el.boardList;
    ol.innerHTML = '';
    if (!list.length) { var em = h('li', 'kk-board-empty', 'No flights yet. Your best runs will land here.'); ol.appendChild(em); return; }
    var newest = list.reduce(function (m, x) { return x.d > m ? x.d : m; }, 0);
    list.forEach(function (x, i) {
      var li = h('li', 'kk-board-row' + (x.d === newest ? ' is-new' : ''));
      var dt = new Date(x.d);
      li.appendChild(h('span', 'kk-board-rank', String(i + 1)));
      li.appendChild(h('span', 'kk-board-score', String(x.s)));
      li.appendChild(h('span', 'kk-board-where', (names[x.p] || '') + (x.r ? ' ' + new Array(Math.min(x.r, 3) + 1).join('★') : '')));
      li.appendChild(h('span', 'kk-board-date', dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })));
      ol.appendChild(li);
    });
  }
  function submitOnline(s) {
    if (!KK.Online || !s) return;
    var run = (s.score | 0) - (s.startScore | 0);
    if (run <= 0) return;
    try { KK.Online.submit({ score: s.score | 0, run: run, secs: s.runTime || 0, stars: stars, skin: skinSel }); } catch (e) { /* yoksay */ }
  }
  function openBoard() { renderBoard(); toggle(el.board, 'board', true); }
  // v2.5.1: isim girmeyen oyuncunun skoru hiç gönderilmiyordu (tabloyu hiç açmayan = tabloda yok).
  // İlk düşüşte isim kutusu bir kez kendiliğinden açılır; skor bekler, isim kaydedilince gönderilir.
  function askNameOnce(score) {
    if (!online() || KK.Online.name() || !(score > 0) || readStore(NAME_ASKED_KEY)) return;
    writeStore(NAME_ASKED_KEY, '1');
    setTimeout(function () { if (cfg.getState() && cfg.getState().mode === 'dead' && !shown.board) { boardTab = 'week'; openBoard(); } }, 1100);
  }
  function closeBoard() { toggle(el.board, 'board', false); }
  var checkpoint = parseInt(readStore(CP_KEY), 10) || 0;
  var stars = parseInt(readStore(STAR_KEY), 10) || 0;
  var finishing = false;
  function bodyName(score) {
    var n = KK.BODY_NAMES || [], every = KK.PLANET_EVERY || 200;
    return n[Math.min(n.length - 1, Math.floor(score / every))] || '';
  }
  function renderProgress() {
    if (!el.progress) return;
    el.progress.textContent = checkpoint ? 'Checkpoint ' + checkpoint + ' \u00b7 ' + bodyName(checkpoint) : '';
    if (el.starBadge) { el.starBadge.textContent = stars ? '\u2605 ' + stars : ''; el.starBadge.title = stars ? stars + ' journey' + (stars > 1 ? 's' : '') + ' completed' : ''; }
  }
  function finishJourney() {
    finishing = true; paused = true; resumeAt = 0;
    var st = cfg.getState();
    if (st && st.score > best) { best = st.score; writeStore(BEST_KEY, best); }
    if (st) { addScore(st.score); submitOnline(st); }   // v2.5: tamamlanan yolculuk da tabloya girer
    var next = stars + 1, gift = (KK.SKINS || []).filter(function (k) { return k.stars === next; })[0];
    el.finStars.textContent = new Array(Math.min(next, 5) + 1).join('★') + (next > 5 ? ' ' + next : '');
    el.finGift.textContent = (gift ? 'New skin: ' + gift.name + ' · ' : '') + 'Next journey: a bit harder';
    toggle(el.finish, 'finish', true);
  }
  function rebirth() {
    stars++; writeStore(STAR_KEY, stars);
    checkpoint = 0; writeStore(CP_KEY, 0);
    var gift = (KK.SKINS || []).filter(function (k) { return k.stars === stars; })[0];
    if (gift) { skinSel = browse = gift.id; writeStore(SKIN_KEY, skinSel); }
    finishing = false; paused = false;
    toggle(el.finish, 'finish', false);
    renderSkin(); renderProgress();
    cfg.onRestart();
  }

  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function sha256(text) {
    if (!(window.crypto && crypto.subtle && window.TextEncoder)) return Promise.reject(new Error('no crypto'));
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }
  // kod → açtığı skin kaydı (yoksa null)
  function checkCode(code) { return sha256('paperwing:' + normCode(code)).then(function (h) { return CODE_SKINS[h] || null; }); }

  function skinList() { return (KK.SKINS || []).filter(function (k) { return !k.secret || owned[k.id]; }); }
  function skinUnlocked(k) { return k.secret ? !!owned[k.id] : k.stars ? stars >= k.stars : best >= (k.req || 0); }
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
    el.skinName.style.fontSize = k && k.name.length > 12 ? '1em' : '';   // v3.0.3: uzun isimler biraz küçük (1.1 → 1em) — "..." ile kesilmesin
    el.skinLock.textContent = !k ? '' : skinUnlocked(k) ? (i + 1) + ' / ' + l.length : (k.stars ? 'LOCKED · finish the journey' + (k.stars > 1 ? ' ' + k.stars + '×' : '') : 'LOCKED · reach ' + k.req);
    el.skins.classList.toggle('is-locked', !!k && !skinUnlocked(k));
    // v3.0: isim stilleri — DEV FYST holografik logo yazısı, AGA yeşil-altın, CHEERS bira köpüğü, ★ skinler gökkuşağı
    var st = !k ? '' : k.id === 'fyst' ? 'dev' : k.id === 'aga' ? 'aga' : k.id === 'cheers' ? 'cheers' : k.stars ? 'star' : '';
    ['dev', 'aga', 'cheers', 'star'].forEach(function (c) { el.skins.classList.toggle('is-' + c, st === c); });
  }

  function pause() {
    var s = cfg && cfg.getState();
    if (!s || s.mode !== 'playing' || (paused && !resumeAt)) return;
    paused = true; resumeAt = 0;
    toggle(el.paused, 'paused', true); el.count.textContent = '';
    renderMusicBtn();
  }
  function resume() {
    if (!paused || resumeAt || finishing) return;
    toggle(el.paused, 'paused', false);
    resumeAt = performance.now() + 1500;           // 3-2-1 geri sayım (0.5 sn'de bir), sonra devam
  }
  function restartFromPause() {
    paused = false; resumeAt = 0;
    toggle(el.paused, 'paused', false); el.count.textContent = '';
    cfg.onRestart();
  }
  function renderMusicBtn() { renderVol(); }   // v2.5: müzik açma/kapama yerine ses kaydırıcıları
  function setVol(kind, v) {
    v = Math.max(0, Math.min(100, Math.round(v)));
    if (kind === 'mus') { volMus = v; writeStore(VOL_MUS_KEY, String(v)); if (A.mus) A.mus.gain.setTargetAtTime(volGain(v), A.ctx.currentTime, 0.03); if (music) music.state.last = null; }
    else { volSfx = v; writeStore(VOL_SFX_KEY, String(v)); if (A.sfx) A.sfx.gain.setTargetAtTime(volGain(v), A.ctx.currentTime, 0.03); }
    renderVol();
  }
  function renderVol() {
    if (!el.volMus) return;
    el.volMus.value = volMus; el.volSfx.value = volSfx;
    el.volMusOut.textContent = volMus ? volMus + '%' : 'Off'; el.volSfxOut.textContent = volSfx ? volSfx + '%' : 'Off';
  }


  function openCode() {
    toggle(el.code, 'code', true);
    el.codeMsg.textContent = ''; el.codeInput.value = '';
    setTimeout(function () { try { el.codeInput.focus(); } catch (e) { /* yoksay */ } }, 50);
  }
  function closeCode() { toggle(el.code, 'code', false); try { el.codeInput.blur(); } catch (e) { /* yoksay */ } }
  function submitCode() {
    var v = el.codeInput.value;
    checkCode(v).then(function (hit) {
      if (!hit) { el.codeMsg.textContent = 'Wrong code'; el.codeCard.classList.remove('kk-shake'); void el.codeCard.offsetWidth; el.codeCard.classList.add('kk-shake'); return; }
      owned[hit.id] = true;
      var list = readCodes(), n = normCode(v); if (list.indexOf(n) < 0) { list.push(n); writeStore(CODES_KEY, JSON.stringify(list)); }
      browse = skinSel = hit.id; writeStore(SKIN_KEY, skinSel);
      el.codeMsg.textContent = hit.msg;
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
    var starBadge = h('p', 'kk-starbadge');          // v2.5: kazanılan ★ (bitirilen yolculuk) — başlığın altında
    ready.appendChild(starBadge);
    var progress = h('p', 'kk-progress');
    ready.appendChild(progress);
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
    // v2.5: ayrı müzik ve efekt sesi
    function volRow(id, label) {
      var row = h('label', 'kk-vol'); row.setAttribute('for', id);
      var name = h('span', 'kk-vol-name', label), out = h('span', 'kk-vol-out', '100%');
      var inp = h('input', 'kk-input kk-range'); inp.type = 'range'; inp.id = id; inp.min = 0; inp.max = 100; inp.step = 5;
      row.appendChild(name); row.appendChild(inp); row.appendChild(out);
      return { row: row, inp: inp, out: out };
    }
    var vm = volRow('kk-vol-mus', 'Music'), vs = volRow('kk-vol-sfx', 'Effects');
    pcard.appendChild(resumeBtn); pcard.appendChild(restartBtn); pcard.appendChild(vm.row); pcard.appendChild(vs.row);
    pausedL.appendChild(pcard);
    var count = h('div', 'kk-count');
    // v2.2: Yolculuk sonu → rebirth
    var finL = h('div', 'kk-layer kk-finish');
    var fcard = h('div', 'kk-card kk-fcard');
    fcard.appendChild(h('p', 'kk-label', 'Journey complete'));
    var finStars = h('p', 'kk-fin-stars', '★');
    var finGift = h('p', 'kk-fin-gift');
    var rebirthBtn = h('button', 'kk-btn kk-again', 'Rebirth'); rebirthBtn.type = 'button';
    fcard.appendChild(finStars); fcard.appendChild(finGift); fcard.appendChild(rebirthBtn);
    finL.appendChild(fcard);
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

    // v2.5: Skor tablosu: sol üstte kupa düğmesi (ana ekran ve bitiş ekranında) + kâğıt kart
    var boardBtn = h('button', 'kk-btn kk-boardbtn');
    boardBtn.type = 'button'; boardBtn.setAttribute('aria-label', 'Top scores'); boardBtn.title = 'Top scores';
    boardBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" fill="currentColor"/><path d="M7 6H4.5a2.5 2.5 0 0 0 2.6 3.6M17 6h2.5a2.5 2.5 0 0 1-2.6 3.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 13h3v3.5h-3zM8 19h8v1.6H8z" fill="currentColor"/><path d="M9.5 16.5h5l.8 2.5H8.7z" fill="currentColor"/></svg>';
    var boardL = h('div', 'kk-layer kk-board');
    var bcard = h('div', 'kk-card kk-bcard');
    bcard.appendChild(h('h2', 'kk-card-title', 'Top scores'));
    // v2.5: sekmeler — This week / All time (çevrimiçi, herkes) · This phone (bu cihaz)
    var tabs = h('div', 'kk-tabs'); tabs.setAttribute('role', 'tablist');
    var tabBtns = {};
    [['week', 'This week'], ['alltime', 'All time'], ['local', 'This phone']].forEach(function (tb) {
      var b = h('button', 'kk-btn kk-tab', tb[1]); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.tab = tb[0];
      tabs.appendChild(b); tabBtns[tb[0]] = b;
    });
    bcard.appendChild(tabs);
    var nameForm = h('form', 'kk-nameform');
    var nameLbl = h('p', 'kk-label', 'Your name on the scoreboard');
    var nameInput = h('input', 'kk-input kk-nameinput'); nameInput.type = 'text'; nameInput.maxLength = 14; nameInput.autocomplete = 'nickname'; nameInput.placeholder = 'Name';
    var nameOk = h('button', 'kk-btn kk-again', 'Save'); nameOk.type = 'submit';
    nameForm.appendChild(nameLbl); nameForm.appendChild(nameInput); nameForm.appendChild(nameOk);
    bcard.appendChild(nameForm);
    var boardList = h('ol', 'kk-board-list');
    var boardMe = h('button', 'kk-btn kk-board-me'); boardMe.type = 'button';
    var boardClose = h('button', 'kk-btn kk-ghost', 'Close'); boardClose.type = 'button';
    bcard.appendChild(boardList); bcard.appendChild(boardMe); bcard.appendChild(boardClose);
    boardL.appendChild(bcard);

    // Ekran okuyucu duyurusu
    var live = h('p', 'kk-sr');
    live.setAttribute('aria-live', 'polite');

    frame.appendChild(ready);
    frame.appendChild(dead);
    frame.appendChild(pausedL);
    frame.appendChild(codeL);
    frame.appendChild(finL);
    frame.appendChild(boardL);
    frame.appendChild(count);
    frame.appendChild(pauseBtn);
    frame.appendChild(mute);
    frame.appendChild(boardBtn);
    root.appendChild(frame);
    root.appendChild(live);

    el = {
      root: root, frame: frame, ready: ready, readyBest: readyBest,
      dead: dead, badge: badge, scoreVal: scoreVal, deadBest: deadBest,
      again: again, hint: hint, mute: mute, live: live,
      skins: skins, prev: prev, next: next, skinName: skinName, skinLock: skinLock, devtap: devtap,
      pauseBtn: pauseBtn, paused: pausedL, resumeBtn: resumeBtn, restartBtn: restartBtn, count: count,
      volMus: vm.inp, volSfx: vs.inp, volMusOut: vm.out, volSfxOut: vs.out,
      progress: progress, starBadge: starBadge, finish: finL, finStars: finStars, finGift: finGift, rebirthBtn: rebirthBtn,
      code: codeL, codeCard: ccard, codeInput: codeInput, codeMsg: codeMsg, codeCancel: codeCancel,
      board: boardL, boardBtn: boardBtn, boardList: boardList, boardClose: boardClose,
      tabs: tabs, tabBtns: tabBtns, nameForm: nameForm, nameInput: nameInput, boardMe: boardMe
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
    s.setProperty('--kk-b', Math.max(0, window.innerHeight - r.bottom) + 'px');   // v3.0: alt düğmeler için
  }

  // ---------- Girdi ----------
  function isButton(target) {
    // v3.0: skin seçici satırı da (oklar arası boşluk dahil) oyunu başlatmaz
    return !!(target && target.closest && target.closest('.kk-btn, .kk-input, .kk-ccard, .kk-bcard, .kk-board, .kk-skins'));
  }

  // Ortak eylem: moda göre kanat çırp ya da yeniden başla
  function act() {
    var s = cfg.getState();
    if (!s || paused || shown.code || shown.board) return;
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
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) { if (e.key === 'Escape') closeCode(); return; }  // kod yazılırken oyun tuşları kapalı
    var code = e.code || '';
    var key = e.key || '';
    if (shown.board) { if (code === 'Escape' || key === 'Escape') { e.preventDefault(); closeBoard(); } return; }
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
    el.rebirthBtn.addEventListener('click', function (e) { releaseFocus(e, el.rebirthBtn); rebirth(); });
    el.pauseBtn.addEventListener('click', function (e) { unlockAudio(); releaseFocus(e, el.pauseBtn); pause(); });
    el.boardBtn.addEventListener('click', function (e) { releaseFocus(e, el.boardBtn); openBoard(); });
    el.boardClose.addEventListener('click', function (e) { releaseFocus(e, el.boardClose); closeBoard(); });
    el.board.addEventListener('pointerdown', function (e) { if (e.target === el.board) { e.stopPropagation(); closeBoard(); } });
    Object.keys(el.tabBtns).forEach(function (k) { el.tabBtns[k].addEventListener('click', function (e) { releaseFocus(e, el.tabBtns[k]); boardTab = k; renderBoard(); }); });
    el.nameForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = el.nameInput.value; try { el.nameInput.blur(); } catch (er) { /* yoksay */ }
      KK.Online.setName(v).then(function () { renderBoard(); }, function () { renderBoard(); });
      if (KK.Online.name()) renderBoard();
    });
    el.boardMe.addEventListener('click', function (e) {
      releaseFocus(e, el.boardMe);
      el.nameForm.hidden = false; el.boardMe.hidden = true; el.nameInput.value = KK.Online.name() || ''; el.nameInput.focus();
    });
    el.resumeBtn.addEventListener('click', function (e) { releaseFocus(e, el.resumeBtn); resume(); });
    el.restartBtn.addEventListener('click', function (e) { releaseFocus(e, el.restartBtn); restartFromPause(); });
    el.volMus.addEventListener('input', function () { unlockAudio(); setVol('mus', +el.volMus.value); });
    el.volSfx.addEventListener('input', function () { unlockAudio(); setVol('sfx', +el.volSfx.value); });

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
      var rank = finishing ? -1 : addScore(score);   // v2.5: skor tablosu (yolculuk bitişi kendi kaydını yapar)
      if (!finishing) submitOnline(s);
      askNameOnce(score);
      // v2.0: bu turda açılan skinler
      var fresh = skinList().filter(function (k) { return !k.secret && k.req > oldBest && k.req <= best; }).map(function (k) { return k.name; });
      el.deadBest.textContent = 'Best: ' + best + (fresh.length ? '  \u00b7  New skin: ' + fresh.join(', ') : '') + (checkpoint ? ' · next flight from ' + checkpoint : '') + (rank >= 0 ? ' \u00b7 #' + (rank + 1) + ' on your board' : '');
      el.badge.classList.toggle('is-on', isRecord && score > 0);
      el.live.textContent = 'Crashed. Score ' + score + (isRecord && score > 0 ? '. New best!' : '. Best ' + best + '.');
    } else if (mode === 'ready') {
      el.readyBest.textContent = 'Best: ' + best;
      browse = skinSel; renderSkin(); renderProgress();
      if (document.activeElement === el.again) el.again.blur();
    }
  }

  // ---------- Genel API ----------
  // ---- v2.5: iPhone kurulum rehberi ----
  // iOS'ta uygulama dosyası paylaşılamaz; link WhatsApp'tan atılır, oyun Safari'den ana ekrana eklenir.
  // Sadece iPhone/iPad'de ve oyun ana ekrandan AÇILMAMIŞSA, hazır ekranında görünür. Kapatılırsa bu oturumda bir daha çıkmaz.
  var iosHint = null;
  function isIOS() { var u = navigator.userAgent || ''; return /iPad|iPhone|iPod/.test(u) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isStandalone() { return navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches); }
  function buildIosHint() {
    if (!isIOS() || isStandalone()) return;
    try { if (sessionStorage.getItem('kk.ioshint') === '0') return; } catch (e) { /* yoksay */ }
    var SHARE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="vertical-align:-3px"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10H6v10h12V10h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    iosHint = document.createElement('div');
    iosHint.className = 'kk-ios'; iosHint.setAttribute('role', 'note');
    iosHint.innerHTML = '<button class="kk-ios-x" type="button" aria-label="Close">\u00d7</button>' +
      '<b class="kk-ios-t">Install on iPhone</b>' +
      '<ol><li>Opened from WhatsApp? Tap <b>\u22ef</b> and choose <b>Open in Safari</b></li>' +
      '<li>Tap ' + SHARE + ' <b>Share</b></li><li>Choose <b>Add to Home Screen</b></li></ol>';
    iosHint.querySelector('.kk-ios-x').addEventListener('click', function (e) {
      e.stopPropagation(); iosHint.remove(); iosHint = null;
      try { sessionStorage.setItem('kk.ioshint', '0'); } catch (er) { /* yoksay */ }
    });
    iosHint.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    document.body.appendChild(iosHint);
  }

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
      renderSkin(); renderMusicBtn(); renderProgress();
      buildIosHint();
      if (KK.Online) { try { KK.Online.flush(); } catch (e) { /* yoksay */ } }   // v2.5: bekleyen skoru gönder
      // kayıtlı kodlar hâlâ doğru mu? (özetle kontrol) — v2.x'ten kalan tek dev kodu (kk.dev) da sayılır
      var saved = readCodes(), legacy = readStore(DEV_KEY); if (legacy && saved.indexOf(normCode(legacy)) < 0) saved.push(normCode(legacy));
      if (saved.length) Promise.all(saved.map(function (c) { return checkCode(c).catch(function () { return null; }); })).then(function (hits) {
        var any = false; hits.forEach(function (hh) { if (hh) { owned[hh.id] = true; any = true; } });
        if (any) { skinSel = readStore(SKIN_KEY) || skinSel; browse = skinSel; renderSkin(); }
      }, noop);
    },
    isPaused: function () { return paused; },
    startOpts: function () { return { score: checkpoint, rebirth: stars }; },
    skinFor: function (mode) { return mode === 'ready' ? browse : skinSel; },

    getBest: function () { return best; },
    _audio: A, _music: M, _musicEngine: function () { return music; },   // test kancaları

    handleEvents: function (events, state) {
      if (!events || !events.length) return;
      var play = canPlay();
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (ev === 'checkpoint' && state.score > checkpoint) { checkpoint = state.score; writeStore(CP_KEY, checkpoint); }
        if (ev === 'finaleEnd') finishJourney();   // v2.5: kart, kara delik finali bitince açılır
        if (ev === 'hit' || ev === 'bump' || ev === 'shield') {
          try { if (navigator.vibrate) navigator.vibrate(ev === 'bump' ? [30, 40, 30] : ev === 'shield' ? 25 : 40); } catch (e) { /* yoksay */ }
        }
        if (play && SFX[ev]) {
          try { SFX[ev](); } catch (e) { /* ses hatası oyunu durdurmasın */ }
        }
      }
    },

    update: function (state) {
      if (iosHint) iosHint.hidden = !state || state.mode !== 'ready';
      if (!state || !el.root) return;
      try { musicUpdate(state); } catch (e) { /* müzik hatası oyunu durdurmasın */ }
      toggle(el.pauseBtn, 'pauseBtn', state.mode === 'playing' && !paused);
      toggle(el.boardBtn, 'boardBtn', (state.mode === 'ready' || state.mode === 'dead') && !paused);
      if (paused && !finishing && state.mode !== 'playing') { paused = false; resumeAt = 0; toggle(el.paused, 'paused', false); el.count.textContent = ''; }
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
