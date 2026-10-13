/* Kağıt Kanat 3D — çizim modülü (Three.js)
 * game.js ve ui.js'e hiç dokunulmadı: aynı state'i okuyup 2D yerine 3D sahne çiziyoruz.
 * Oyun dünyası 2D (x, y) — 3D'de bunu z=0 düzlemine yerleştirip derinliği süs olarak ekliyoruz.
 */
window.KK = window.KK || {};
(function () {
  var THREE = window.THREE;
  var P = KK.PALETTE;
  var S = 40;                                   // 40 oyun birimi = 1 dünya birimi
  function X(x) { return (x - KK.W / 2) / S; }  // oyun x → dünya X (merkez 0)
  function Y(y) { return (KK.H / 2 - y) / S; }  // oyun y aşağı artar, dünya Y yukarı
  var GROUND = Y(KK.GROUND_Y);                  // zemin yüksekliği (dünya)

  var renderer, scene, camera, key, planeGroup, shadowBlob;
  var towers = {};                              // gate.id → Group
  var bits = [];                                // kağıt kırpıntısı havuzu
  var far, near, low, roadTex, lamps, sunGlow;
  var hudScore, hudFlash, lastScore = -1;
  var shakeT = 0, flashT = 0, lastMode = null, flapBurstPending = false;
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var shared = {};                              // paylaşılan geometri ve malzemeler

  function color(c) { return new THREE.Color(c); }

  // ---- Dokular (bir kez, 2D canvas'a çizip 3D'ye yapıştırıyoruz) ----
  function canvasTex(w, h, paint) {
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    paint(cv.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(cv);
    t.anisotropy = 4;
    return t;
  }

  // Donmuş saat kadranı: akrep/yelkovan açısı her dokuda farklı
  function clockTex(hour, minute) {
    return canvasTex(128, 128, function (g, w) {
      var c = w / 2;
      g.fillStyle = P.towerEdge; g.beginPath(); g.arc(c, c, 62, 0, 7); g.fill();
      g.fillStyle = P.clockFace; g.beginPath(); g.arc(c, c, 54, 0, 7); g.fill();
      g.strokeStyle = P.clockInk;
      for (var i = 0; i < 12; i++) {           // saat çentikleri
        var a = i / 12 * Math.PI * 2, r1 = i % 3 ? 46 : 40;
        g.lineWidth = i % 3 ? 2 : 4;
        g.beginPath(); g.moveTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1);
        g.lineTo(c + Math.sin(a) * 51, c - Math.cos(a) * 51); g.stroke();
      }
      function hand(angle, len, width) {
        g.lineWidth = width; g.lineCap = 'round';
        g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.sin(angle) * len, c - Math.cos(angle) * len); g.stroke();
      }
      hand((hour % 12 + minute / 60) / 12 * Math.PI * 2, 26, 5);   // akrep
      hand(minute / 60 * Math.PI * 2, 40, 3);                        // yelkovan
      g.fillStyle = P.clockInk; g.beginPath(); g.arc(c, c, 4, 0, 7); g.fill();
      g.strokeStyle = 'rgba(27,24,56,0.45)'; g.lineWidth = 1.5;     // camdaki çatlak
      g.beginPath(); g.moveTo(c + 8, c - 50); g.lineTo(c + 16, c - 22); g.lineTo(c + 6, c - 4); g.lineTo(c + 22, c + 18); g.stroke();
    });
  }

  function skyTex() {
    return canvasTex(4, 256, function (g, w, h) {
      var gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, P.skyTop); gr.addColorStop(0.55, P.skyMid); gr.addColorStop(1, P.skyLow);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
  }

  // Yol dokusu: arka kaldırım, asfalt, kesik orta çizgi, ön kaldırım (yatayda tekrarlanır)
  // Canvas'ın üstü = arka (uzak), altı = ön (kameraya yakın)
  function roadTexture() {
    var t = canvasTex(256, 128, function (g, w, h) {
      g.fillStyle = '#2a2448'; g.fillRect(0, 0, w, h * 0.2);                 // arka kaldırım
      g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 2;
      for (var x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h * 0.2); g.stroke(); }
      g.fillStyle = '#4a3f7a'; g.fillRect(0, h * 0.2, w, 4);                 // bordür
      g.fillStyle = '#1c1834'; g.fillRect(0, h * 0.2 + 4, w, h * 0.62);      // asfalt
      for (var i = 0; i < 400; i++) {                                        // asfalt dokusu
        g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.04).toFixed(3) + ')';
        g.fillRect(Math.random() * w, h * 0.22 + Math.random() * h * 0.6, 2, 2);
      }
      g.fillStyle = '#ffcf6b';                                               // kesik orta çizgi
      for (var d = 0; d < w; d += 64) g.fillRect(d + 8, h * 0.5 - 2, 36, 4);
      g.fillStyle = 'rgba(251,247,239,0.25)';                                // kenar şeritleri
      g.fillRect(0, h * 0.27, w, 2); g.fillRect(0, h * 0.76, w, 2);
      g.fillStyle = '#4a3f7a'; g.fillRect(0, h * 0.82, w, 4);                // ön bordür
      g.fillStyle = '#2a2448'; g.fillRect(0, h * 0.82 + 4, w, h * 0.18);     // ön kaldırım
    });
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }

  // Yumuşak ışık lekesi (pencere ve sokak lambası parıltısı için)
  function glowTexture() {
    return canvasTex(64, 64, function (g, w) {
      var gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,214,140,1)');
      gr.addColorStop(0.25, 'rgba(255,190,110,0.55)');
      gr.addColorStop(1, 'rgba(255,170,90,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
  }

  // ---- Kara delik (TON 618): ekran kartında çalışan shader ile canlı çizim ----
  // Her piksel için: sıcak hale → merceklenmiş halka → diskin arka yarısı → kara gölge
  // → foton halkası → diskin ön yarısı. Disk Kepler yasasına göre döner: ω ∝ r^(-3/2),
  // yani iç kısımlar dıştakilerden hızlı akar (girdap görüntüsü buradan gelir).
  var BH_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var BH_FRAG = [
    'uniform float uTime; varying vec2 vUv;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);',
    '  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), f.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), f.x), f.y); }',
    'float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a*noise(p); p *= 2.03; a *= 0.5; } return v; }',
    'vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }',
    // sıcaklık rengi: 0 = soğuk kızıl, 1 = beyaza yakın sıcak
    'vec3 heat(float t){ vec3 a = vec3(0.85,0.30,0.20), b = vec3(1.0,0.64,0.34), c = vec3(1.0,0.95,0.82);',
    '  return t < 0.5 ? mix(a, b, t*2.0) : mix(b, c, (t-0.5)*2.0); }',
    // birikim diski: p gölge yarıçapı biriminde; disk çok yassı (0.085) görünür
    'vec3 disk(vec2 p){ vec2 d = vec2(p.x, p.y/0.115); float rd = length(d); float q = (rd-1.3)/5.2;',
    '  if (q < 0.0 || q > 1.0) return vec3(0.0);',
    '  float w = 2.2 / pow(rd, 1.5);',                                   // Kepler: içte hızlı
    '  vec2 dr = rot(d, uTime*w);',
    '  float n = fbm(dr*1.6 + 3.0);',
    '  float prof = pow(1.0-q, 1.8) * smoothstep(0.0, 0.03, q);',
    '  float dop = 1.0 + 0.55*(-d.x/rd);',                               // sol taraf (yaklaşan) parlak
    '  return heat(clamp(1.0-q*1.1, 0.0, 1.0)) * prof * (0.45 + 1.0*n) * dop * 1.9; }',
    'void main(){',
    '  vec2 p = vec2((vUv.x*2.0 - 1.0) * 1.9, vUv.y*2.0 - 1.0) / 0.26; float r = length(p); vec3 col = vec3(0.0);',
    '  col += vec3(1.0,0.5,0.28) * 0.16 * exp(-max(r-1.0,0.0)*1.3) * smoothstep(3.85, 2.4, r);',   // hale
    '  vec2 pl = vec2(p.x, p.y/0.92); float rl = length(pl); float f = (rl-1.08)/0.85;',              // merceklenmiş halka
    '  if (f > 0.0 && f < 1.0) { float n = fbm(rot(pl, uTime*0.45)*3.0 + 7.0);',
    '    col += heat(1.0-f) * pow(1.0-f, 1.7) * (0.5 + 0.9*n) * (1.0 + 0.4*(-pl.x/rl)) * 0.7; }',
    '  vec3 dc = disk(p);',
    '  if (p.y > 0.0) col += dc;',                                         // arka yarı: gölgenin ARKASINDA
    '  float sh = 1.0 - smoothstep(0.985, 1.0, r);',                       // kara gölge
    '  col *= 1.0 - sh;',
    '  float pr = exp(-pow((r-1.035)/0.02, 2.0));',                        // foton halkası (titreşir)
    '  col += vec3(1.0,0.95,0.85) * pr * (0.75 + 0.45*fbm(rot(p, uTime*0.8)*6.0));',
    '  if (p.y <= 0.0) col += dc;',                                        // ön yarı: gölgenin ÖNÜNDE
    '  float edge = smoothstep(1.0, 0.82, abs(vUv.x*2.0-1.0)) * smoothstep(1.0, 0.85, abs(vUv.y*2.0-1.0));',
    '  gl_FragColor = vec4(col * edge, sh);',                                     // renk eklenir, gölge siyah örter
    '}'
  ].join('\n');
  var bhMat = null;

  // Aydınlık pencere: içeriden yanan cam, ortada kayıt (pencere kasası)
  function windowTexture() {
    return canvasTex(32, 48, function (g, w, h) {
      var gr = g.createRadialGradient(w / 2, h * 0.6, 2, w / 2, h * 0.6, h * 0.7);
      gr.addColorStop(0, '#fff1c4'); gr.addColorStop(0.5, '#ffc56a'); gr.addColorStop(1, '#c9773a');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2e2852';                 // kasa ve kayıtlar
      g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3); g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
      g.fillRect(w / 2 - 1.5, 0, 3, h); g.fillRect(0, h * 0.45, w, 3);
    });
  }

  // ---- Kağıt uçak: üçgenlerden elle kurulmuş geometri ----
  function buildPlane() {
    var u = 1 / S;
    var N = [18, 0, 0], C = [-12, 1, 0], L = [-12, 3, -12], R = [-12, 3, 12], K = [-12, -6, 0];
    var tris = [[N, C, L], [N, R, C], [N, K, C]];          // sol kanat, sağ kanat, omurga
    var cols = [P.paper, P.paper, P.paperShade];
    var pos = [], col = [];
    tris.forEach(function (t, i) {
      var cc = color(cols[i]);
      t.forEach(function (v) { pos.push(v[0] * u, v[1] * u, v[2] * u); col.push(cc.r, cc.g, cc.b); });
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    var mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: color(P.paper), emissiveIntensity: 0.35 }));
    mesh.castShadow = true;
    mesh.renderOrder = 2;
    // Çizgi film (cel/anime) konturu: aynı şeklin biraz büyük, siyah kopyası.
    // Derinliğe yazmadığı için kağıt her zaman onun üstüne çizilir, sadece kenarlarda siyah taşar.
    var outline = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0b0918, side: THREE.DoubleSide, depthWrite: false }));
    outline.renderOrder = 1;
    var g = new THREE.Group();
    var inner = new THREE.Group();            // ölçek ve merkez ayarı için iç grup
    inner.add(outline); inner.add(mesh);
    g.add(inner);
    mesh.scale.setScalar(1.35);               // 3D'de uzaklıktan küçük görünmesin (çarpışma kutusu aynı)
    // Konturu uçağın kendi merkezi (x≈-2) etrafında büyüt ki her kenardan eşit taşsın
    var cx = -2 / S * 1.35;
    outline.scale.setScalar(1.35 * 1.2);
    outline.position.x = cx - cx * 1.2;
    return g;
  }

  // ---- Paralaks şehir: kutulardan siluet, iki kopya yan yana döşenir ----
  function buildCity(z, minH, maxH, colorHex, count, span, windows, winOpacity) {
    var group = new THREE.Group();
    var mat = new THREE.MeshLambertMaterial({ color: color(colorHex) });
    var winMat = new THREE.MeshBasicMaterial({ color: color(P.glow), transparent: true, opacity: 0.6 * (winOpacity || 1), fog: true });
    var winGeo = new THREE.PlaneGeometry(0.22, 0.3);
    var rnd = mulberry(7 + count);
    for (var copy = 0; copy < 2; copy++) {
      for (var i = 0; i < count; i++) {
        var w = 1.2 + rnd() * 2.2, h = minH + rnd() * (maxH - minH), d = 1.5 + rnd() * 2;
        var b = new THREE.Mesh(shared.box, mat);
        b.scale.set(w, h + 4, d);              // 4 birim zeminin içine gömülü
        var bx = -span / 2 + (i + 0.5) * (span / count) + copy * span;
        b.position.set(bx, GROUND + h / 2 - 2, z - rnd() * 2);
        group.add(b);
        if (windows) {                         // birkaç sıcak ışıklı pencere
          var nWin = Math.round(2 + h * 1.2);   // yüksek binada daha çok pencere
          for (var k = 0; k < nWin; k++) {
            if (rnd() < 0.45) continue;
            var wm = new THREE.Mesh(winGeo, winMat);
            wm.position.set(bx - w / 2 + 0.3 + rnd() * (w - 0.6), GROUND + 0.35 + rnd() * Math.max(0.1, h - 0.7), b.position.z + d / 2 + 0.01);
            group.add(wm);
          }
        }
        if (rnd() < 0.25) {                    // ara sıra sivri kule
          var spire = new THREE.Mesh(shared.cone, mat);
          spire.scale.set(w * 0.35, 1.6 + rnd() * 1.5, w * 0.35);
          spire.position.set(bx, GROUND + h + spire.scale.y / 2, b.position.z);
          group.add(spire);
        }
      }
    }
    group.userData.span = span;
    scene.add(group);
    return group;
  }

  // Tekrarlanabilir rastgele sayı (şehir her açılışta aynı görünsün)
  function mulberry(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  // ---- Saat kulesi (bir kapı = üst + alt kule) ----
  var TOP_VISIBLE = Y(-30);                    // üst kulenin görünen en üst noktası (pencere sınırı)
  function buildGate(gate) {
    var g = new THREE.Group();
    var w = gate.w / S, d = w;
    var gy0 = gate.gapY0 != null ? gate.gapY0 : gate.gapY;
    var amp = gate.amp || 0;
    var gapTop = Y(gy0 - gate.gapH / 2), gapBot = Y(gy0 + gate.gapH / 2);
    var skyTopY = Y(-300);                     // üst kule ekranın üstüne taşsın (hareket payıyla)
    var rnd = mulberry(gate.id * 9973 + 17);   // her kule kendi rastgeleliğiyle, ama kararlı

    function addWindow(parent, face, along, yy) {
      // face: 0 ön (+z), 1 sol (-x), 2 sağ (+x)
      var lit = rnd() < 0.55;
      var win = new THREE.Mesh(shared.win, lit ? shared.winLit : shared.winDark);
      var out = 0.012;
      if (face === 0) win.position.set(along, yy, d / 2 + out);
      else {
        var sx = face === 1 ? -1 : 1;
        win.position.set(sx * (w / 2 + out), yy, along);
        win.rotation.y = sx * Math.PI / 2;
      }
      parent.add(win);
      if (lit) {                               // camın hemen önünde küçük, yumuşak bir hare
        var glow = new THREE.Sprite(shared.winGlowMat);
        var gx = face === 0 ? 0 : (face === 1 ? -0.05 : 0.05);
        var gz = face === 0 ? 0.05 : 0;
        glow.position.set(win.position.x + gx, yy, win.position.z + gz);
        glow.scale.set(0.75, 0.9, 1);
        parent.add(glow);
      }
    }

    function tower(y0, y1, capAtBottom, parent, clockRoom) {
      // Korniş ucunda gövdeyi 0.1 kısalt: iki yüzey aynı düzlemde olunca ekran kartı hangisini
      // çizeceğine karar veremiyor ve titreme (z-fighting) oluyor.
      var capEdge = capAtBottom ? y0 : y1;
      if (capAtBottom) y0 += 0.1; else y1 -= 0.1;
      var h = y1 - y0, cy = (y0 + y1) / 2;
      var body = new THREE.Mesh(shared.box, shared.towerMat);
      body.scale.set(w, h, d); body.position.y = cy;
      body.castShadow = true; body.receiveShadow = true;
      parent.add(body);
      [-1, 1].forEach(function (sx) {          // köşe pilastrları
        var p = new THREE.Mesh(shared.box, shared.edgeMat);
        p.scale.set(0.12, h - 0.05, 0.12); p.position.set(sx * (w / 2 - 0.02), cy, d / 2 - 0.02);
        parent.add(p);
      });
      var dir = capAtBottom ? 1 : -1;          // kuleye doğru yön
      var cap = new THREE.Mesh(shared.box, shared.capMat);
      cap.scale.set(w * 1.18, 0.3, d * 1.18); cap.position.y = capEdge + dir * 0.15;
      cap.castShadow = true; parent.add(cap);

      // Saat: kuleye sığmıyorsa küçült, çok kısaysa hiç koyma (yere gömülmesin)
      var r = Math.min(0.62, (clockRoom - 0.45) / 2);
      if (r > 0.28) {
        var clock = new THREE.Mesh(shared.disc, shared.clockMats[gate.id % shared.clockMats.length]);
        clock.scale.setScalar(r / 0.62);
        clock.position.set(0, capEdge + dir * (0.4 + r), d / 2 + 0.015);
        parent.add(clock);
      }

      // Pencereler: saatin ötesinden başlayıp kulenin görünen kısmı boyunca, rastgele yüz ve konum
      var yy = capEdge + dir * (0.4 + 2 * Math.max(r, 0) + 0.7);
      var limitLo = capAtBottom ? y0 : GROUND + 0.5, limitHi = capAtBottom ? TOP_VISIBLE : y1 - 0.2;
      while (yy > limitLo && yy < limitHi) {
        var n = 1 + (rnd() < 0.35 ? 1 : 0);    // bazen aynı katta iki pencere
        for (var k = 0; k < n; k++) {
          var face = rnd() < 0.5 ? 0 : (rnd() < 0.5 ? 1 : 2);
          var along = (rnd() - 0.5) * (w - 0.6);
          addWindow(parent, face, along, yy + (rnd() - 0.5) * 0.3);
        }
        yy += dir * (0.9 + rnd() * 0.7);
      }
    }
    var top = new THREE.Group(), bot = new THREE.Group();
    tower(gapTop, skyTopY, true, top, 3);
    // Alt kule zeminin 3 birim içinden başlar: kapı yukarı oynadığında tabanı açıkta kalmasın.
    // Saat için yer: kapının en aşağı indiği andaki görünen yükseklik.
    var minVisible = Y(gy0 + amp + gate.gapH / 2) - GROUND;
    tower(GROUND - 3, gapBot, false, bot, minVisible);
    g.add(top); g.add(bot);
    g.userData.top = top; g.userData.bot = bot; g.userData.gy0 = gy0;
    scene.add(g);
    return g;
  }

  function syncGates(state) {
    var alive = {};
    for (var i = 0; i < state.gates.length; i++) {
      var gate = state.gates[i];
      alive[gate.id] = true;
      var tg = towers[gate.id] || (towers[gate.id] = buildGate(gate));
      tg.position.x = X(gate.x + gate.w / 2);
      // Giriş animasyonu konuma bağlı: x=W+170'te tamamen saklı, x=W-10'da yerinde
      var p = Math.min(1, Math.max(0, (KK.W + 170 - gate.x) / 180));
      var off = Math.pow(1 - p, 3) * 9;        // ease-out (sona doğru yavaşlar)
      var move = (tg.userData.gy0 - gate.gapY) / S; // hareketli kapı: boşluk kayınca iki kule birlikte kayar
      tg.userData.top.position.y = off + move;
      tg.userData.bot.position.y = -off + move;
    }
    for (var id in towers) {
      if (!alive[id]) { scene.remove(towers[id]); delete towers[id]; }
    }
  }

  // ---- Kağıt kırpıntıları ----
  function spawnBits(x, y, n, speed) {
    for (var i = 0; i < n; i++) {
      var b = null;
      for (var k = 0; k < bits.length; k++) if (bits[k].life <= 0) { b = bits[k]; break; }
      if (!b) {
        if (bits.length >= 40) return;
        b = { mesh: new THREE.Mesh(shared.bit, shared.bitMat), life: 0 };
        scene.add(b.mesh); bits.push(b);
      }
      b.life = 0.5 + Math.random() * 0.3;
      b.mesh.visible = true;
      b.mesh.position.set(x - 0.3, y, (Math.random() - 0.5) * 0.4);
      b.v = new THREE.Vector3(-1.5 - Math.random() * speed, (Math.random() - 0.3) * speed, (Math.random() - 0.5) * 1.5);
      b.spin = new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9);
    }
  }
  function updateBits(dt) {
    for (var i = 0; i < bits.length; i++) {
      var b = bits[i];
      if (b.life <= 0) continue;
      b.life -= dt;
      b.v.y -= 6 * dt;
      b.mesh.position.addScaledVector(b.v, dt);
      b.mesh.rotation.x += b.spin.x * dt; b.mesh.rotation.y += b.spin.y * dt;
      if (b.life <= 0) b.mesh.visible = false;
    }
  }


  // ---- Rüzgar izi: kanat uçlarından iki ince şerit + kuyruktan geniş, parlak bir ana şerit ----
  // Zıplayınca şeritler bir anlığına kalınlaşır ("boost"), kanat uçlarından kıvılcımlar saçılır.
  var TRAIL_N = 34, trails = [], lastScrollX = null, boost = 0;
  var trailDefs = [
    { local: new THREE.Vector3(-12, 3, -12), width: 0.05, alpha: 0.75 },   // sol kanat ucu
    { local: new THREE.Vector3(-12, 3, 12), width: 0.05, alpha: 0.75 },    // sağ kanat ucu
    { local: new THREE.Vector3(-10, 0, 0), width: 0.16, alpha: 0.38 }      // kuyruk: geniş, yumuşak
  ];
  var headCol, tailCol, sparks = [];
  function buildTrails() {
    headCol = color('#ffe2a6'); tailCol = color('#9b7bff');
    trailDefs.forEach(function (def) {
      def.local.multiplyScalar(1.35 / S);
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      var idx = [];
      for (var i = 0; i < TRAIL_N - 1; i++) { var a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      geo.setIndex(idx);
      var mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      mesh.frustumCulled = false;
      scene.add(mesh);
      trails.push({ mesh: mesh, pts: [], def: def });
    });
  }
  var tmpV = new THREE.Vector3(), tmpC = new THREE.Color();
  function spark(pos, n, spread) {
    for (var i = 0; i < n; i++) {
      var sp = null;
      for (var k = 0; k < sparks.length; k++) if (sparks[k].life <= 0) { sp = sparks[k]; break; }
      if (!sp) { if (sparks.length >= 48) return; sp = { s: new THREE.Sprite(shared.sparkMat), life: 0 }; scene.add(sp.s); sparks.push(sp); }
      sp.life = sp.max = 0.35 + Math.random() * 0.3;
      sp.s.visible = true;
      sp.s.position.copy(pos);
      sp.v = new THREE.Vector3(-1.5 - Math.random() * 2.5, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread);
    }
  }
  function updateTrails(state, dScroll, dt) {
    planeGroup.updateMatrixWorld();
    var emit = state.mode !== 'dead';
    boost = Math.max(0, boost - dt * 3.5);
    trails.forEach(function (tr, k) {
      var pts = tr.pts, def = tr.def;
      for (var i = 0; i < pts.length; i++) pts[i].x -= dScroll;           // dünya sola kayar, iz de kayar
      if (emit) { tmpV.copy(def.local).applyMatrix4(planeGroup.matrixWorld); pts.push(tmpV.clone()); }
      else if (pts.length) pts.shift();                                   // ölünce iz yavaşça söner
      while (pts.length > TRAIL_N) pts.shift();
      if (emit && k < 2 && state.mode === 'playing' && Math.random() < 0.18) spark(pts[pts.length - 1], 1, 0.6);
      var pos = tr.mesh.geometry.attributes.position, col = tr.mesh.geometry.attributes.color;
      for (var j = 0; j < TRAIL_N; j++) {
        var q = pts[Math.max(0, pts.length - TRAIL_N + j)] || pts[0];
        if (!q) { pos.setXYZ(j * 2, 0, -99, 0); pos.setXYZ(j * 2 + 1, 0, -99, 0); continue; }
        var f = pts.length < 2 ? 0 : Math.max(0, (j - (TRAIL_N - pts.length)) / (TRAIL_N - 1)); // 0 kuyruk → 1 uçak
        var half = def.width * (0.35 + 0.65 * f) * (1 + boost * 1.4) * f;
        pos.setXYZ(j * 2, q.x, q.y + half, q.z);
        pos.setXYZ(j * 2 + 1, q.x, q.y - half, q.z);
        tmpC.copy(tailCol).lerp(headCol, Math.pow(f, 0.7));              // uca yakın sıcak, kuyrukta mor
        var a = Math.pow(f, 1.25) * def.alpha * (1 + boost * 0.6);
        col.setXYZ(j * 2, tmpC.r * a, tmpC.g * a, tmpC.b * a);
        col.setXYZ(j * 2 + 1, tmpC.r * a, tmpC.g * a, tmpC.b * a);
      }
      pos.needsUpdate = true; col.needsUpdate = true;
    });
    for (var s = 0; s < sparks.length; s++) {                             // kıvılcımlar
      var sp = sparks[s];
      if (sp.life <= 0) continue;
      sp.life -= dt;
      sp.s.position.addScaledVector(sp.v, dt);
      sp.s.position.x -= dScroll;
      var t = Math.max(sp.life, 0) / sp.max;
      sp.s.scale.setScalar(0.32 * t + 0.05);
      if (sp.life <= 0) sp.s.visible = false;
    }
  }
  function flapBurst() {
    boost = 1;
    planeGroup.updateMatrixWorld();
    for (var k = 0; k < 2; k++) spark(tmpV.copy(trailDefs[k].local).applyMatrix4(planeGroup.matrixWorld).clone(), 4, 1.6);
  }
  function clearTrails() {
    trails.forEach(function (t) { t.pts.length = 0; });
    sparks.forEach(function (s) { s.life = 0; s.s.visible = false; });
    boost = 0;
  }


  // ---- Puan sayacı ateşi ----
  // Seviye: 10'da küçük, 50'de orta, 100'de büyük. 200'den sonra her 100'de renk değişir.
  // Renk YALNIZCA puana bağlı (sabit tablo) → 300 her maçta, her telefonda aynı renk.
  var FIRE_COLORS = { 1: '#ff7a1a', 2: '#2f8bff', 3: '#2ee86b', 4: '#a24bff', 5: '#ff4fb4',
                      6: '#26e0e8', 7: '#ff2a3a', 8: '#ffd23a', 9: '#f2f0ff' };
  function fireLevel(score) { return score < 10 ? 0 : score < 50 ? 1 : score < 100 ? 2 : 3; }
  function fireColor(score) {
    var h = Math.floor(score / 100);
    if (h < 2) return FIRE_COLORS[1];                       // 10-199: klasik turuncu
    if (FIRE_COLORS[h]) return FIRE_COLORS[h];
    return 'hsl(' + ((h * 53) % 360) + ', 95%, 62%)';       // 1000+: yine puana bağlı, sabit formül
  }
  var FIRE_SCALE = [0, 0.75, 1.0, 1.35];                      // alev boyu çarpanı
  var FIRE_RATE = [0, 45, 80, 130];                         // saniyede doğan alev parçacığı
  var fire = { cv: null, ctx: null, w: 300, h: 240, dpr: 1, parts: [], sprites: {}, acc: 0, burst: 0, color: null, font: 60 };
  function fireSprite(col) {
    if (fire.sprites[col]) return fire.sprites[col];
    var s = document.createElement('canvas'); s.width = s.height = 64;
    var g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,235,1)');
    gr.addColorStop(0.28, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (fire.sprites[col] = s);
  }
  function initFire(hud) {
    var cv = document.createElement('canvas');
    cv.id = 'fire';
    cv.style.cssText = 'position:absolute;pointer-events:none;';
    hud.insertBefore(cv, hudScore);                           // rakamların ARKASINDA
    fire.cv = cv; fire.ctx = cv.getContext('2d');
    sizeFire();
    window.addEventListener('resize', sizeFire);
  }
  function sizeFire() {
    fire.dpr = Math.min(window.devicePixelRatio || 1, 2);
    fire.font = parseFloat(getComputedStyle(hudScore).fontSize) || 60;
    fire.w = Math.round(fire.font * 5.2); fire.h = Math.round(fire.font * 4);
    fire.cv.width = fire.w * fire.dpr; fire.cv.height = fire.h * fire.dpr;
    fire.cv.style.width = fire.w + 'px'; fire.cv.style.height = fire.h + 'px';
  }
  function updateFire(state, dt) {
    var lvl = state.mode === 'playing' ? fireLevel(state.score) : 0;
    if (!lvl && !fire.parts.length) { fire.cv.style.display = 'none'; hudScore.style.textShadow = ''; return; }
    fire.cv.style.display = '';
    // Tuvali rakamların üstüne ortala; alevin tabanı rakamların alt kenarının biraz altında
    var cx = hudScore.offsetLeft + hudScore.offsetWidth / 2;
    var base = hudScore.offsetTop + hudScore.offsetHeight * 0.92;
    fire.cv.style.left = (cx - fire.w / 2) + 'px';
    fire.cv.style.top = (base - fire.h * 0.86) + 'px';
    var col = fireColor(state.score);
    fire.burst = Math.max(0, fire.burst - dt * 1.6);
    var sc = FIRE_SCALE[lvl] * (1 + fire.burst * 0.6);
    var digits = String(state.score).length;
    var baseW = fire.font * 0.62 * digits;                     // rakamların genişliği kadar taban
    // Parçacık doğur
    if (lvl) {
      fire.acc += dt * FIRE_RATE[lvl] * (1 + fire.burst * 3);
      while (fire.acc >= 1 && fire.parts.length < 260) {
        fire.acc -= 1;
        var life = 0.45 + Math.random() * 0.45;
        fire.parts.push({
          x: fire.w / 2 + (Math.random() - 0.5) * baseW,
          y: fire.h * 0.86 + Math.random() * 6,
          vx: (Math.random() - 0.5) * 30,
          vy: -(70 + Math.random() * 90) * sc,
          size: (20 + Math.random() * 18) * sc * (fire.font / 60),
          life: life, max: life, ph: Math.random() * 6.28, col: col
        });
      }
    }
    // Güncelle + çiz
    var c = fire.ctx;
    c.setTransform(fire.dpr, 0, 0, fire.dpr, 0, 0);
    c.clearRect(0, 0, fire.w, fire.h);
    c.globalCompositeOperation = 'lighter';
    for (var i = fire.parts.length - 1; i >= 0; i--) {
      var p = fire.parts[i];
      p.life -= dt;
      if (p.life <= 0) { fire.parts.splice(i, 1); continue; }
      var k = p.life / p.max;                                  // 1 doğum → 0 ölüm
      p.ph += dt * 9;
      p.x += (p.vx + Math.sin(p.ph) * 22) * dt;
      p.y += p.vy * dt;
      p.x += (fire.w / 2 - p.x) * dt * 1.4;                    // alev uca doğru incelir
      var s = p.size * (0.35 + 0.65 * k);
      c.globalAlpha = Math.min(1, k * 1.6) * 0.75;
      c.drawImage(fireSprite(p.col), p.x - s / 2, p.y - s / 2, s, s);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    // Rakamlar alev rengiyle parlasın; tutuşma anında sayaç bir an büyüsün
    hudScore.style.textShadow = lvl ? '0 3px 0 #1b1838, 0 0 ' + Math.round(14 + 18 * sc) + 'px ' + col : '';
    hudScore.style.transform = fire.burst > 0 ? 'scale(' + (1 + fire.burst * 0.35).toFixed(3) + ')' : '';
  }
  function igniteFire() { fire.burst = 1; }

  KK.Render3D = {
    init: function (canvas, hud) {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      scene = new THREE.Scene();
      scene.background = skyTex();
      scene.fog = new THREE.Fog(color('#4a3466'), 26, 70);

      // Kamera: hafif soldan ve yukarıdan bakan 3/4 açı, derinlik hissi için
      camera = new THREE.PerspectiveCamera(46, KK.W / KK.H, 0.1, 200);
      camera.position.set(-3.6, 0.9, 21);
      camera.lookAt(0.5, -0.4, 0);
      camera.userData.base = camera.position.clone();

      // Işık: mor gökyüzü dolgusu + gün batımından gelen sıcak ana ışık
      scene.add(new THREE.HemisphereLight(color('#8d79c9'), color(P.ground), 0.75));
      key = new THREE.DirectionalLight(color('#ffb27a'), 0.95);
      // Sağ-önden gelen ışık: gölgeler sola ve arkaya düşer. Böylece soldan çıkıp silinen kulelerin
      // gölgeleri ekranın dışında kalır; gölge kamerası da geniş tutulur ki kenarda kesilmesin.
      key.position.set(9, 10, 9);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.bias = -0.0005;
      var sc = key.shadow.camera; sc.left = -18; sc.right = 18; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 50;
      scene.add(key);
      var rim = new THREE.DirectionalLight(color(P.skyLow), 0.5);   // arkadan kenar ışığı
      rim.position.set(-6, 3, -12);
      scene.add(rim);

      // Paylaşılan geometri/malzemeler (her kule için yeniden yaratmayalım)
      shared.box = new THREE.BoxGeometry(1, 1, 1);
      shared.cone = new THREE.ConeGeometry(1, 1, 4);
      shared.disc = new THREE.CircleGeometry(0.62, 32);
      shared.win = new THREE.PlaneGeometry(0.34, 0.5);
      shared.bit = new THREE.PlaneGeometry(0.16, 0.11);
      shared.towerMat = new THREE.MeshLambertMaterial({ color: color(P.tower) });
      shared.edgeMat = new THREE.MeshLambertMaterial({ color: color(P.towerEdge) });
      shared.capMat = new THREE.MeshLambertMaterial({ color: color(P.towerEdge), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      shared.winLit = new THREE.MeshBasicMaterial({ map: windowTexture() });
      shared.lampLit = new THREE.MeshBasicMaterial({ color: color('#ffd98a') });
      shared.glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: color('#ffc070'), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      shared.winGlowMat = new THREE.SpriteMaterial({ map: shared.glowMat.map, color: color('#ffb860'), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
      shared.sparkMat = new THREE.SpriteMaterial({ map: shared.glowMat.map, color: color('#ffe6b0'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      shared.winDark = new THREE.MeshLambertMaterial({ color: color(P.cityNear) });
      shared.bitMat = new THREE.MeshBasicMaterial({ color: color(P.paper), side: THREE.DoubleSide });
      shared.clockMats = [[6, 47], [3, 12], [9, 38], [11, 5], [2, 51]].map(function (hm) {
        return new THREE.MeshLambertMaterial({ map: clockTex(hm[0], hm[1]), emissive: color(P.clockFace), emissiveIntensity: 0.25 });
      });

      // Arka plan: güneş yerine TON 618 — ufkun üstünde asılı dev kara delik
      bhMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } }, vertexShader: BH_VERT, fragmentShader: BH_FRAG,
        transparent: true, depthWrite: false, fog: false,
        // Önceden çarpılmış karışım: renk gökyüzüne EKLENİR, gölge (alfa=1) arkasını siyahla örter
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor
      });
      var bh = new THREE.Mesh(new THREE.PlaneGeometry(58 * 1.9, 58), bhMat);  // en/boy 1.9: disk yanlara uzanır
      bh.position.set(4, GROUND + 11, -46);   // daha yakın ve büyük (uzak şehrin hemen arkasında)
      bh.rotation.z = -0.06;                   // diske hafif bir eğim
      scene.add(bh);
      sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: color('#ff8a5c'), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      sunGlow.position.set(4, GROUND + 11, -47);
      sunGlow.scale.set(52, 52, 1);
      scene.add(sunGlow);

      far = buildCity(-40, 4, 11, P.cityFar, 16, 80, true, 0.35);
      near = buildCity(-20, 2, 6, P.cityNear, 12, 56, true, 1);
      low = buildCity(-11, 0.7, 2.2, '#1f1a38', 18, 48, true, 1);   // binaların altını dolduran alçak sıra
      // Sokak seviyesinde sıcak şehir ışığı pusu (binaların tabanını aydınlatır, boşluk hissini kırar)
      var hazeTex = canvasTex(8, 128, function (g, w, h) {
        var gr = g.createLinearGradient(0, h, 0, 0);
        gr.addColorStop(0, 'rgba(255,170,100,0.55)'); gr.addColorStop(0.35, 'rgba(230,120,110,0.18)'); gr.addColorStop(1, 'rgba(120,60,140,0)');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      });
      [[-38, 7, 0.55], [-18.5, 4, 0.45], [-9.5, 2.2, 0.35]].forEach(function (hz) {
        var haze = new THREE.Mesh(new THREE.PlaneGeometry(140, hz[1]), new THREE.MeshBasicMaterial({ map: hazeTex, transparent: true, opacity: hz[2], blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        haze.position.set(0, GROUND + hz[1] / 2, hz[0]);
        scene.add(haze);
      });

      // Zemin: şehri taşıyan derin taban (arka binaların altını da kapatır)
      var base = new THREE.Mesh(new THREE.BoxGeometry(140, 6, 76), new THREE.MeshLambertMaterial({ color: color('#211c3c') }));
      base.position.set(0, GROUND - 3 - 0.02, -36);  // ön kenarı z=+2'de, z=-74'e kadar uzanır
      base.receiveShadow = true;
      scene.add(base);
      // Yol: kulelerin dikildiği ön şerit, oyun hızıyla kayar
      roadTex = roadTexture();
      roadTex.repeat.set(10, 1);
      var road = new THREE.Mesh(new THREE.PlaneGeometry(80, 8), new THREE.MeshLambertMaterial({ map: roadTex }));
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, GROUND, -2);          // z: -6 ile +2 arası
      road.receiveShadow = true;
      scene.add(road);
      // Sokak lambaları: arka kaldırımda, yolla aynı hızda kayar
      lamps = new THREE.Group();
      var poleMat = new THREE.MeshLambertMaterial({ color: color('#1a1630') });
      for (var li = 0; li < 16; li++) {
        var lx = -48 + li * 6;
        var pole = new THREE.Mesh(shared.box, poleMat);
        pole.scale.set(0.09, 2.6, 0.09); pole.position.set(lx, GROUND + 1.3, -5.4); pole.castShadow = true;
        var arm = new THREE.Mesh(shared.box, poleMat);
        arm.scale.set(0.5, 0.07, 0.07); arm.position.set(lx + 0.22, GROUND + 2.58, -5.4);
        var bulb = new THREE.Mesh(shared.box, shared.lampLit);
        bulb.scale.set(0.2, 0.08, 0.14); bulb.position.set(lx + 0.42, GROUND + 2.52, -5.4);
        var lg = new THREE.Sprite(shared.glowMat);
        lg.position.set(lx + 0.42, GROUND + 2.45, -5.2); lg.scale.set(2.4, 2.4, 1);
        lamps.add(pole); lamps.add(arm); lamps.add(bulb); lamps.add(lg);
      }
      scene.add(lamps);

      planeGroup = buildPlane();
      scene.add(planeGroup);
      buildTrails();

      hudScore = hud.querySelector('#score');
      hudFlash = hud.querySelector('#flash');
      initFire(hud);
    },

    resize: function (w, h, dpr) {
      if (!renderer) return;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
    },

    draw: function (state, dt) {
      if (!renderer) return;
      // Yeniden başlayınca efektleri temizle
      if (state.mode === 'ready' && lastMode !== 'ready') { shakeT = 0; flashT = 0; for (var i = 0; i < bits.length; i++) { bits[i].life = 0; bits[i].mesh.visible = false; } clearTrails(); }
      lastMode = state.mode;

      var pl = state.plane, px = X(pl.x), py = Y(pl.y);
      for (var e = 0; e < state.events.length; e++) {
        var ev = state.events[e];
        if (ev === 'flap') { spawnBits(px, py, 4, 2.5); flapBurstPending = true; }
        if (ev === 'milestone') igniteFire();
        if (ev === 'hit') { shakeT = reduced ? 0 : 0.3; flashT = 0.25; spawnBits(px, py, 12, 4); }
      }

      // Uçak: konum + burun açısı + hıza göre hafif yatış (3D'ye özel)
      planeGroup.position.set(px, py, 0);
      planeGroup.rotation.set(Math.max(-0.5, Math.min(0.5, pl.vy / 900)), 0, -pl.angle);

      syncGates(state);
      updateBits(dt);
      var dS = lastScrollX == null ? 0 : (state.scrollX - lastScrollX) / S;
      if (dS < 0 || dS > 2) { dS = 0; clearTrails(); }
      lastScrollX = state.scrollX;
      if (flapBurstPending) { flapBurst(); flapBurstPending = false; }
      updateTrails(state, dS, dt);

      // Paralaks: şehir katmanları farklı hızda kayar, iki kopya döngüyle döşenir
      [[far, 0.12], [near, 0.42], [low, 0.7]].forEach(function (L) {
        var span = L[0].userData.span;
        L[0].position.x = -(((state.scrollX * L[1]) / S) % span);
      });
      // Yol ve lambalar oyunla aynı hızda kayar (doku 8 birimde bir tekrar eder, lambalar 6'da bir)
      var worldScroll = state.scrollX / S;
      roadTex.offset.x = (worldScroll / 8) % 1;
      lamps.position.x = -(worldScroll % 6);
      // Pencere ışıkları hafifçe nefes alır
      shared.glowMat.opacity = 0.5 + Math.sin(state.t * 2.3) * 0.06;
      shared.winGlowMat.opacity = 0.33 + Math.sin(state.t * 1.7) * 0.04;
      sunGlow.material.opacity = 0.33 + Math.sin(state.t * 0.8) * 0.05;  // kara delik hafifçe nabız atar
      bhMat.uniforms.uTime.value = state.t;          // disk ve halkalar akar

      // Kamera: hazırda yavaş salınım, çarpınca sarsıntı
      var base = camera.userData.base;
      var sway = state.mode === 'ready' && !reduced ? Math.sin(state.t * 0.6) * 0.6 : 0;
      camera.position.set(base.x + sway, base.y, base.z);
      if (shakeT > 0) {
        shakeT -= dt;
        var a = 0.35 * Math.max(shakeT, 0) / 0.3;
        camera.position.x += (Math.random() - 0.5) * a; camera.position.y += (Math.random() - 0.5) * a;
      }
      camera.lookAt(0.5, -0.4, 0);

      renderer.render(scene, camera);

      // HUD: skor (sadece oynarken) ve beyaz flaş
      if (state.mode === 'playing') {
        if (state.score !== lastScore) { hudScore.textContent = state.score; lastScore = state.score; }
        hudScore.hidden = false;
      } else { hudScore.hidden = true; lastScore = -1; }
      updateFire(state, dt);
      if (flashT > 0) { flashT -= dt; hudFlash.style.opacity = Math.max(flashT, 0) / 0.25 * 0.7; }
      else hudFlash.style.opacity = 0;
    }
  };
})();
