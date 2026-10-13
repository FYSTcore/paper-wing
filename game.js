// game.js — Kağıt Kanat oyun mantığı (fizik, kuleler, skor, çarpışma)
// Çizim ve ses yok: sadece state nesnesini günceller. render.js ve ui.js bu state'i OKUR.
(function () {
  'use strict';
  window.KK = window.KK || {};
  var KK = window.KK;

  // ---- Ayarlar (oyun hissini buradan ince ayar yapabilirsin) ----
  var CFG = {
    GRAVITY: 1750,        // yerçekimi ivmesi (birim/sn²)
    FLAP_VY: -460,        // zıplayınca verilen dikey hız (eksi = yukarı)
    MAX_FALL: 700,        // en yüksek düşüş hızı (birim/sn)
    HIT_SCALE: 0.78,      // çarpışma dairesi = görsel yarıçap * bu (affedici)
    TOWER_INSET: 3,       // kule kutusu her yandan bu kadar küçültülür (affedici)

    GATE_W: 64,           // kule genişliği
    GATE_SPACING: 240,    // iki kule arası yatay mesafe (sol kenardan sol kenara)
    FIRST_GATE_X: 560,    // ilk kule nereden başlasın (ekranın biraz sağı)
    GAP_START: 160,       // başlangıç boşluk yüksekliği
    GAP_MIN: 118,         // en dar boşluk (sonsuza giderken yaklaşılan değer)
    SPEED_START: 175,     // başlangıç yatay hız
    SPEED_MAX: 310,       // hız buna asimptotik yaklaşır (hiç tam ulaşmaz)
    RAMP_SCORE: 32,       // zorluk eğrisinin 'yarı ömrü' gibi: skor/32 üstel yaklaşım
    SPACING_MIN: 205,     // zorlaştıkça kuleler birbirine yaklaşır (240 → 205)
    MOVE_FROM: 10,        // bu skordan sonra boşluklar yukarı-aşağı oynamaya başlar
    MOVE_AMP_MAX: 52,     // hareket genliği tavanı (birim)
    MOVE_SPEED: 1.1,      // hareket hızı (radyan/sn), skorla artar
    GAP_Y_MIN: 110,       // boşluk merkezi için güvenli aralık
    GAP_Y_MAX: 450,       // alt kule her zaman saatini taşıyacak kadar uzun kalsın
    GAP_SHIFT_START: 110, // ardışık boşluklar arası en fazla dikey sapma (başta)
    GAP_SHIFT_MAX: 140,   // ... zorluk tavandayken

    SPAWN_AHEAD: 200,     // yeni kule ekranın sağ kenarından bu kadar ileride doğar (3D kamerada görünmesin)
    DESPAWN_BEHIND: 260,  // kule sol kenardan bu kadar geçince silinir
    READY_SPEED: 60,      // hazır ekranında görsel kayma hızı
    READY_Y: 300,         // hazır ekranında uçağın salındığı merkez
    SPIN_SPEED: 9         // ölünce dönme hızı (radyan/sn)
  };

  // Sanal dünya ölçüleri (index.html tanımlar; yoksa varsayılan)
  function W() { return KK.W || 360; }
  function GROUND() { return KK.GROUND_Y || 584; }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // 0..1 arası zorluk oranı: k = 1 - e^(-skor/32). Hiç tavana vurmaz, hep biraz daha zorlaşır.
  // skor 10 → 0.27, 32 → 0.63, 64 → 0.86, 100 → 0.96
  function difficulty(score) { return 1 - Math.exp(-score / CFG.RAMP_SCORE); }

  function spacing(score) {
    return CFG.GATE_SPACING - (CFG.GATE_SPACING - CFG.SPACING_MIN) * difficulty(score);
  }

  // ---- State'i başlangıç değerlerine getir (create ve reset ortak kullanır) ----
  function init(s) {
    s.mode = 'ready';
    s.t = s.t || 0;          // toplam süre resetle sıfırlanmaz (arka plan animasyonu kesilmesin)
    s.modeTime = 0;
    s.score = 0;
    s.scrollX = s.scrollX || 0;
    s.speed = CFG.READY_SPEED;
    s.plane = { x: 96, y: CFG.READY_Y, vy: 0, angle: 0, r: 11 };
    s.gates = [];
    if (!s.events) s.events = [];   // var olan diziyi temizlemiyoruz (ana döngü temizler)
    if (typeof s.best !== 'number') s.best = 0;
    // Sözleşme dışı yardımcı alanlar (diğer modüller kullanmak zorunda değil)
    s.nextGateId = 1;
    s.lastGapY = CFG.READY_Y;
    s.grounded = false;      // ölünce yere oturdu mu
    return s;
  }

  function create() { return init({}); }

  function reset(s) {
    var best = s.best;
    init(s);
    s.best = best;
    return s;
  }

  function setMode(s, mode) {
    s.mode = mode;
    s.modeTime = 0;
  }

  // ---- Zıplama ----
  function flap(s) {
    if (s.mode === 'dead') return;
    if (s.mode === 'ready') {
      setMode(s, 'playing');
      s.speed = CFG.SPEED_START;
      s.events.push('start');
    }
    s.plane.vy = CFG.FLAP_VY;
    s.events.push('flap');
  }

  // ---- Yeni kule üret ----
  function spawnGate(s, x) {
    var k = difficulty(s.score);
    var maxShift = CFG.GAP_SHIFT_START + (CFG.GAP_SHIFT_MAX - CFG.GAP_SHIFT_START) * k;
    // Bir önceki boşluk merkezinden en fazla maxShift kadar sapma (adil olsun diye)
    // Hareketli boşluk: MOVE_FROM skorundan sonra genlik skorla büyür
    var amp = s.score >= CFG.MOVE_FROM ? Math.min(CFG.MOVE_AMP_MAX, (s.score - CFG.MOVE_FROM + 1) * 2.2) : 0;
    // Adillik: boşluk zaten hareket ediyorsa, kapılar arası sapmayı o kadar azalt
    // (en kötü durumda dikey fark ≈ maxShift - 1.5·amp + 2·amp = maxShift + 0.5·amp)
    maxShift = Math.max(50, maxShift - amp * 1.5);
    var shift = (KK.Game._rand() * 2 - 1) * maxShift;
    // Merkez, hareketin uçları da güvenli aralıkta kalacak şekilde sınırlanır
    var gapY = clamp(s.lastGapY + shift, CFG.GAP_Y_MIN + amp, CFG.GAP_Y_MAX - amp);
    s.lastGapY = gapY;
    s.gates.push({
      id: s.nextGateId++,
      x: x,
      w: CFG.GATE_W,
      gapY: Math.round(gapY),
      gapY0: Math.round(gapY),   // hareketin merkezi (çizim modülü için)
      amp: amp,                  // 0 = sabit kapı
      wv: CFG.MOVE_SPEED + Math.min(1.1, s.score * 0.012),
      ph: KK.Game._rand() * Math.PI * 2,
      gapH: Math.round(CFG.GAP_START - (CFG.GAP_START - CFG.GAP_MIN) * k),
      passed: false
    });
  }

  // ---- Daire ile dikdörtgen çarpışıyor mu? ----
  // Dairenin merkezine dikdörtgen içindeki en yakın noktayı bul, uzaklık < yarıçap ise çarpışma.
  function circleRect(cx, cy, r, rx, ry, rw, rh) {
    if (rw <= 0 || rh <= 0) return false;
    var nx = clamp(cx, rx, rx + rw);
    var ny = clamp(cy, ry, ry + rh);
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function hitsGate(p, g) {
    var r = p.r * CFG.HIT_SCALE;
    var ins = CFG.TOWER_INSET;
    var x = g.x + ins, w = g.w - ins * 2;
    var gapTop = g.gapY - g.gapH / 2;
    var gapBot = g.gapY + g.gapH / 2;
    // Üst kule: ekranın çok üstünden boşluğun üstüne kadar (tavanı aşmaya karşı)
    if (circleRect(p.x, p.y, r, x, -1000, w, gapTop + 1000)) return true;
    // Alt kule: boşluğun altından zemine kadar
    return circleRect(p.x, p.y, r, x, gapBot, w, GROUND() - gapBot);
  }

  // Uçak açısı: dikey hıza göre yumuşakça (yukarı çıkarken burun hafif yukarı, düşerken aşağı)
  function steerAngle(p, dt) {
    var target = clamp(p.vy / CFG.MAX_FALL, -0.5, 1) * (p.vy < 0 ? 0.9 : 1.2);
    p.angle += (target - p.angle) * Math.min(1, dt * 10);
  }

  // ---- Öl ----
  function die(s, hitTower) {
    s.events.push('hit');
    s.events.push('die');
    setMode(s, 'dead');
    s.speed = 0;
    // Kuleye çarptıysa küçük bir sekme, sonra dönerek düşüş
    if (hitTower) s.plane.vy = Math.min(s.plane.vy, -180);
  }

  // ---- Her kare ----
  function update(s, dt) {
    dt = clamp(dt || 0, 0, 1 / 30);
    s.t += dt;
    s.modeTime += dt;
    var p = s.plane;
    var ground = GROUND();

    if (s.mode === 'ready') {
      // Hafif salınım: yerçekimi yok, kule yok
      s.speed = CFG.READY_SPEED;
      s.scrollX += s.speed * dt;
      p.y = CFG.READY_Y + Math.sin(s.t * 3) * 8;
      p.vy = 0;
      p.angle = Math.cos(s.t * 3) * 0.08;
      return s;
    }

    if (s.mode === 'playing') {
      var k = difficulty(s.score);
      // Hız hedefe yumuşakça yaklaşır (ani sıçrama olmasın)
      var targetSpeed = CFG.SPEED_START + (CFG.SPEED_MAX - CFG.SPEED_START) * k;
      s.speed += (targetSpeed - s.speed) * Math.min(1, dt * 2);
      var dx = s.speed * dt;
      s.scrollX += dx;

      // Dikey fizik
      p.vy = Math.min(p.vy + CFG.GRAVITY * dt, CFG.MAX_FALL);
      p.y += p.vy * dt;
      if (p.y < p.r) { p.y = p.r; if (p.vy < 0) p.vy = 0; } // tavan: ölüm değil
      steerAngle(p, dt);

      // Kuleleri kaydır, gerekirse yenisini üret, ekrandan çıkanı sil
      var i, g;
      for (i = 0; i < s.gates.length; i++) {
        g = s.gates[i];
        g.x -= dx;
        if (g.amp) { g.ph += g.wv * dt; g.gapY = g.gapY0 + Math.sin(g.ph) * g.amp; }
      }
      var last = s.gates[s.gates.length - 1];
      if (!last) spawnGate(s, CFG.FIRST_GATE_X);
      else if (last.x + spacing(s.score) <= W() + CFG.SPAWN_AHEAD) spawnGate(s, last.x + spacing(s.score));
      while (s.gates.length && s.gates[0].x + s.gates[0].w < -CFG.DESPAWN_BEHIND) s.gates.shift();

      // Skor ve çarpışma
      for (i = 0; i < s.gates.length; i++) {
        g = s.gates[i];
        if (!g.passed && p.x > g.x + g.w) {
          g.passed = true;
          s.score++;
          s.events.push('score');
          // Kilometre taşları: 10, 50 ve 100'ün her katı (ateş tutuşur / büyür / renk değiştirir)
          if (s.score === 10 || s.score === 50 || s.score % 100 === 0) s.events.push('milestone');
        }
        if (hitsGate(p, g)) { die(s, true); return s; }
      }

      // Zemin
      if (p.y + p.r * CFG.HIT_SCALE >= ground) {
        p.y = ground - p.r;
        die(s, false);
      }
      return s;
    }

    // dead: kuleler durur, uçak dönerek yere düşer
    if (!s.grounded) {
      p.vy = Math.min(p.vy + CFG.GRAVITY * dt, CFG.MAX_FALL);
      p.y += p.vy * dt;
      p.angle += CFG.SPIN_SPEED * dt;
      if (p.y + p.r >= ground) {
        p.y = ground - p.r;
        p.vy = 0;
        s.grounded = true;
        // Açıyı 0..2π aralığına indir (çok tur döndüyse büyük sayı kalmasın)
        var TAU = Math.PI * 2;
        p.angle = ((p.angle % TAU) + TAU) % TAU;
      }
    } else {
      // Yerde: burun hafif yere dönük pozisyona yumuşakça otur (en yakın yönden)
      var rest = p.angle > Math.PI + 0.35 ? 0.35 + Math.PI * 2 : 0.35;
      p.angle += (rest - p.angle) * Math.min(1, dt * 12);
    }
    return s;
  }

  KK.Game = {
    create: create,
    flap: flap,
    update: update,
    reset: reset,
    config: CFG,          // ayarları dışarıdan okumak/denemek için
    _rand: Math.random    // testlerde sabit tohumlu bir fonksiyonla değiştirilebilir
  };
})();
