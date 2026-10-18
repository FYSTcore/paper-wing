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
  var far, near, low, roadTex, lamps, sunGlow, plazaTex, plazaMat;
  var hudScore, hudFlash, lastScore = -1, hudTf = '', hudFo = -1, vFovK = 1, viewShift = 0;
  var shakeT = 0, flashT = 0, lastMode = null, flapBurstPending = false, finE = 0, finFlash = false;
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
      g.fillStyle = '#3a3a3a'; g.fillRect(0, 0, w, h * 0.2);                 // arka kaldırım (v1.6: nötr gri, renk temadan)
      g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 2;
      for (var x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h * 0.2); g.stroke(); }
      g.fillStyle = '#6a6a6a'; g.fillRect(0, h * 0.2, w, 4);                 // bordür
      g.fillStyle = '#262626'; g.fillRect(0, h * 0.2 + 4, w, h * 0.62);      // asfalt
      for (var i = 0; i < 400; i++) {                                        // asfalt dokusu
        g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.04).toFixed(3) + ')';
        g.fillRect(Math.random() * w, h * 0.22 + Math.random() * h * 0.6, 2, 2);
      }
      g.fillStyle = '#ffcf6b';                                               // kesik orta çizgi
      for (var d = 0; d < w; d += 64) g.fillRect(d + 8, h * 0.5 - 2, 36, 4);
      g.fillStyle = 'rgba(251,247,239,0.25)';                                // kenar şeritleri
      g.fillRect(0, h * 0.27, w, 2); g.fillRect(0, h * 0.76, w, 2);
      g.fillStyle = '#6a6a6a'; g.fillRect(0, h * 0.82, w, 4);                // ön bordür
      g.fillStyle = '#3a3a3a'; g.fillRect(0, h * 0.82 + 4, w, h * 0.18);     // ön kaldırım
    });
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }

  // v3.0.2: ön meydan karosu — koyu taş, ince derz çizgileri, hafif ton farkı
  function plazaTexture() {
    var t = canvasTex(128, 128, function (g, w, h) {
      g.fillStyle = '#2c2c2c'; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) {
        var v = 40 + ((i * 7 + j * 13) % 3) * 4;
        g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
      }
      for (var k = 0; k < 300; k++) { g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.05).toFixed(3) + ')'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
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

  // ---- Kara delik (TON 618) v1.8: GERÇEK ışın izleme ----
  // Her piksel için kameradan bir ışık ışını atılır ve Schwarzschild kara deliğinin çekimiyle
  // adım adım bükülerek ilerletilir. Birim: olay ufku yarıçapı rs = 1.
  //   Foton yörünge denklemi (Binet'ten türetilen 3B hâli):  x'' = -1.5 · h² · x / r⁵
  //   h = |x × v| ışının açısal momentumu (sabit kalır).
  // Işın diskin düzlemini (y = 0) her kestiğinde orada disk varsa rengi eklenir. Böylece:
  //   • diskin ARKA yarısından çıkan ışık deliğin üstünden ve altından bükülüp bize gelir
  //     → gölgenin üstünü ve altını saran yay (Interstellar görüntüsü), yanlarda düz diske bağlanır
  //   • deliğin etrafında neredeyse tam tur atan ışınlar ince, parlak foton halkasını çizer
  //   • r < 1'e düşen ışın yutulur → kara gölge (görünür yarıçapı ≈ 2.6 rs = 3√3/2)
  // Disk: iç kenar 1.55 rs (Gargantua gibi hızlı dönen delikte disk ufka çok yaklaşır → yay gölgeye değer), dış kenar 14 rs. Kepler dönüşü ω ∝ r^-1.5,
  // Doppler (yaklaşan taraf parlak ve beyazımsı) ve kütleçekimsel kızıla kayma sqrt(1 - 1/r).
  var BH_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var BH_FRAG = [
    'uniform float uTime; uniform float uFade; varying vec2 vUv;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);',
    '  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), f.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), f.x), f.y); }',
    'float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a*noise(p); p *= 2.03; a *= 0.5; } return v; }',
    'vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }',
    'vec3 heat(float t){ vec3 a = vec3(0.70,0.16,0.05), b = vec3(1.0,0.52,0.14), c = vec3(1.0,0.90,0.68);',
    '  return t < 0.5 ? mix(a, b, t*2.0) : mix(b, c, (t-0.5)*2.0); }',
    'const float RIN = 1.55; const float ROUT = 14.0;',
    // Diskin bir noktasının rengi ve örtücülüğü (hp: kesişme noktası, vd: ışın yönü kameradan deliğe)
    'vec3 diskColor(vec3 hp, vec3 vd, out float a){',
    '  float r = length(hp.xz);',
    '  float q = (r - RIN) / (ROUT - RIN);',
    '  vec2 d = rot(hp.xz, uTime * 5.0 / pow(r, 1.5));',              // Kepler: içte hızlı
    '  float n = fbm(d*0.55 + 3.0);',
    '  float bands = 0.65 + 0.7*fbm(vec2(r*2.2, 1.0) + d*0.08);',      // halka halka yoğunluk
    '  float prof = pow(1.0 - q, 1.5) * smoothstep(0.0, 0.025, q);',
    '  float beta = sqrt(0.5 / r);',                                  // yörünge hızı (ışık hızı = 1)
    '  vec3 vel = normalize(vec3(-hp.z, 0.0, hp.x));',
    '  float cosT = dot(vel, -vd);',                                  // foton bize doğru -vd yönünde gider
    '  float g = sqrt(1.0 - beta*beta) / (1.0 - beta*cosT) * pow(1.0 - 1.0/r, 0.3);',  // kızıla kayma sanatsal olarak yumuşatıldı
    '  float I = prof * (0.4 + 1.0*n) * bands * pow(g, 2.4);',
    '  a = clamp(prof * 1.7, 0.0, 1.0) * (0.55 + 0.45*n);',
    '  return heat(clamp(1.0 - q*1.15 + (g - 1.0)*0.5, 0.0, 1.0)) * I * 1.9;',
    '}',
    'void main(){',
    '  vec2 s = (vUv*2.0 - 1.0) * vec2(1.9, 1.0) * 10.0;',             // görüntü düzlemi (rs biriminde)
    '  float inc = 0.14;',                                            // diskin ~8° üstünden bakış
    '  vec3 cam = vec3(0.0, sin(inc), cos(inc)) * 60.0;',
    '  vec3 fwd = normalize(-cam);',
    '  vec3 right = vec3(1.0, 0.0, 0.0);',
    '  vec3 up = cross(right, fwd);',
    '  vec3 v = normalize(s.x*right + s.y*up - cam);',
    '  vec3 p = cam;',
    '  vec3 col = vec3(0.0); float alpha = 0.0; float captured = 0.0;',
    // Uzakta bükülme ihmal edilebilir: düz çizgiyle 22 rs küresine kadar atla (çoğu piksel burada biter)
    '  float bq = dot(p, v), disc = bq*bq - (dot(p, p) - 484.0);',
    '  if (disc > 0.0) {',
    '    p += v * (-bq - sqrt(disc));',
    '    vec3 hv = cross(p, v); float h2 = dot(hv, hv);',
    '    for (int i = 0; i < 140; i++) {',
    '      float r2 = dot(p, p), r = sqrt(r2);',
    '      float dt = clamp(0.1*r, 0.02, 2.0);',                      // adım uzaklıkla orantılı: deliğe yakın küçük
    '      v += (-1.5 * h2 / (r2*r2*r)) * p * dt;',
    '      vec3 pn = p + v*dt;',
    '      if (pn.y * p.y < 0.0) {',                                   // disk düzlemini kesti
    '        vec3 hp = mix(p, pn, p.y / (p.y - pn.y));',
    '        float rh = length(hp.xz);',
    '        if (rh > RIN && rh < ROUT) { float da; vec3 dc = diskColor(hp, normalize(v), da); col += (1.0 - alpha)*dc; alpha += (1.0 - alpha)*da; }',
    '      }',
    '      p = pn;',
    '      if (dot(p, p) < 1.0) { captured = 1.0; break; }',
    '      if (dot(p, p) > 529.0 && dot(p, v) > 0.0) break;',
    '      if (alpha > 0.985) break;',
    '    }',
    '  }',
    '  float lum = max(max(col.r, col.g), col.b);',
    '  col *= (1.0 - exp(-lum * 1.35)) / max(lum, 1e-4);',             // rengi koruyan ton eşleme: parlaklar patlamasın, turuncu solmasın
    '  float rb = length(s);',                                        // ekrandaki uzaklık (rs)
    '  col += vec3(1.0, 0.5, 0.28) * 0.13 * exp(-max(rb - 2.6, 0.0)*0.2) * (1.0 - captured) * (1.0 - alpha);', // sıcak hale
    '  col += vec3(1.0, 0.86, 0.62) * 0.55 * exp(-pow((rb - 2.62) / 0.045, 2.0));',   // foton halkası: gölgenin kenarında ince ışık
    '  float edge = smoothstep(1.0, 0.82, abs(vUv.x*2.0 - 1.0)) * smoothstep(1.0, 0.85, abs(vUv.y*2.0 - 1.0));',
    '  gl_FragColor = vec4(col * edge, max(captured, alpha*0.85*edge)) * uFade;',
    '}'
  ].join('\n');
  var bhMat = null;

  // ---- v1.6: Güneş sistemi turu — her 200 puanda yeni bir gök cismi VE ona uygun bir şehir ----
  // Gök cismi ekranın sol kenarına yaslanır (yarısı ekran dışında), hepsi benzer boyutta görünür.
  // Hepsi ekran kartında prosedürel çizilir (doku dosyası yok): küre normali uv'den hesaplanır,
  // yüzey 3B gürültüyle boyanır, ışık sağdan gelir (ekranın ortasına bakan yarı aydınlık).
  // Rota: Dünya'dan Güneş'e dalış, Güneş'in çekimiyle sapan gibi fırlayıp dış gezegenlere, en sonda TON 618.
  //
  // Her gövdenin bir "teması" var: gökyüzü, sis, ışıklar, şehir renkleri/biçimleri, kule renkleri, yıldızlar.
  // Şekil ağırlıkları: box=kutu bina, dome=kubbe, spire=sivri kule, cyl=silindir, antenna=antenli bina, bunker=alçak sığınak
  var BODIES = [
    { name: 'EARTH', kind: 0, R: 11.7, spin: 0.18, tilt: 0.41, incl: -0.25, atm: '#5b9bff', atmK: 1.0, fire: '#ff7a1a', glow: '#6f8cff',
      sky: ['#0f1d3d', '#2c4f86', '#f09a6a'], fog: '#3b4f78', hemi: ['#8fb0e0', '#1a1f33', 0.8], key: ['#ffb27a', 0.9], rim: '#f09a6a',
      city: ['#2c3858', '#1d2640', '#161c30'], win: '#ffd38a', tower: '#2a3456', edge: '#46598a', base: '#171c30',
      road: '#9aa4d8', lamp: '#ffd98a', haze: '#ffa070', stars: 0.15, shapes: { box: 1, spire: 0.3 } },
    { name: 'THE MOON', kind: 1, R: 11.1, spin: 0.12, tilt: 0.10, incl: -0.10, atm: '#000000', atmK: 0.0, fire: '#bfe6ff', glow: '#8a94b8',
      sky: ['#02030a', '#0b0f1e', '#2a3048'], fog: '#141826', fogFar: 90, hemi: ['#9aa4c0', '#202020', 0.55], key: ['#ffffff', 1.15], rim: '#6a7aa0',
      city: ['#3a3e4a', '#2a2d36', '#202228'], win: '#bfeaff', tower: '#3c404c', edge: '#7a8296', base: '#2a2b30',
      road: '#a0a4b0', lamp: '#bfeaff', haze: '#8fa8d0', stars: 1, shapes: { dome: 1, box: 0.6, antenna: 0.5 } },
    { name: 'VENUS', kind: 10, R: 11.7, spin: 0.08, tilt: 0.05, incl: -0.15, atm: '#ffd27a', atmK: 0.9, fire: '#ffd23a', glow: '#ffc060',
      sky: ['#5a3a10', '#c08a2a', '#f0d27a'], fog: '#b8893a', fogNear: 16, fogFar: 52, hemi: ['#f5d08a', '#4a3010', 0.85], key: ['#ffd590', 0.8], rim: '#ffb040',
      city: ['#7a5520', '#5a3d15', '#45300f'], win: '#ffcf6b', tower: '#5e4218', edge: '#a07a35', base: '#3d2a10',
      road: '#d8b880', lamp: '#ffe0a0', haze: '#ffd070', stars: 0, shapes: { cyl: 1, spire: 0.8, box: 0.5 } },
    { name: 'MERCURY', kind: 9, R: 11.1, spin: 0.12, tilt: 0.02, incl: -0.10, atm: '#000000', atmK: 0.0, fire: '#ff5a1f', glow: '#ff8040',
      sky: ['#050403', '#1a0f08', '#a04a1a'], fog: '#2a1a10', fogFar: 85, hemi: ['#c0a080', '#201510', 0.6], key: ['#fff0d0', 1.3], rim: '#ff7a30',
      city: ['#4a4038', '#352d27', '#28221d'], win: '#ff9a50', tower: '#40372f', edge: '#8a6a4a', base: '#2c2520',
      road: '#b8a090', lamp: '#ffb070', haze: '#ff8040', stars: 0.6, shapes: { bunker: 1, box: 0.5, dome: 0.4 } },
    { name: 'THE SUN', kind: 8, R: 13.0, spin: 0.10, tilt: 0.1, incl: -0.1, atm: '#ffb040', atmK: 1.6, fire: '#fff2a8', glow: '#ff9030',
      sky: ['#3a0505', '#c0300a', '#ffb030'], fog: '#a03010', hemi: ['#ffb060', '#401005', 0.9], key: ['#ffe0a0', 1.25], rim: '#ff6020',
      city: ['#2a0c06', '#1e0804', '#160603'], win: '#fff4c0', tower: '#2a0e08', edge: '#ff6a20', edgeGlow: '#a02a06', base: '#1a0804',
      road: '#ff9a6a', lamp: '#fff0c0', haze: '#ff7020', stars: 0, shapes: { cyl: 1, spire: 0.6, box: 0.5 } },
    { name: 'MARS', kind: 2, R: 11.4, spin: 0.18, tilt: 0.44, incl: -0.25, atm: '#ff8a5c', atmK: 0.4, fire: '#ff2a3a', glow: '#ff6a3c',
      sky: ['#2a1a2a', '#a0583a', '#e0a070'], fog: '#7a4030', hemi: ['#e0a080', '#2a1410', 0.75], key: ['#ffd0a0', 0.9], rim: '#80a0d0',
      city: ['#6a3324', '#4c2419', '#381a12'], win: '#ffd38a', tower: '#5a2a1e', edge: '#a0523a', base: '#3a1c12',
      road: '#e09a80', lamp: '#ffd98a', haze: '#ff9060', stars: 0.1, shapes: { dome: 1, box: 0.8, antenna: 0.3 } },
    { name: 'JUPITER', kind: 3, R: 13.0, spin: 0.26, tilt: 0.05, incl: -0.15, atm: '#f0d6a8', atmK: 0.35, fire: '#ffa04a', glow: '#ffb070',
      sky: ['#100a14', '#3a2a30', '#c09060'], fog: '#2a2430', hemi: ['#c0d8f0', '#1a2030', 0.7], key: ['#ffe8c8', 0.9], rim: '#e0a070',
      city: ['#5a7090', '#3e5070', '#2c3a52'], win: '#9fe8ff', tower: '#45597a', edge: '#9ac8f0', base: '#2a3448',
      road: '#a8c4e8', lamp: '#bff0ff', haze: '#80c0ff', stars: 0.5, shapes: { spire: 1, box: 0.7 } },
    { name: 'SATURN', kind: 4, R: 11.1, spin: 0.22, tilt: 0.42, incl: -0.32, atm: '#f5e0a8', atmK: 0.3, fire: '#ffe08a', glow: '#ffc880',
      sky: ['#3a2008', '#9a6020', '#d8a050'], fog: '#8a5a20', fogNear: 18, fogFar: 56, hemi: ['#e0b070', '#2a1a08', 0.8], key: ['#ffd090', 0.75], rim: '#ffb050',
      city: ['#4a3418', '#352410', '#281a0b'], win: '#5ff0d0', tower: '#3e2c14', edge: '#8a6a30', base: '#22180a',
      road: '#c0a070', lamp: '#80ffe0', haze: '#ffb060', stars: 0, shapes: { cyl: 1, dome: 0.5, antenna: 0.4 } },
    { name: 'URANUS', kind: 5, R: 11.7, spin: 0.15, tilt: 1.68, incl: -0.62, atm: '#8ff0f0', atmK: 0.7, fire: '#26e0e8', glow: '#6fd8e0',
      sky: ['#0a2a30', '#2a7078', '#9ae0d8'], fog: '#3a8088', hemi: ['#b0f0f0', '#103038', 0.8], key: ['#e0ffff', 0.85], rim: '#a0fff0',
      city: ['#4a7a80', '#33585e', '#244248'], win: '#ff9ae0', tower: '#3a6066', edge: '#8ad0d0', base: '#1c3438',
      road: '#a0d8d8', lamp: '#ffb0e8', haze: '#a0fff0', stars: 0.3, shapes: { box: 1, spire: 0.4, antenna: 0.3 } },
    { name: 'NEPTUNE', kind: 6, R: 11.7, spin: 0.18, tilt: 0.49, incl: -0.25, atm: '#5b8cff', atmK: 0.8, fire: '#2f8bff', glow: '#4a6cff',
      sky: ['#020818', '#0a1e5a', '#2a5ab0'], fog: '#0e1e48', hemi: ['#6a8ae0', '#0a1020', 0.7], key: ['#b0c8ff', 0.85], rim: '#4a7aff',
      city: ['#1e2c58', '#151f42', '#0e1630'], win: '#7ab0ff', tower: '#1c2a56', edge: '#4a6ad0', base: '#0c1430',
      road: '#8a9ad8', lamp: '#9ac0ff', haze: '#4a80ff', stars: 0.7, shapes: { box: 1, spire: 0.7, cyl: 0.4 } },
    { name: 'PLUTO', kind: 7, R: 11.1, spin: 0.12, tilt: 0.30, incl: -0.20, atm: '#9fb4e0', atmK: 0.15, fire: '#c9a2ff', glow: '#a08cc8',
      sky: ['#030305', '#14100e', '#4a3a30'], fog: '#1a1512', fogFar: 85, hemi: ['#c0b0a0', '#141010', 0.5], key: ['#fff0e0', 0.75], rim: '#8a7a6a',
      city: ['#4a4038', '#3a322b', '#2a241f'], win: '#ffcf8a', tower: '#3c342c', edge: '#7a6a5a', base: '#221d18',
      road: '#a89888', lamp: '#ffd0a0', haze: '#c0a080', stars: 1, shapes: { dome: 0.8, bunker: 0.6, antenna: 0.5 } },
    { name: 'OORT CLOUD', vc: [0.15, 0.15], kind: 11, R: 12.5, spin: 1.0, tilt: 0, incl: 0, atm: '#9fe8ff', atmK: 1.0, fire: '#bff4ff', glow: '#7fd8ff',
      sky: ['#01030a', '#081428', '#1c3550'], fog: '#0c1626', fogFar: 90, hemi: ['#9ec4ff', '#0a1018', 0.6], key: ['#dff0ff', 0.8], rim: '#7fd8ff',
      city: ['#3a5a78', '#28425a', '#1c3044'], win: '#aef4ff', tower: '#2e4a66', edge: '#8fd8ff', base: '#14202e',
      road: '#9cc0e0', lamp: '#aef4ff', haze: '#6fb8ff', stars: 1, shapes: { spire: 1, dome: 0.5 } },
    { name: 'ALPHA CENTAURI', vc: [0.52, -0.09], kind: 12, R: 12.0, spin: 1.0, tilt: 0, incl: 0, atm: '#ffd27a', atmK: 1.2, fire: '#ffcc4a', glow: '#ffc060',
      sky: ['#2a1a08', '#a0602a', '#ffd08a'], fog: '#a06a30', hemi: ['#ffe0a0', '#2a1808', 0.9], key: ['#fff0c8', 1.2], rim: '#ff9a50',
      city: ['#5a4030', '#43301f', '#302214'], win: '#ffe8b0', tower: '#4c3624', edge: '#e0a060', base: '#2a1c10',
      road: '#d8b890', lamp: '#fff0c0', haze: '#ffc080', stars: 0.1, shapes: { cyl: 1, box: 0.7, antenna: 0.4 } },
    { name: 'ORION NEBULA', vc: [0.6, 0.9], kind: 13, R: 15.5, spin: 1.0, tilt: 0, incl: 0, atm: '#ff80d0', atmK: 1.0, fire: '#ff5ad0', glow: '#e060c0',
      sky: ['#0a0418', '#3a1450', '#b04a8a'], fog: '#3a1a4a', hemi: ['#e0a0ff', '#100818', 0.8], key: ['#ffc0f0', 0.8], rim: '#60e0e0',
      city: ['#40285a', '#2e1c44', '#201430'], win: '#7ff0e0', tower: '#36224e', edge: '#e07ad0', base: '#180e24',
      road: '#c090d0', lamp: '#80fff0', haze: '#ff80d0', stars: 0.6, shapes: { spire: 1, box: 0.6 } },
    { name: 'PULSAR', vc: [0, 0], kind: 14, R: 12.5, spin: 1.0, tilt: 0, incl: 0, atm: '#7ab8ff', atmK: 1.0, fire: '#8ad8ff', glow: '#5aa8ff',
      sky: ['#000208', '#04102a', '#103060'], fog: '#061230', hemi: ['#80b0ff', '#04060c', 0.6], key: ['#d0e4ff', 0.9], rim: '#4a9aff',
      city: ['#1a2440', '#121a30', '#0c1222'], win: '#9ad0ff', tower: '#16203a', edge: '#5ab0ff', edgeGlow: '#103a80', base: '#080c18',
      road: '#7090c0', lamp: '#b0e0ff', haze: '#3a7aff', stars: 0.9, shapes: { antenna: 1, bunker: 0.6, box: 0.5 } },
    { name: 'ANDROMEDA', vc: [0.95, 0.05], kind: 15, R: 16.0, spin: 1.0, tilt: 0, incl: 0, atm: '#c0b0ff', atmK: 1.0, fire: '#ffd27a', glow: '#b090ff',
      sky: ['#04020c', '#160c30', '#3a2458'], fog: '#1a1030', fogFar: 85, hemi: ['#c0b0ff', '#08060e', 0.7], key: ['#fff0e0', 0.85], rim: '#ffc080',
      city: ['#2a2448', '#1e1a36', '#141026'], win: '#ffd8a0', tower: '#242040', edge: '#b09ae0', base: '#0e0a1a',
      road: '#a898d0', lamp: '#ffe0b0', haze: '#a080ff', stars: 1, shapes: { spire: 0.8, cyl: 0.6, dome: 0.5 } },
    { name: 'MILKY WAY', vc: [0.5, 0.75], kind: 16, R: 16.5, span: 7, spin: 1.0, tilt: 0, incl: 0, atm: '#d0c0ff', atmK: 1.0, fire: '#ffe0a0', glow: '#c8a8ff',
      sky: ['#020208', '#0a0a22', '#2a1e44'], fog: '#120e28', fogFar: 85, hemi: ['#c8b8ff', '#0a0814', 0.7], key: ['#ffe8c0', 0.9], rim: '#ffb070',
      city: ['#2c2650', '#201c3c', '#16122a'], win: '#ffe2a0', tower: '#28224a', edge: '#c0a8ff', base: '#100c1e',
      road: '#b0a0e0', lamp: '#ffe8b0', haze: '#c090ff', stars: 1, shapes: { spire: 1, cyl: 0.6, antenna: 0.4 } },
    { name: 'TON 618', kind: 'bh', R: 11.0, dx: -9, fire: '#6a1fd0', glow: '#ff8a5c',   // v2.6: finalde gölgesi daha çok görünsün diye ekrana 9 birim içeri
      sky: [P.skyTop, P.skyMid, P.skyLow], fog: '#4a3466', hemi: ['#8d79c9', P.ground, 0.75], key: ['#ffb27a', 0.95], rim: P.skyLow,
      city: [P.cityFar, P.cityNear, '#1f1a38'], win: P.glow, tower: P.tower, edge: P.towerEdge, base: '#211c3c',
      road: '#b4a6e6', lamp: '#ffd98a', haze: '#ffa874', stars: 0.2, shapes: { box: 1, spire: 0.25 } }
  ];
  // v2.6 Halil'in sırası: Dünya, Ay, sonra güneş sisteminde en sadeden en havalıya; halkalılar (Satürn, Uranüs) Güneş'ten hemen önce,
  // Güneş sistemin finali. Sonra derin uzayda yine sadeden havalıya; TON 618 her zaman son.
  var ORDER = ['EARTH', 'THE MOON', 'MERCURY', 'PLUTO', 'MARS', 'VENUS', 'NEPTUNE', 'JUPITER', 'SATURN', 'URANUS', 'THE SUN',
               'ALPHA CENTAURI', 'OORT CLOUD', 'ORION NEBULA', 'ANDROMEDA', 'MILKY WAY', 'PULSAR', 'TON 618'];
  BODIES = ORDER.map(function (n) { return BODIES.filter(function (b) { return b.name === n; })[0]; });
  // v2.6: her gök cismine kendi kulesi (çarpışma kutusu aynı; sadece görünüş değişir, süsler boşluğa taşmaz)
  var TOWER_STYLE = { 'EARTH': 'clock', 'THE MOON': 'lunar', 'MERCURY': 'bunker', 'PLUTO': 'ice', 'MARS': 'silo', 'VENUS': 'cloud',
    'NEPTUNE': 'strips', 'JUPITER': 'bands', 'SATURN': 'ringed', 'URANUS': 'tilted', 'THE SUN': 'flare', 'ALPHA CENTAURI': 'twin',
    'OORT CLOUD': 'shards', 'ORION NEBULA': 'crystal', 'ANDROMEDA': 'hover', 'MILKY WAY': 'obelisk', 'PULSAR': 'pylon', 'TON 618': 'clocktower' };
  var PLANET_EVERY = KK.PLANET_EVERY = KK.TEST_BUILD ? 10 : 200;   // v2.5: test sayfasında hızlı geçiş
  KK.JOURNEY_END = BODIES.length * PLANET_EVERY;           // v2.2: son gök cisminde de 200 puan uçunca yolculuk biter
  KK.BODY_NAMES = BODIES.map(function (b) { return b.name; });                                   // kaç puanda bir gök cismi değişir (v2.0: tekrar 200)
  var PL_HX = 2.6, PL_HY = 1.6, PL_DEEP = 3.4;   // dörtgenin yarı boyu (yarıçap biriminde); v2.5: derin uzay cisimleri kare (3.4R)
  var PL_FRAG = [
    'uniform float uTime; uniform float uFade; uniform float uSpin; uniform float uTilt; uniform float uIncl; uniform float uAtmK;',
    'uniform vec3 uAtm; varying vec2 vUv;',
    'float h3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }',
    'float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);',
    '  return mix(mix(mix(h3(i), h3(i+vec3(1.0,0.0,0.0)), f.x), mix(h3(i+vec3(0.0,1.0,0.0)), h3(i+vec3(1.0,1.0,0.0)), f.x), f.y),',
    '             mix(mix(h3(i+vec3(0.0,0.0,1.0)), h3(i+vec3(1.0,0.0,1.0)), f.x), mix(h3(i+vec3(0.0,1.0,1.0)), h3(i+vec3(1.0,1.0,1.0)), f.x), f.y), f.z); }',
    'float fbm(vec3 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a*n3(p); p = p*2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return v; }',
    'vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }',
    'vec3 toPlanet(vec3 n, float spin){ n.xy = rot(n.xy, uTilt); n.yz = rot(n.yz, uIncl); n.xz = rot(n.xz, spin); return n; }',
    'vec2 lonlat(vec3 q){ return vec2(atan(q.z, q.x), asin(clamp(q.y, -1.0, 1.0))); }',
    // kraterler: küre üzerinde sabit noktalar etrafında çanak + parlak kenar
    'vec3 craters(vec3 q, vec3 col, float seed){',
    '  for (int i = 0; i < 16; i++) {',
    '    float fi = float(i) + seed;',
    '    vec3 cd = normalize(vec3(h3(vec3(fi,1.3,2.7)) - 0.5, h3(vec3(fi,5.1,7.9)) - 0.5, h3(vec3(fi,9.7,3.3)) - 0.5));',
    '    float cr = 0.05 + 0.14*h3(vec3(fi,4.4,4.1));',
    '    float d = distance(q, cd);',
    '    col *= 1.0 - 0.28*smoothstep(cr*0.95, cr*0.55, d);',
    '    col += vec3(0.10) * (smoothstep(cr*1.3, cr*1.0, d) - smoothstep(cr*1.0, cr*0.8, d));',
    '  }',
    '  return col;',
    '}',
    'vec3 surface(vec3 q, vec3 n, vec3 L, float lam){',
    '  float lat = q.y;',
    '#if KIND == 0',                                          // DÜNYA
    '  float c = fbm(q*2.1 + 3.0);',
    '  float land = smoothstep(0.515, 0.535, c);',
    '  float m = fbm(q*5.0 + 11.0);',
    '  vec3 ocean = mix(vec3(0.01,0.06,0.22), vec3(0.04,0.25,0.52), smoothstep(0.25, 0.52, c));',
    '  vec3 grd = mix(vec3(0.15,0.36,0.12), vec3(0.58,0.48,0.30), smoothstep(0.45, 0.66, m));',
    '  vec3 col = mix(ocean, grd, land);',
    '  col = mix(col, vec3(0.90,0.94,1.0), smoothstep(0.89, 0.93, abs(lat) + (m - 0.5)*0.12));',   // v2.1: buzullar küçüldü
    '  vec3 lit = col * (0.03 + 1.05*lam);',
    '  vec3 R = reflect(-L, n); lit += vec3(1.0,0.9,0.75) * pow(max(R.z, 0.0), 28.0) * 0.5 * (1.0 - land) * step(0.001, lam);',
    '  vec3 qc = toPlanet(n, uTime*uSpin*1.7 + 1.3);',
    '  float cl = smoothstep(0.50, 0.72, fbm(qc*3.0 + vec3(0.0, uTime*0.015, 0.0)));',
    '  lit = mix(lit, vec3(1.0) * (0.04 + 1.0*lam), cl*0.85);',
    '  float night = smoothstep(0.10, 0.0, lam) * land * (1.0 - cl);',
    '  lit += vec3(1.0,0.72,0.32) * night * step(0.82, h3(floor(q*80.0))) * smoothstep(0.40, 0.60, m);',
    '  return lit;',
    '#elif KIND == 1',                                        // AY
    '  float m = fbm(q*1.8 + 2.0);',
    '  vec3 col = mix(vec3(0.30,0.30,0.32), vec3(0.74,0.73,0.70), smoothstep(0.38, 0.60, m));',
    '  col *= 0.88 + 0.24*fbm(q*10.0);',
    '  col = craters(q, col, 0.0);',
    '  return col * (0.02 + 1.3*lam);',
    '#elif KIND == 2',                                        // MARS
    '  float m = fbm(q*2.0 + 1.0);',
    '  vec3 col = mix(vec3(0.52,0.18,0.07), vec3(0.86,0.46,0.22), smoothstep(0.30, 0.66, m));',
    '  col = mix(col, vec3(0.30,0.12,0.06), smoothstep(0.55, 0.72, fbm(q*3.4 + 8.0))*0.75);',
    // v2.6: Valles Marineris eskiden gezegeni boydan boya saran düz bir çizgiydi. Gerçeği ~4000 km (çevrenin ~%19'u ≈ 1.2 rad):
    // boylamda 1.2 rad'lık pencereyle sınırlı, kıvrımlı ve kesik kesik.
    '  vec2 ll = lonlat(q); float vw = smoothstep(0.62, 0.0, abs(ll.x - 0.9));',
    '  float vm = smoothstep(0.03, 0.0, abs(lat + 0.08 + (m-0.5)*0.10 + 0.04*sin(ll.x*5.0))) * vw * (0.45 + 0.55*fbm(q*9.0));',
    '  col = mix(col, vec3(0.38,0.14,0.07), vm * 0.65);',
    '  col = mix(col, vec3(0.96,0.94,0.90), smoothstep(0.86, 0.91, abs(lat) + (m - 0.5)*0.12));',
    '  return col * (0.025 + 1.05*lam);',
    '#elif KIND == 3',                                        // JÜPİTER
    // v2.6: eskiden sin(enlem·22) ile 11 eş aralıklı çizgi vardı (kendini tekrar ediyordu). Artık gerçek kuşak haritası:
    // ekvator kuşağı açık (|enlem| < 0.12), Kuzey/Güney Ekvator Kuşakları koyu kahve (0.12–0.32), ılıman kuşaklar ince (≈0.5),
    // kutuplar gri-mavi (> 0.65). Kuşaklar arası rüzgârlar ters yönde akar, kenarlarında girdap ve koyu "festoon"lar olur.
    '  float jet = sin(lat*10.0);',
    '  vec3 qf = q + vec3(0.0, 0.0, uTime*0.03*sign(jet));',
    '  float tl = lat + (fbm(qf*3.0) - 0.5)*0.07 + (fbm(qf*9.0 + 3.0) - 0.5)*0.025;',
    '  float a = abs(tl);',
    '  float neb = smoothstep(0.10, 0.14, tl) * smoothstep(0.33, 0.27, tl);',
    '  float seb = smoothstep(-0.11, -0.15, tl) * smoothstep(-0.35, -0.29, tl);',
    '  float tb = smoothstep(0.44, 0.47, a) * smoothstep(0.56, 0.52, a);',
    '  float pol = smoothstep(0.6, 0.82, a);',
    '  vec3 col = vec3(0.95, 0.90, 0.80);',
    '  col = mix(col, vec3(0.95, 0.83, 0.64), smoothstep(0.11, 0.0, a)*0.45);',
    '  col = mix(col, vec3(0.66, 0.43, 0.28), neb*0.85);',
    '  col = mix(col, vec3(0.72, 0.49, 0.32), seb*0.8);',
    '  col = mix(col, vec3(0.78, 0.63, 0.48), tb*0.6);',
    '  col = mix(col, vec3(0.60, 0.60, 0.64), pol*0.7);',
    '  col *= 0.9 + 0.16*fbm(vec3(qf.x*2.5, qf.y*12.0, qf.z*2.5));',
    '  float fest = smoothstep(0.66, 0.84, fbm(qf*7.0 + 5.0)) * smoothstep(0.05, 0.0, abs(tl - 0.11));',
    '  col = mix(col, vec3(0.40, 0.40, 0.50), fest*0.6);',
    '  float ov = smoothstep(0.78, 0.9, fbm(qf*6.0 + 21.0)) * smoothstep(0.05, 0.0, abs(tl + 0.5));',
    '  col = mix(col, vec3(0.98, 0.96, 0.92), ov*0.7);',
    '  float edge = max(smoothstep(0.03, 0.0, abs(a - 0.12)), smoothstep(0.03, 0.0, abs(a - 0.31)));',
    '  float eddy = smoothstep(0.6, 0.8, fbm(qf*9.0 + 11.0)) * edge;',
    '  col = mix(col, vec3(0.97, 0.94, 0.88), eddy*0.45);',
    '  vec2 ll = lonlat(q); vec2 d = (ll - vec2(0.7, -0.38)) * vec2(1.0, 2.2); float sp = length(d);',
    '  float sw = atan(d.y, d.x) + (0.24 - sp)*16.0 - uTime*0.35;',                    // içe doğru dönen sarmal
    '  float swn = fbm(vec3(cos(sw)*sp*10.0, sin(sw)*sp*10.0, 3.0));',
    '  col = mix(col, vec3(0.96,0.88,0.76), smoothstep(0.27, 0.21, sp)*smoothstep(0.16, 0.2, sp)*0.75);',   // açık renkli yaka
    '  vec3 grs = mix(vec3(0.60,0.20,0.11), vec3(0.90,0.48,0.27), smoothstep(0.3, 0.75, swn));',
    '  grs = mix(grs, vec3(0.96,0.66,0.44), smoothstep(0.09, 0.0, sp)*0.55);',          // daha açık merkez
    '  col = mix(col, grs, smoothstep(0.195, 0.13, sp + (swn - 0.5)*0.05));',
    '  return col * (0.025 + 1.05*lam);',
    '#elif KIND == 4',                                        // SATÜRN
    '  float tl = lat + (fbm(q*3.0) - 0.5)*0.05;',
    '  float b = sin(tl*15.0);',
    '  vec3 col = mix(vec3(0.94,0.86,0.64), vec3(0.80,0.67,0.45), smoothstep(-0.2, 0.8, b));',
    '  col = mix(col, vec3(0.70,0.62,0.50), smoothstep(0.88, 0.97, abs(lat))*0.6);',
    '  col *= 0.93 + 0.12*fbm(vec3(q.x*2.0, q.y*20.0, q.z*2.0));',
    '  return col * (0.025 + 1.05*lam);',
    '#elif KIND == 5',                                        // URANÜS
    '  vec3 col = vec3(0.60,0.86,0.88) * (0.97 + 0.04*sin(lat*7.0)) * (0.96 + 0.08*fbm(q*3.0));',
    '  return col * (0.03 + 1.0*lam);',
    '#elif KIND == 6',                                        // NEPTÜN
    '  float tl = lat + (fbm(q*3.0) - 0.5)*0.08;',
    '  vec3 col = mix(vec3(0.14,0.28,0.78), vec3(0.28,0.48,0.96), 0.5 + 0.5*sin(tl*9.0));',
    '  vec2 ll = lonlat(q); float sp = length((ll - vec2(0.5, -0.32)) * vec2(1.0, 2.0));',
    '  col = mix(col, vec3(0.06,0.12,0.40), smoothstep(0.16, 0.10, sp));',
    '  float st = smoothstep(0.62, 0.72, fbm(vec3(q.x*2.0, q.y*16.0, q.z*2.0) + 4.0));',
    '  col = mix(col, vec3(0.92,0.95,1.0), st*0.8);',
    '  return col * (0.03 + 1.0*lam);',
    '#elif KIND == 7',                                        // PLÜTON (kalp: Tombaugh Regio)
    '  float m = fbm(q*2.4 + 5.0);',
    '  vec3 col = mix(vec3(0.42,0.26,0.17), vec3(0.80,0.70,0.57), smoothstep(0.35, 0.62, m));',
    '  vec2 ll = lonlat(q); vec2 h = (ll - vec2(0.4, 0.05)) * vec2(2.6, 3.0); h.y += 0.15;',
    '  float hf = pow(h.x*h.x + h.y*h.y - 1.0, 3.0) - h.x*h.x*h.y*h.y*h.y;',
    '  col = mix(col, vec3(0.97,0.93,0.86), smoothstep(0.04, -0.06, hf + (m-0.5)*0.12));',
    '  return col * (0.02 + 1.05*lam);',
    '#elif KIND == 8',                                        // GÜNEŞ: granülasyon, lekeler, kenar kararması (kendi ışığı)
    '  float g = fbm(q*16.0 + vec3(0.0, uTime*0.06, 0.0));',
    '  float g2 = fbm(q*4.0 - vec3(uTime*0.03));',
    '  vec3 col = mix(vec3(1.0,0.42,0.06), vec3(1.0,0.90,0.55), clamp(g*0.9 + g2*0.5 - 0.15, 0.0, 1.0));',
    '  float spot = smoothstep(0.66, 0.72, fbm(q*3.0 + 20.0)) * smoothstep(0.6, 0.2, abs(lat));',
    '  col = mix(col, vec3(0.35,0.08,0.02), spot*0.8);',
    '  col *= 0.5 + 0.5*pow(n.z, 0.55);',
    '  return col * 1.25;',
    '#elif KIND == 9',                                        // MERKÜR: kahve-gri, sık kraterli
    '  float m = fbm(q*2.6 + 7.0);',
    '  vec3 col = mix(vec3(0.34,0.30,0.27), vec3(0.68,0.62,0.55), m);',
    '  col *= 0.85 + 0.3*fbm(q*12.0);',
    '  col = craters(q, col, 31.0); col = craters(q*1.4, col, 57.0);',
    '  return col * (0.015 + 1.15*lam);',
    '#else',                                                  // VENÜS: kalın, girdaplı sarı bulut örtüsü
    '  vec3 w = q + 0.35*vec3(fbm(q*2.0 + uTime*0.02), fbm(q*2.0 + 5.0), fbm(q*2.0 + 9.0));',
    '  float v = fbm(vec3(w.x*2.0, w.y*5.0, w.z*2.0));',
    '  vec3 col = mix(vec3(0.80,0.62,0.34), vec3(0.99,0.93,0.74), v);',
    '  return col * (0.03 + 1.0*lam);',
    '#endif',
    '}',
    'float ringDensity(float rr){',
    '#if KIND == 4',
    '  if (rr < 1.24 || rr > 2.25) return 0.0;',
    '  float x = (rr - 1.24) / 1.01;',
    '  float d = 0.30 + 0.45*smoothstep(0.08, 0.40, x);',
    '  d *= 1.0 - (smoothstep(0.60, 0.62, x) - smoothstep(0.66, 0.68, x));',
    '  d *= x > 0.67 ? 0.72 : 1.0;',
    '  d *= 0.80 + 0.20*sin(rr*95.0);',
    '  return d * smoothstep(0.0, 0.03, x) * smoothstep(1.0, 0.97, x);',
    '#else',
    // v2.6: Uranüs halkaları ekranda ~1.5 piksel kalıyordu (0.012 R). 2.5 kat kalın + aralarında soluk toz bandı
    '  return 0.95*smoothstep(0.03, 0.0, abs(rr - 1.56)) + 0.6*smoothstep(0.02, 0.0, abs(rr - 1.47)) + 0.55*smoothstep(0.02, 0.0, abs(rr - 1.41)) + 0.14*smoothstep(1.36, 1.40, rr)*smoothstep(1.62, 1.58, rr);',
    '#endif',
    '}',
    // ---- v2.3: Derin uzay (KIND 11..15) — küre yerine kendi biçimleri ----
    'vec3 glowStar(vec2 p, vec2 c, float r, vec3 col, float k){ float d = length(p - c); return col * (exp(-max(d - r, 0.0)*k) * 0.9 + exp(-d*d/(r*r)) ); }',
    'vec4 deep(vec2 p, float quad){',
    '  vec3 C = vec3(0.0); float A = 0.0; float t = uTime;',
    '#if KIND == 11',                                     // OORT: kuyruklu yıldız — çekirdek, koma, iyon ve toz kuyruğu + buz kırıntıları
    '  vec2 dir = normalize(vec2(-1.0, 0.42)); vec2 nrm = vec2(-dir.y, dir.x);',   // v2.6: kuyruk sola-yukarı, ekranın içine (sağ üstte sığmıyordu)
    '  float al = dot(p, dir), pe = dot(p, nrm);',
    '  pe += 0.035*sin(al*2.2 - t*1.3)*max(al, 0.0);',                              // v2.5: kuyruk yavaşça dalgalanır
    '  float ion = exp(-pow(pe / (0.04 + 0.05*max(al, 0.0)), 2.0)) * exp(-max(al, 0.0)*0.8) * step(0.0, al);',
    '  ion *= 0.6 + 0.6*n3(vec3(al*3.0 - t*0.8, pe*12.0, 1.0));',
    '  float pd = pe + 0.10*al*al;',                      // toz kuyruğu yörüngede kıvrılır
    '  float dust = exp(-pow(pd / (0.08 + 0.22*max(al, 0.0)), 2.0)) * exp(-max(al, 0.0)*1.0) * step(0.0, al);',
    '  float r = length(p);',
    '  float breath = 0.88 + 0.12*sin(t*1.7);',                                      // çekirdek nefes alır
    '  C += vec3(0.45, 0.75, 1.0) * ion * 0.55 + vec3(1.0, 0.86, 0.6) * dust * 0.4 * (0.85 + 0.3*n3(vec3(al*2.0 - t*0.4, pe*6.0, 2.0)));',   // v2.5: ~yarı parlaklık
    '  C += vec3(0.75, 0.95, 1.0) * exp(-r*3.2) * 0.8 * breath + vec3(1.0) * exp(-r*r*90.0) * 1.2 * breath;',
    '  vec2 g = floor(p*14.0); float sp = step(0.985, h3(vec3(g, 3.0)));',   // Oort bulutunun buz kırıntıları
    '  C += vec3(0.7, 0.9, 1.0) * sp * smoothstep(0.08, 0.0, length(fract(p*14.0) - 0.5)) * (0.5 + 0.5*sin(t*2.0 + g.x*3.0));',
    '  A = clamp(exp(-r*r*60.0), 0.0, 1.0);',
    '#elif KIND == 12',                                   // ALPHA CENTAURI: A (sarı) + B (turuncu) + Proxima (kırmızı cüce)
    // v2.5: A ve B ortak kütle merkezinin etrafında döner (bir tur ~52 sn, eğik yörünge); B arkaya geçince A'nın arkasında kalır
    '  float w = t*0.12; vec2 bary = vec2(0.52, -0.09), ov = rot(vec2(cos(w), 0.35*sin(w)) * 1.27, -0.4);',
    '  vec2 ca = bary - 0.45*ov, cb = bary + 0.55*ov; float bFront = step(0.0, -sin(w));',
    '  float da = length(p - ca), db = length(p - cb);',
    '  float ga = fbm(vec3((p - ca)*9.0, t*0.22)), gb = fbm(vec3((p - cb)*11.0, t*0.26 + 4.0));',
    '  float ra = 0.55, rb = 0.40;',
    '  vec3 sa = mix(vec3(1.0, 0.78, 0.40), vec3(1.0, 0.97, 0.85), ga) * (0.6 + 0.4*sqrt(max(0.0, 1.0 - da*da/(ra*ra))));',
    '  vec3 sb = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.75, 0.45), gb) * (0.6 + 0.4*sqrt(max(0.0, 1.0 - db*db/(rb*rb))));',
    '  float ea = smoothstep(ra, ra - 0.015, da), eb = smoothstep(rb, rb - 0.015, db);',
    '  if (bFront > 0.5) { C = sa*ea; A = ea; C = sb*eb + C*(1.0 - eb); A = eb + A*(1.0 - eb); }',
    '  else { C = sb*eb; A = eb; C = sa*ea + C*(1.0 - ea); A = ea + A*(1.0 - ea); }',
    '  C += vec3(1.0, 0.8, 0.45) * exp(-max(da - ra, 0.0)*3.5) * 0.55 * (1.0 - ea) * quad;',
    '  C += vec3(1.0, 0.55, 0.25) * exp(-max(db - rb, 0.0)*4.0) * 0.45 * (1.0 - eb) * quad;',
    '  vec2 cp = vec2(2.05, 0.85); float dp = length(p - cp);',
    '  C += vec3(1.0, 0.25, 0.15) * (exp(-dp*dp*900.0)*1.4 + exp(-dp*14.0)*0.35) * (0.85 + 0.15*sin(t*3.0));',
    '#elif KIND == 13',                                   // ORION: bükülen gaz, toz şeritleri, Trapez yıldızları
    // v2.5: gaz yavaşça akar ve kıvrılır; parlak merkez ve Trapez yıldızları uçuş hattından yukarı alındı (y ≈ +0.95R)
    '  vec2 q = p*0.9 + vec2(t*0.012, 0.0); vec3 w = vec3(q, t*0.05);',
    '  vec3 wq = w + 0.6*vec3(fbm(w*1.3 + 1.0 + t*0.02), fbm(w*1.3 + 7.0 - t*0.015), 0.0);',
    '  float d1 = fbm(wq*1.6), d2 = fbm(wq*3.1 + 5.0);',
    '  vec2 oc = vec2(0.6, 0.95);',
    '  float r = length(p - oc);',
    '  float mask = exp(-r*0.75) * smoothstep(0.25, 0.75, d1);',
    '  vec3 gas = mix(vec3(0.95, 0.25, 0.55), vec3(0.20, 0.75, 0.85), smoothstep(0.35, 0.7, d2));',
    '  gas = mix(gas, vec3(1.0, 0.75, 0.45), exp(-r*2.2));',
    '  float lanes = smoothstep(0.55, 0.75, fbm(wq*2.2 + 11.0));',
    '  C = gas * mask * 1.3 * (1.0 - 0.75*lanes) * quad;',
    '  A = clamp(mask*0.35 + lanes*mask*0.4, 0.0, 0.7) * quad;',
    '  vec2 tz[4]; tz[0] = vec2(0.55, 0.97); tz[1] = vec2(0.67, 0.90); tz[2] = vec2(0.61, 0.83); tz[3] = vec2(0.72, 1.00);',
    '  for (int i = 0; i < 4; i++) { float ds = length(p - tz[i]); float tw = 0.8 + 0.2*sin(t*2.3 + float(i)*1.7); C += vec3(0.75, 0.88, 1.0) * (exp(-ds*ds*3000.0)*1.6 + exp(-ds*30.0)*0.25) * tw; }',
    '#elif KIND == 14',                                   // PULSAR: dönen iki hüzme, her bize bakışta çakan çekirdek, enkaz halkası
    '  float th = t*2.2;',
    '  vec2 dir = normalize(vec2(cos(th), sin(th)*0.45 + 0.12));',
    '  vec2 nrm = vec2(-dir.y, dir.x);',
    '  float al = dot(p, dir), pe = dot(p, nrm);',
    '  float beam = exp(-pow(pe / (0.025 + 0.09*abs(al)), 2.0)) * exp(-abs(al)*0.35);',
    '  float face = pow(max(0.0, abs(cos(th))), 24.0);',  // hüzme bize dönünce çakar
    '  float r = length(p);',
    '  C += vec3(0.55, 0.8, 1.0) * beam * 1.8;',
    '  C += vec3(0.85, 0.93, 1.0) * (exp(-r*r*400.0)*2.0 + exp(-r*9.0)*(0.5 + 1.6*face));',
    '  float ang = atan(p.y, p.x);',
    '  float ring = exp(-pow((length(vec2(p.x, p.y*1.8)) - 1.35) / 0.28, 2.0)) * fbm(vec3(cos(ang)*3.0, sin(ang)*3.0, t*0.05 + r));',
    '  C += vec3(0.85, 0.35, 0.75) * ring * 0.85 * quad;',
    '  A = clamp(exp(-r*r*400.0), 0.0, 1.0);',
    '#elif KIND == 16',                                   // v2.6 SAMANYOLU: Dünya'dan görünüşü — gökyüzünü çapraz kesen ışık şeridi
    // Şerit kıvrılarak akar; ortasından koyu toz "Büyük Yarık" geçer; bir ucunda galaksinin merkezi (Yay) şişkin ve sıcak renkli;
    // içinde pembe bulutsular ve yoğun yıldız alanı (yıldız yoğunluğu şeridin içinde ~9 kat fazla: eşik 0.995 → 0.955).
    '  vec2 d = normalize(vec2(1.0, 0.55)), nn = vec2(-d.y, d.x);',     // sağa doğru yükselen şerit (sol alttan sağ üste)
    '  vec2 pc = p - vec2(0.5, 0.75);',
    '  float al = dot(pc, d), pe = dot(pc, nn);',
    '  pe += 0.12*sin(al*0.45 + 0.6) + 0.08*(fbm(vec3(al*0.6, 0.0, t*0.02)) - 0.5);',
    '  float w = 0.3 + 0.07*sin(al*0.7 + 1.0);',
    '  float band = exp(-pe*pe/(w*w));',
    '  float bulge = exp(-pow(al - 0.9, 2.0)/0.9) * exp(-pe*pe/0.16);',
    '  float cloud = fbm(vec3(al*1.4 - t*0.01, pe*3.0, 3.0));',
    '  float fine = fbm(vec3(al*4.0, pe*8.0, 7.0 + t*0.015));',
    '  float rift = smoothstep(0.45, 0.72, fbm(vec3(al*1.1 + 2.0, pe*9.0, 1.0))) * exp(-pow((pe + 0.03)/0.12, 2.0)) * smoothstep(-3.0, 0.0, al);',
    '  vec3 starC = mix(vec3(0.62, 0.70, 1.0), vec3(1.0, 0.84, 0.62), clamp(bulge*1.6, 0.0, 1.0));',
    '  float glow = band*(0.4 + 0.6*cloud)*(0.65 + 0.55*fine) + bulge*0.75;',
    '  C = starC * glow * (1.0 - 0.85*rift) * 1.5;',
    '  float neb = smoothstep(0.74, 0.8, fbm(vec3(al*3.0, pe*6.0, 11.0))) * band;',
    '  C += vec3(1.0, 0.42, 0.62) * neb * 0.4;',
    '  vec2 g = floor(p*30.0); float sh = h3(vec3(g, 5.0));',
    '  float st = step(mix(0.995, 0.955, band), sh);',
    '  C += vec3(0.9, 0.95, 1.0) * st * smoothstep(0.16, 0.0, length(fract(p*30.0) - 0.5)) * (0.55 + 0.45*sin(t*(1.5 + sh*3.0) + sh*40.0));',
    '  C *= quad;',
    '  A = clamp(glow*0.3 + rift*band*0.6, 0.0, 0.65) * quad;',
    '#else',                                              // ANDROMEDA: eğik sarmal galaksi
    '  vec2 q = rot(p - vec2(0.95, 0.05), -0.45); q.y /= 0.32;',   // merkez ekrana kaydırıldı
    '  float r = length(q), ang = atan(q.y, q.x);',
    '  float arm = cos(2.0*(ang - log(r + 0.08)*2.3) - t*0.12);',   // v2.5: kollar görünür hızda döner
    '  float n = fbm(vec3(q*2.2, 3.0));',
    '  float disk = exp(-r*0.85) * (0.35 + 0.65*smoothstep(-0.1, 1.0, arm)*(0.6 + 0.6*n));',
    '  float dust = smoothstep(0.55, 0.95, cos(2.0*(ang - log(r + 0.08)*2.3) - 0.9 - t*0.12)) * smoothstep(0.15, 0.6, r) * exp(-r*0.6);',
    '  float core = (exp(-r*6.0)*1.6 + exp(-r*r*40.0)*1.2) * (0.92 + 0.08*sin(t*1.3));',
    '  vec3 col = mix(vec3(0.70, 0.78, 1.0), vec3(1.0, 0.86, 0.62), exp(-r*1.4));',
    '  float hii = step(0.82, fbm(vec3(q*7.0, 9.0))) * smoothstep(0.2, 0.5, arm) * exp(-r*0.8);',
    '  C = (col*disk*(1.0 - 0.7*dust) + vec3(1.0, 0.85, 0.65)*core + vec3(1.0, 0.45, 0.7)*hii*0.6) * 2.1 * quad;',
    '  vec2 m32 = p - vec2(1.5, 0.42); C += vec3(1.0, 0.9, 0.75) * exp(-dot(m32, m32)*120.0) * 0.6;',
    '  vec2 m110 = rot(p - vec2(0.7, -0.75), 0.4); m110.y *= 2.0; C += vec3(1.0, 0.9, 0.8) * exp(-dot(m110, m110)*25.0) * 0.3;',
    '  A = clamp(disk*0.5 + core*0.3, 0.0, 0.85) * quad;',
    '#endif',
    '  return vec4(C, A);',
    '}',
    'void main(){',
    '  vec2 p = (vUv*2.0 - 1.0) * vec2(HX, HY);',
    '  float r = length(p);',
    '  float quad = smoothstep(1.0, 0.8, abs(vUv.x*2.0 - 1.0)) * smoothstep(1.0, 0.75, abs(vUv.y*2.0 - 1.0));', // dörtgen kenarı görünmesin
    '#if KIND >= 11',
    // v2.5: derin uzayda dörtgen kare; HER katman merkezden kenara yuvarlak bir geçişle söner (ışınlar/kuyruklar kesilmesin)
    '#if KIND == 16',
    '  float circ = 1.0;',                                // Samanyolu şeridi kenara kadar uzanır (sadece dörtgen kenarı söner)
    '#else',
    '  float circ = smoothstep(1.0, 0.55, length(vUv*2.0 - 1.0));',
    '#endif',
    '  gl_FragColor = deep(p, quad) * circ * uFade; return;',   // v2.6: aynalama kaldırıldı → ayrıntılar sağ üste yaslanır
    '#endif',
    '  vec3 L = normalize(vec3(-0.75, 0.30, 0.60));',   // v2.6: gök cismi sağ üstte → ışık soldan (ekranın ortasından)
    '  vec3 C = vec3(0.0); float A = 0.0;',
    '#if RING',
    '  vec3 ax = vec3(0.0, 1.0, 0.0); ax.yz = rot(ax.yz, -uIncl); ax.xy = rot(ax.xy, -uTilt);',
    '  float rz = -(ax.x*p.x + ax.y*p.y) / ax.z;',
    '  vec3 hp = vec3(p, rz);',
    '  float rr = length(hp);',
    // v2.5: halka parçacıkları Kepler hızıyla döner (ω ∝ r^-1.5: iç kenar dıştan ~2.4 kat hızlı) → kümeler ve koyu "spoke"lar akar
    '  vec3 e1 = normalize(vec3(ax.y, -ax.x, 0.0)), e2 = cross(ax, e1);',
    '  float rph = atan(dot(hp, e2), dot(hp, e1)) - uTime*0.35*pow(rr, -1.5);',
    '  float clump = n3(vec3(cos(rph)*4.0, sin(rph)*4.0, rr*22.0));',
    '  float spoke = smoothstep(0.75, 1.0, sin(rph*7.0)) * smoothstep(1.5, 1.6, rr) * smoothstep(2.0, 1.9, rr);',
    '  float ra = min(1.0, ringDensity(rr) * 1.2 * (0.72 + 0.45*clump) * (1.0 - 0.25*spoke));',
    '  float tt = -dot(hp, L);',
    '  float shade = (tt > 0.0 && length(hp + tt*L) < 1.0) ? 0.18 : 1.0;',
    '#if KIND == 4',
    '  vec3 rc = vec3(1.0, 0.91, 0.70) * shade;',
    '#else',
    '  vec3 rc = vec3(0.80, 0.94, 1.0) * shade * 1.25;',
    '#endif',
    '  if (rz < 0.0) { C = rc*ra; A = ra; }',
    '#endif',
    '  if (r < 1.0) {',
    '    vec3 n = vec3(p, sqrt(1.0 - r*r));',
    '    float lam = max(dot(n, L), 0.0);',
    '    vec3 pc = surface(toPlanet(n, uTime*uSpin), n, L, lam);',
    '    pc += uAtm * uAtmK * pow(1.0 - n.z, 2.5) * (0.15 + 0.9*lam) * 0.9;',
    '    float e = smoothstep(1.0, 0.988, r);',
    '    C = pc*e + C*(1.0 - e); A = e + A*(1.0 - e);',
    '  }',
    '#if RING',
    '  if (rz >= 0.0) { C = rc*ra + C*(1.0 - ra); A = ra + A*(1.0 - ra); }',
    '#endif',
    '#if KIND == 8',                                          // Güneş tacı: yavaş sönen, ışınlı hale
    '  float ang = atan(p.y, p.x);',
    '  float str = 0.55 + 0.9*n3(vec3(cos(ang)*3.0, sin(ang)*3.0, uTime*0.08));',
    '  float ro = max(r - 1.0, 0.0), rimw = smoothstep(0.975, 1.0, r);',
    '  C += uAtm * uAtmK * (exp(-ro*3.2)*0.55*str + exp(-ro*11.0)*0.6) * quad * rimw;',
    '#else',
    '  float side = 0.3 + 0.7*max(dot(normalize(p + vec2(1e-5)), normalize(L.xy)), 0.0);',
    '  C += uAtm * uAtmK * exp(-max(r - 1.0, 0.0)*15.0) * side * 0.85 * quad * smoothstep(0.975, 1.0, r);',
    '#endif',
    '  gl_FragColor = vec4(C, A) * uFade;',
    '}'
  ].join('\n');

  // ---- Tema motoru: gökyüzü, sis, ışık ve malzeme renkleri iki tema arasında yumuşakça karışır ----
  var COLOR_KEYS = ['sky0', 'sky1', 'sky2', 'fog', 'hemiSky', 'hemiGround', 'key', 'rim', 'win', 'tower', 'edge', 'edgeGlow', 'base', 'road', 'lamp', 'haze', 'cityNear'];
  // v2.5: Kule kontrastı (Güneş'teki gibi): gövde koyulaşır, kenar kendi tonunda açılır ve kendi ışığını yayar.
  // Kontrast oranı = (L_açık + 0.05) / (L_koyu + 0.05)  (WCAG göreli parlaklık). Hedef: en az 4.5.
  function hexRgb(h) { h = String(h).replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; }); }
  function rgbHex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16)).slice(-2); }).join(''); }
  function relLum(c) { var l = c.map(function (v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; }
  function contrast(a, b) { var x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function rgbHsl(c) { var r = c[0], g = c[1], b = c[2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
  function hslRgb(h, s, l) { function f(n) { var k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); } return [f(0), f(8), f(4)]; }
  KK.__towerContrast = [];
  function towerContrast(T) {
    var tw = hexRgb(T.tower), ed = hexRgb(T.edge), before = contrast(tw, ed);
    var tw2 = tw.map(function (v) { return v * 0.65; });
    var hsl = rgbHsl(ed), s2 = Math.max(hsl[1], 0.55), l2 = hsl[2], ed2 = hslRgb(hsl[0], s2, l2);
    while (contrast(ed2, tw2) < 4.5 && l2 < 0.78) { l2 += 0.02; ed2 = hslRgb(hsl[0], s2, l2); }
    T.tower = rgbHex(tw2); T.edge = rgbHex(ed2);
    if (!T.edgeGlow) T.edgeGlow = rgbHex(ed2.map(function (v) { return v * 0.45; }));
    KK.__towerContrast.push({ name: T.name, before: +before.toFixed(2), after: +contrast(ed2, tw2).toFixed(2), tower: T.tower, edge: T.edge });
  }
  function themeColors(T) {
    return {
      sky0: color(T.sky[0]), sky1: color(T.sky[1]), sky2: color(T.sky[2]), fog: color(T.fog),
      hemiSky: color(T.hemi[0]), hemiGround: color(T.hemi[1]), key: color(T.key[0]), rim: color(T.rim),
      win: color(T.win), tower: color(T.tower), edge: color(T.edge), edgeGlow: color(T.edgeGlow || '#000000'),
      base: color(T.base), road: color(T.road), lamp: color(T.lamp), haze: color(T.haze), cityNear: color(T.city[1]),
      hemiI: T.hemi[2], keyI: T.key[1], stars: T.stars, fogNear: T.fogNear || 26, fogFar: T.fogFar || 70
    };
  }
  function cloneTheme(c) {
    var o = {}; for (var k in c) o[k] = c[k] && c[k].isColor ? c[k].clone() : c[k]; return o;
  }
  var themeFrom = null, themeTo = null, themeT = 1, curTheme = null;
  var hemi = null, rimLight = null, baseMat = null, roadMat = null, hazeMats = [], stars = null, skyCv = null, skyTexture = null;
  var anchor = null, anchorBH = null;                       // gök cisminin merkezi (v2.6: sağ üst); TON 618 kendi yerinde
  var BODY_SCALE = 1.25;                                    // v2.6: gök cisimleri %25 büyük (TON 618 hariç)
  function paintSky(c0, c1, c2) {
    var g = skyCv.getContext('2d'), h = skyCv.height;
    var gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#' + c0.getHexString()); gr.addColorStop(0.55, '#' + c1.getHexString()); gr.addColorStop(1, '#' + c2.getHexString());
    g.fillStyle = gr; g.fillRect(0, 0, skyCv.width, h);
    skyTexture.needsUpdate = true;
  }
  function applyTheme(e) {
    var A = themeFrom, B = themeTo, c = curTheme;
    for (var i = 0; i < COLOR_KEYS.length; i++) { var k = COLOR_KEYS[i]; c[k].copy(A[k]).lerp(B[k], e); }
    ['hemiI', 'keyI', 'stars', 'fogNear', 'fogFar'].forEach(function (k) { c[k] = A[k] + (B[k] - A[k]) * e; });
    paintSky(c.sky0, c.sky1, c.sky2);
    scene.fog.color.copy(c.fog); scene.fog.near = c.fogNear; scene.fog.far = c.fogFar;
    hemi.color.copy(c.hemiSky); hemi.groundColor.copy(c.hemiGround); hemi.intensity = c.hemiI;
    key.color.copy(c.key); key.intensity = c.keyI; rimLight.color.copy(c.rim);
    shared.towerMat.color.copy(c.tower); shared.edgeMat.color.copy(c.edge); shared.capMat.color.copy(c.edge);
    shared.edgeMat.emissive.copy(c.edgeGlow); shared.capMat.emissive.copy(c.edgeGlow);
    shared.winLit.color.copy(c.win); shared.winGlowMat.color.copy(c.win); shared.winDark.color.copy(c.cityNear);
    baseMat.color.copy(c.base); roadMat.color.copy(c.road);
    if (plazaMat) plazaMat.color.copy(c.road).multiplyScalar(1.15);
    shared.lampLit.color.copy(c.lamp); shared.glowMat.color.copy(c.lamp);
    hazeMats.forEach(function (m) { m.color.copy(c.haze); });
    stars.material.opacity = c.stars * 0.9; stars.visible = c.stars > 0.01;
  }

  // ---- Gök cisimleri ----
  var planets = [], planetIdx = 0, glowCol = null, banner = null, bannerT = 0;
  function buildPlanets(bhMesh) {
    var blend = { transparent: true, depthWrite: false, fog: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };
    BODIES.forEach(function (def, i) {
      var mesh, mat;
      if (def.kind === 'bh') {
        mesh = bhMesh; mat = bhMat;
        mesh.scale.setScalar(def.R / 7.5);                   // gölge yarıçapı ≈ 7.5 → diğerleriyle aynı boy
      } else {
        var deepK = def.kind >= 11, hx = deepK ? (def.span || PL_DEEP) : PL_HX, hy = deepK ? (def.span || PL_DEEP) : PL_HY;   // v2.5 (v2.6: span = özel boy)
        mat = new THREE.ShaderMaterial(Object.assign({
          uniforms: { uTime: { value: 0 }, uFade: { value: 0 }, uSpin: { value: def.spin }, uTilt: { value: def.tilt },
                      uIncl: { value: def.incl }, uAtmK: { value: def.atmK }, uAtm: { value: color(def.atm) } },
          defines: { KIND: def.kind, RING: (def.kind === 4 || def.kind === 5) ? 1 : 0, HX: hx.toFixed(2), HY: hy.toFixed(2) },
          vertexShader: BH_VERT, fragmentShader: PL_FRAG
        }, blend));
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * hx * def.R, 2 * hy * def.R), mat);
        scene.add(mesh);
      }
      mesh.position.copy(def.kind === 'bh' ? anchorBH : anchor); mesh.position.x += def.dx || 0;
      if (def.kind !== 'bh') mesh.scale.setScalar(BODY_SCALE);
      // v2.6: derin uzay cisimlerinin görsel merkezi (vc, yarıçap biriminde) dörtgenin ortasında değil → vc tam çapaya (sağ üst) otursun
      // oyun sırasında kamera biraz kayar: görsel merkez ölçümde ~(+0.25R, −0.3R) kadar sağ-aşağıda kaldı → o kadar düzeltilir
      if (def.vc) { mesh.position.x -= (def.vc[0] + 0.25) * def.R * BODY_SCALE; mesh.position.y -= (def.vc[1] - 0.3) * def.R * BODY_SCALE; }
      var vis = i === 0 ? 1 : 0;
      mat.uniforms.uFade.value = vis;
      mesh.visible = vis > 0;
      planets.push({ def: def, mesh: mesh, mat: mat, vis: vis, baseS: mesh.scale.x, bx: mesh.position.x });
    });
    glowCol = color(BODIES[0].glow);
    BODIES.forEach(function (T) { towerContrast(T); T.c = themeColors(T); });
    themeFrom = BODIES[0].c; themeTo = BODIES[0].c; curTheme = cloneTheme(BODIES[0].c);
  }

  // ---- Şehirler: her gök cisminin kendi şehri (ilk ihtiyaçta kurulur, sonra saklanır) ----
  var cities = [], activeCities = [];
  function getCity(i) {
    if (cities[i]) return cities[i];
    var T = BODIES[i], seed = 101 + i * 37;
    var c = { idx: i, t: 0, dir: 0, layers: [
      buildCity(-40, 4, 11, T.city[0], 16, 80, 0.35, T, seed, 0.12),
      buildCity(-20, 2, 6, T.city[1], 12, 56, 1, T, seed + 1, 0.42),
      buildCity(-11, 0.7, 2.2, T.city[2], 18, 48, 1, T, seed + 2, 0.7)
    ] };
    c.layers.forEach(function (L) { L.visible = false; });
    return (cities[i] = c);
  }
  var CITY_DROP = 16, CITY_OUT = 0.9, CITY_IN = 1.3, CITY_IN_DELAY = 0.45, LAYER_LAG = [0.24, 0.12, 0];
  function switchCity(from, to) {
    var a = getCity(from), b = getCity(to);
    if (a !== b) { a.dir = -1; a.t = 0; if (activeCities.indexOf(a) < 0) activeCities.push(a); }
    b.dir = 1; b.t = 0; if (activeCities.indexOf(b) < 0) activeCities.push(b);
  }
  function updateCities(state, dt) {
    for (var i = activeCities.length - 1; i >= 0; i--) {
      var c = activeCities[i];
      c.t += dt;
      var done = true;
      for (var l = 0; l < 3; l++) {
        var L = c.layers[l], y;
        if (c.dir > 0) {                                      // yükselen şehir
          var u = Math.min(1, Math.max(0, (c.t - CITY_IN_DELAY - LAYER_LAG[l]) / CITY_IN));
          y = -CITY_DROP * Math.pow(1 - u, 3); if (u < 1) done = false;
        } else if (c.dir < 0) {                               // batan şehir
          var v = Math.min(1, Math.max(0, (c.t - LAYER_LAG[2 - l] * 0.5) / CITY_OUT));
          y = -CITY_DROP * v * v; if (v < 1) done = false;
        } else y = 0;
        L.position.y = y;
        L.visible = !(c.dir < 0 && done);
        L.position.x = -(((state.scrollX * L.userData.par) / S) % L.userData.span);
      }
      if (done && c.dir < 0) { c.layers.forEach(function (L2) { L2.visible = false; }); activeCities.splice(i, 1); }
      else if (done && c.dir > 0) c.dir = 0;
    }
  }

  var warpT = 0;
  function updatePlanets(state, dt) {
    var want = Math.min(BODIES.length - 1, Math.floor((state.score || 0) / PLANET_EVERY));   // v2.2: ana ekranda checkpoint'in gök cismi
    if (want !== planetIdx) {
      if (state.mode === 'playing' && want > planetIdx) {
        var cpTxt = '';   // v2.5: checkpoint artık ayrı bir rozetle gösteriliyor
        banner.firstChild.textContent = cpTxt + want * PLANET_EVERY; banner.lastChild.textContent = BODIES[want].name; bannerT = 2.6;
      }
      switchCity(planetIdx, want);
      if (state.mode === 'playing' && want > planetIdx) { warpT = 1; shakeT = Math.max(shakeT, reduced ? 0 : 0.35); }   // v2.1: yeni gök cismi = warp
      themeFrom = cloneTheme(curTheme); themeTo = BODIES[want].c; themeT = 0;
      planetIdx = want;
    }
    if (themeT < 1) {
      themeT = Math.min(1, themeT + dt / 2.4);
      applyTheme(themeT * themeT * (3 - 2 * themeT));
    }
    for (var i = 0; i < planets.length; i++) {
      var pl = planets[i], tgt = i === planetIdx ? 1 : 0;
      pl.vis += (tgt - pl.vis) * Math.min(1, dt * 1.3);
      if (Math.abs(pl.vis - tgt) < 0.002) pl.vis = tgt;
      pl.mesh.visible = pl.vis > 0;
      if (!pl.mesh.visible) continue;
      var e = pl.vis * pl.vis * (3 - 2 * pl.vis);
      pl.mat.uniforms.uFade.value = e;
      pl.mat.uniforms.uTime.value = state.t;
      // Gelen sağdan kayarak girer, giden sağa kayıp çıkar (v2.6: sağ üst)
      pl.mesh.position.x = pl.bx + (1 - e) * pl.def.R * 2.4;
      pl.mesh.scale.setScalar(pl.baseS * (0.92 + 0.08 * e));
    }
    tmpC.set(BODIES[planetIdx].glow);
    glowCol.lerp(tmpC, Math.min(1, dt * 1.1));
    sunGlow.material.color.copy(glowCol);
    if (bannerT > 0) {
      bannerT -= dt;
      var o = Math.min(1, bannerT / 0.8, (2.6 - bannerT) / 0.25);
      banner.style.opacity = Math.max(0, o).toFixed(3);
      banner.style.transform = 'translateY(' + ((1 - Math.min(1, (2.6 - bannerT) / 0.4)) * 10).toFixed(1) + 'px)';
    } else banner.style.opacity = 0;
  }

  // ---- v1.5: can (çarpma hakkı) ve hız katsayısı göstergesi ----
  var livesEl = null, lastLives = -1, livesWrap = null, livesPulse = 0;
  var shieldEl = null, cpEl = null, shieldPop = null, cpToast = null, popT = 0, cpT = 0, lastCP = -1, cpScore = 0;
  function SHIELD_SVG(px) { return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" aria-hidden="true"><path d="M12 2 L20 5 V11 C20 16.5 16.5 20.5 12 22 C7.5 20.5 4 16.5 4 11 V5 Z" fill="currentColor"/><path d="M12 5.2 L17.4 7.2 V11 C17.4 14.8 15.1 17.7 12 18.9 Z" fill="#ffffff" opacity=".35"/></svg>'; }
  var FLAG_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5 21 V3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M6 4 H18 L15.5 8 L18 12 H6 Z" fill="#6fe3a0"/></svg>';
  var PLANE_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M2 12 L22 4 L15 21 L11 14 Z" fill="currentColor"/><path d="M11 14 L22 4" stroke="#1b1838" stroke-width="1.4"/></svg>';
  function initStatus(hud) {
    livesWrap = document.createElement('div');
    // v3.0: alt sol köşe — duraklat/ses düğmeleriyle aynı hizada (düğme 44 px, altta 14 px → merkez 36 px; bu satır ~22 px → alt 25 px)
    livesWrap.style.cssText = 'position:absolute;bottom:calc(max(14px,env(safe-area-inset-bottom,0px)) + 11px);left:max(14px,env(safe-area-inset-left,0px));pointer-events:none;display:none;align-items:center;gap:10px;font:700 13px/1 var(--font-body);color:var(--paper);text-shadow:0 2px 0 #1b1838';
    livesEl = document.createElement('div'); livesEl.style.cssText = 'display:flex;gap:4px;color:var(--paper)';
    // v2.5: hız/alev yazısı kaldırıldı. Sırada: canlar · kalkan (hazırsa) · son checkpoint bayrağı
    shieldEl = document.createElement('div'); shieldEl.innerHTML = SHIELD_SVG(22); shieldEl.style.cssText = 'display:none;color:#8fd8ff;filter:drop-shadow(0 0 6px rgba(143,216,255,.8))';
    cpEl = document.createElement('div'); cpEl.style.cssText = 'display:none;align-items:center;gap:3px;opacity:.8;font-variant-numeric:tabular-nums;color:var(--paper)';
    livesWrap.appendChild(livesEl); livesWrap.appendChild(shieldEl); livesWrap.appendChild(cpEl);
    // Kalkan dolunca ekranın üstünde kısa beliren simge
    shieldPop = document.createElement('div');
    shieldPop.style.cssText = 'position:absolute;left:0;right:0;bottom:calc(max(14px,env(safe-area-inset-bottom,0px)) + clamp(64px,16vmin,96px));display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none;opacity:0;color:#8fd8ff';
    shieldPop.innerHTML = SHIELD_SVG(34) + '<div style="font:800 11px/1 var(--font-body);letter-spacing:.32em;color:#d8f2ff;text-shadow:0 2px 0 #1b1838">SHIELD READY</div>';
    hud.appendChild(shieldPop);
    // Checkpoint alınınca gök cismi adının altında belirgin bir rozet
    cpToast = document.createElement('div');
    cpToast.style.cssText = 'position:absolute;left:50%;top:calc(24% + clamp(66px,17vmin,96px));transform:translateX(-50%);pointer-events:none;opacity:0;white-space:nowrap;padding:7px 14px;border-radius:999px;background:rgba(18,40,30,.78);border:1.5px solid #6fe3a0;color:#bff5d4;font:800 12px/1 var(--font-body);letter-spacing:.22em';
    hud.appendChild(cpToast);
    hud.appendChild(livesWrap);
    banner = document.createElement('div');
    banner.style.cssText = 'position:absolute;left:0;right:0;top:24%;text-align:center;pointer-events:none;opacity:0;color:var(--paper)';
    banner.innerHTML = '<div style="font:800 13px/1 var(--font-body);letter-spacing:.3em;color:var(--glow);margin-bottom:6px"></div><div style="font-family:var(--font-display);font-size:clamp(24px,8vmin,42px);letter-spacing:.06em;text-shadow:0 3px 0 #1b1838,0 0 22px rgba(160,190,255,.55)"></div>';
    hud.appendChild(banner);
  }
  // v3.0: stil yazımı önbellekli — aynı değer tekrar yazılmaz (her karede ~9 DOM yazımı → sadece değişenler)
  function sst(el, k, v) { var c = el._st || (el._st = {}); if (c[k] !== v) { el.style[k] = v; c[k] = v; } }
  function updateStatus(state, rdt) {
    // kısa beliren simgeler (oyun durmuşken de sönsün diye gerçek zamanla)
    if (popT > 0) {
      popT = Math.max(0, popT - rdt);
      var pu = 1.6 - popT;                                       // 0 → 1.6 sn
      var po = Math.min(1, pu / 0.18, popT / 0.45);
      sst(shieldPop, 'opacity', po.toFixed(3));
      sst(shieldPop, 'transform', 'scale(' + (pu < 0.25 ? 0.6 + 0.4 * (1 - Math.pow(1 - pu / 0.25, 3)) * 1.08 : 1).toFixed(3) + ')');
    } else sst(shieldPop, 'opacity', '0');
    if (cpT > 0) { cpT = Math.max(0, cpT - rdt); sst(cpToast, 'opacity', Math.min(1, (2.8 - cpT) / 0.25, cpT / 0.6).toFixed(3)); }
    else sst(cpToast, 'opacity', '0');
    var on = state.mode === 'playing';
    sst(livesWrap, 'display', on ? 'flex' : 'none');
    if (!on) { lastLives = -1; lastCP = -1; return; }
    sst(shieldEl, 'display', state.shield ? '' : 'none');
    var cp = Math.max(state.startScore || 0, cpScore);
    if (cp !== lastCP) { cpEl.innerHTML = FLAG_SVG + '<span>' + cp + '</span>'; cpEl.style.display = cp > 0 ? 'flex' : 'none'; lastCP = cp; }
    var max = (KK.Game.config && KK.Game.config.LIVES) || 2;
    if (state.hitsLeft !== lastLives) {
      var html = '';
      for (var i = 0; i < max; i++) html += '<span style="display:inline-block;transition:opacity .3s,transform .3s;' + (i < state.hitsLeft ? '' : 'opacity:.22;transform:scale(.8)') + '">' + PLANE_SVG + '</span>';
      livesEl.innerHTML = html; lastLives = state.hitsLeft;
    }
    livesPulse = Math.max(0, livesPulse - 0.02);
    sst(livesEl, 'transform', livesPulse > 0 ? 'scale(' + (1 + livesPulse * 0.4).toFixed(3) + ')' : '');
    sst(livesEl, 'filter', livesPulse > 0 ? 'drop-shadow(0 0 ' + Math.round(livesPulse * 10) + 'px #ffcf6b)' : '');
  }

  // Aydınlık pencere: içeriden yanan cam, ortada kayıt (pencere kasası)
  function windowTexture() {
    return canvasTex(32, 48, function (g, w, h) {
      var gr = g.createRadialGradient(w / 2, h * 0.6, 2, w / 2, h * 0.6, h * 0.7);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#e6e6e6'); gr.addColorStop(1, '#8a8a8a');   // v1.6: nötr; renk temadan
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2e2852';                 // kasa ve kayıtlar
      g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3); g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
      g.fillRect(w / 2 - 1.5, 0, 3, h); g.fillRect(0, h * 0.45, w, 3);
    });
  }

  // ---- v2.0: Uçak skinleri ----
  // req = kilidi açan EN İYİ skor (yolculuktaki duraklara denk gelir). 'fyst' gizli: sadece kodla açılır.
  // paper/shade: kanat ve omurga rengi, line: kontur, glow: kendi ışığı, head/tail: iz renkleri, spark: kıvılcım
  KK.SKINS = [
    { id: 'paper',    name: 'PAPER',    req: 0,    paper: '#fbf7ef', shade: '#d9d0c0', line: '#0b0918', glow: 0.35, head: '#ffe2a6', tail: '#9b7bff', spark: '#ffe6b0', trail: 'ribbon' },
    { id: 'midnight', name: 'MIDNIGHT', req: 50,   paper: '#2a3566', shade: '#18204a', line: '#ffcf6b', glow: 0.25, head: '#9fd0ff', tail: '#3a4bff', spark: '#bfe0ff', trail: 'dash' },
    { id: 'ember',    name: 'EMBER',    req: 100,  paper: '#ff7a45', shade: '#c43a1e', line: '#000000', glow: 0.45, head: '#ffd27a', tail: '#ff3a1a', spark: '#ffb060', trail: 'spark' },
    { id: 'lunar',    name: 'LUNAR',    req: 200,  paper: '#c9d2e0', shade: '#8f9ab0', line: '#0b0918', glow: 0.30, head: '#e6f4ff', tail: '#7fa8ff', spark: '#e6f4ff', trail: 'comet' },
    { id: 'sulfur',   name: 'SULFUR',   req: 400,  paper: '#f3d58a', shade: '#c9963a', line: '#3a2200', glow: 0.40, head: '#fff0b0', tail: '#e0a030', spark: '#ffe8a0', trail: 'smoke' },   // v2.5: Venüs
    { id: 'solar',    name: 'SOLAR',    req: 800,  paper: '#ffd23a', shade: '#ff9a1a', line: '#5a1a00', glow: 0.75, head: '#fffbe0', tail: '#ff7a1a', spark: '#fff2a8', trail: 'comet' },
    { id: 'rust',     name: 'RUST',     req: 1000, paper: '#d2552e', shade: '#8c2a14', line: '#1a0500', glow: 0.35, head: '#ffb08a', tail: '#c0381a', spark: '#ff9a70', trail: 'smoke' },   // v2.5: Mars
    { id: 'storm',    name: 'STORM',    req: 1200, paper: '#e8c6a0', shade: '#b2683a', line: '#2a1406', glow: 0.35, head: '#ffe0c0', tail: '#c86a3a', spark: '#ffd0a0', trail: 'wave' },   // v2.5: Jüpiter
    { id: 'ringed',   name: 'RINGED',   req: 1400, paper: '#e8d6a8', shade: '#b89a60', line: '#2a1a08', glow: 0.35, head: '#fff0c0', tail: '#c0a060', spark: '#ffe8b0', trail: 'dash' },
    { id: 'tide',     name: 'TIDE',     req: 1800, paper: '#3a6cff', shade: '#1a2f9a', line: '#d8ecff', glow: 0.50, head: '#a8d8ff', tail: '#2a4bff', spark: '#c8e4ff', trail: 'wave' },   // v2.5: Neptün
    { id: 'void', extra: ['winglet'],     name: 'VOID',     req: 2200, paper: '#141022', shade: '#07060c', line: '#ffc9a8', glow: 0.10, head: '#ffb070', tail: '#a24bff', spark: '#ff9a6a', trail: 'twin' },
    { id: 'aurora', extra: ['canard', 'winglet'],   name: 'AURORA',   req: 2600, paper: '#7affc8', shade: '#2ab08a', line: '#04201a', glow: 0.60, head: '#d0fff0', tail: '#ff7ad8', spark: '#b0ffe8', trail: 'rainbow' },   // v2.5: Orion
    { id: 'beacon', extra: ['biplane', 'fin'],   name: 'BEACON',   req: 2800, paper: '#ffffff', shade: '#9ad8ff', line: '#00b8e8', glow: 0.80, head: '#ffffff', tail: '#00b8ff', spark: '#c8f6ff', trail: 'pulse' },   // v2.5: Pulsar
    { id: 'horizon', extra: ['canard', 'fin', 'blade'],  name: 'HORIZON',  req: 3200, paper: '#0a0a12', shade: '#000000', line: '#ffb050', glow: 0.15, head: '#ffd090', tail: '#ff6a20', spark: '#ffc070', trail: 'wave' },   // v2.5: TON 618
    // v2.5: yıldız (rebirth) skinleri EPIC: canlı efektler (anim). FYST hepsinin üstünde: holografik gövde + özel iz + yörünge parıltıları
    { id: 'nova', extra: ['canard', 'winglet'],     name: 'NOVA ★',      stars: 1, paper: '#fff4d6', shade: '#ffcf6b', line: '#5a1a00', glow: 0.85, head: '#ffffff', tail: '#ffb030', spark: '#fff2a8', trail: 'spark', anim: 'pulse' },
    { id: 'nebula', extra: ['biplane', 'winglet'],   name: 'NEBULA ★★',  stars: 2, paper: '#c58bff', shade: '#7a3ad0', line: '#0e0520', glow: 0.55, head: '#ff9ae0', tail: '#6a5bff', spark: '#ffc0f0', trail: 'smoke', anim: 'drift' },
    { id: 'quasar', extra: ['canard', 'fin', 'blade'], shape: 'delta',   name: 'QUASAR ★★★', stars: 3, paper: '#9ff6ff', shade: '#3ad0e0', line: '#001a20', glow: 0.75, head: '#ffffff', tail: '#2f8bff', spark: '#bff8ff', trail: 'pulse', anim: 'jet' },
    { id: 'singularity', extra: ['canard', 'winglet', 'fin', 'blade'], name: 'SINGULARITY ★4', stars: 4, shape: 'delta', paper: '#0a0812', shade: '#000000', line: '#b06bff', glow: 0.15, head: '#d6b0ff', tail: '#6a2cff', spark: '#c89cff', halo: '#6a2cff', trail: 'twin', anim: 'void' },
    { id: 'supernova', extra: ['canard', 'winglet', 'fin', 'biplane', 'blade'], name: 'SUPERNOVA ★5', stars: 5, shape: 'delta', paper: '#ffb347', shade: '#ff5a1a', line: '#3a0800', glow: 0.9, head: '#ffffff', tail: '#ff4a10', spark: '#ffd27a', trail: 'comet', anim: 'fire' },
    // v3.0: kodla açılan özel skinler (secret). AGA = Halil'in annesine, CHEERS = arkadaşına (bira şişesi)
    { id: 'aga',      name: 'AGA', secret: true, shape: 'delta', extra: ['canard', 'winglet'], paper: '#3fd58a', shade: '#1c8a52', line: '#062a18', glow: 0.55, head: '#e6ffef', tail: '#2fff8a', spark: '#c8ffd8', halo: '#5affa8', trail: 'ribbon', anim: 'leaf' },
    { id: 'cheers',   name: 'CHEERS', secret: true, shape: 'bottle', paper: '#8a4b12', shade: '#5e2f08', line: '#1a0a02', glow: 0.35, head: '#fff6d8', tail: '#ffb347', spark: '#fffbe8', halo: '#ffcf6b', trail: 'comet', anim: 'roll' },
    { id: 'fyst',     name: 'FYST', secret: true, shape: 'dart', extra: ['canard', 'blade'], paper: '#ffffff', shade: '#e6dcff', line: '#ffffff', glow: 0.6, head: '#ffffff', tail: '#ff9ad5', spark: '#ffffff', halo: '#ffb0e0', trail: 'holo', anim: 'holo' }
  ];
  // Test sayfasında gök cisimleri 4 kat sık geldiği için kilit puanları da 4'e bölünür
  if (KK.TEST_BUILD) KK.SKINS.forEach(function (k) { if (k.req) k.req = Math.round(k.req * PLANET_EVERY / 200); });
  function skinById(id) { for (var i = 0; i < KK.SKINS.length; i++) if (KK.SKINS[i].id === id) return KK.SKINS[i]; return KK.SKINS[0]; }
  var curSkin = null, planeMat = null, outlineMat = null, haloMat = null;

  // ---- Kağıt uçak: üçgenlerden elle kurulmuş geometri ----
  // Klasik: iki kanat + omurga. 'dart' (dev hediyesi): daha uzun burun, geniş ok kanatlar, kuyruk dikmesi.
  function buildPlane(skin) {
    skin = skin || KK.SKINS[0];
    var u = 1 / S, dart = skin.shape === 'dart', delta = skin.shape === 'delta';   // v2.5: delta = geniş üçgen kanat
    var N = dart ? [24, 0, 0] : delta ? [21, 0, 0] : [18, 0, 0], C = delta ? [-9, 1, 0] : [-12, 1, 0];
    var L = dart ? [-15, 3.5, -16] : delta ? [-13, 2, -19] : [-12, 3, -12], R = dart ? [-15, 3.5, 16] : delta ? [-13, 2, 19] : [-12, 3, 12], K = delta ? [-11, -5, 0] : [-12, -6, 0];
    var tris = [[N, C, L], [N, R, C], [N, K, C]];          // sol kanat, sağ kanat, omurga
    var cols = [skin.paper, skin.paper, skin.shade];
    if (dart) {                                             // kuyruk dikmesi + kanat ucu kanatçıkları
      tris.push([[-6, 1, 0], [-13, 1, 0], [-15, 8, 0]]); cols.push(skin.shade);
      tris.push([[-11, 3.2, -13], [-15, 3.5, -16], [-14, 7, -15]]); cols.push(skin.paper);
      tris.push([[-11, 3.2, 13], [-14, 7, 15], [-15, 3.5, 16]]); cols.push(skin.paper);
    }
    // v2.6: zor skinlere ek parçalar — canard (burunda küçük kanat), winglet (kanat ucu dikmesi), fin (kuyruk dikmesi),
    // biplane (altta ikinci kanat çifti), blade (kanat üstünde ince bıçak çizgileri)
    var X2 = skin.extra || [];
    if (skin.shape === 'bottle') {          // v3.0 CHEERS: bira şişesi — profil x ekseni etrafında döndürülür (12 dilim)
      tris = []; cols = [];
      // [x, yarıçap, renk]: dip → gövde (etiket) → omuz → boyun (folyo) → ağız → kapak
      var PR = [[-14, 0, '#5e2f08'], [-14, 5.0, '#8a4b12'], [-10, 5.2, '#8a4b12'], [-3, 5.2, '#f3e6c4'], [0, 5.0, '#8a4b12'], [4, 2.4, '#8a4b12'],
                [7, 1.9, '#d8b04a'], [12, 1.9, '#d8b04a'], [12.6, 2.3, '#c9a227'], [14.5, 2.3, '#e8c84a'], [14.5, 0, '#e8c84a']];
      var SEG = 12;
      for (var j = 0; j < PR.length - 1; j++) for (var q = 0; q < SEG; q++) {
        var a0 = q / SEG * Math.PI * 2, a1 = (q + 1) / SEG * Math.PI * 2, p0 = PR[j], p1 = PR[j + 1];
        var A1 = [p0[0], p0[1] * Math.cos(a0), p0[1] * Math.sin(a0)], B1 = [p1[0], p1[1] * Math.cos(a0), p1[1] * Math.sin(a0)];
        var C1 = [p1[0], p1[1] * Math.cos(a1), p1[1] * Math.sin(a1)], D1 = [p0[0], p0[1] * Math.cos(a1), p0[1] * Math.sin(a1)];
        var cc2 = p1[2];
        tris.push([A1, B1, C1]); cols.push(cc2); tris.push([A1, C1, D1]); cols.push(cc2);
      }
    }
    function mir(t, c) { tris.push(t); cols.push(c); tris.push(t.map(function (v) { return [v[0], v[1], -v[2]]; }).reverse()); cols.push(c); }
    if (X2.indexOf('canard') >= 0) mir([[N[0] - 8, 0.6, 0], [N[0] - 15, 0.8, 0], [N[0] - 16, 1.6, -7]], skin.shade);
    if (X2.indexOf('winglet') >= 0) mir([L, [L[0] + 5, L[1] + 0.4, L[2] * 0.9], [L[0] - 1, L[1] + 7, L[2] * 1.02]], skin.shade);
    if (X2.indexOf('fin') >= 0) { tris.push([[C[0] + 6, 1, 0], [C[0] - 1, 1, 0], [C[0] - 3, 9, 0]]); cols.push(skin.shade); }
    if (X2.indexOf('biplane') >= 0) mir([[N[0] - 9, -2.6, 0], [C[0] + 3, -2.2, 0], [L[0] + 3, -2.8, L[2] * 0.62]], skin.paper);
    if (X2.indexOf('blade') >= 0) mir([[C[0] + 2, 1.2, L[2] * 0.35], [C[0] - 7, 1.4, L[2] * 0.55], [C[0] - 3, 1.3, L[2] * 0.75]], skin.line);
    var pos = [], col = [];
    tris.forEach(function (t, i) {
      var cc = color(cols[i]);
      t.forEach(function (v) { pos.push(v[0] * u, v[1] * u, v[2] * u); col.push(cc.r, cc.g, cc.b); });
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    planeMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: color(skin.paper), emissiveIntensity: skin.glow });
    var mesh = new THREE.Mesh(geo, planeMat);
    mesh.castShadow = true;
    mesh.renderOrder = 2;
    // Çizgi film (cel/anime) konturu: aynı şeklin biraz büyük kopyası.
    // Derinliğe yazmadığı için kağıt her zaman onun üstüne çizilir, sadece kenarlarda taşar.
    outlineMat = new THREE.MeshBasicMaterial({ color: color(skin.line), side: THREE.DoubleSide, depthWrite: false });
    var outline = new THREE.Mesh(geo, outlineMat);
    outline.renderOrder = 1;
    var g = new THREE.Group();
    var inner = new THREE.Group();            // ölçek ve merkez ayarı için iç grup
    inner.add(outline); inner.add(mesh);
    g.add(inner); g.userData.inner = inner;
    mesh.scale.setScalar(1.35);               // 3D'de uzaklıktan küçük görünmesin (çarpışma kutusu aynı)
    var cx = -2 / S * 1.35;                   // konturu uçağın kendi merkezi etrafında büyüt
    outline.scale.setScalar(1.35 * 1.32);      // v2.1: daha kalın kontur (1.2 → 1.32)
    outline.position.x = cx - cx * 1.32;
    // v2.1: uçağın arkasında skin renginde yumuşak hale → her gökyüzünde arka plandan ayrılır
    haloMat = new THREE.SpriteMaterial({ map: shared.glowMat.map, color: color(skin.halo || skin.head), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    var halo = new THREE.Sprite(haloMat); halo.scale.set(2.1, 1.5, 1); halo.position.set(-0.1, 0, -0.3); halo.renderOrder = 0;
    g.add(halo); g.userData.halo = halo;
    if (skin.anim === 'holo') {                // v2.5: FYST — uçağın etrafında dönen iki parıltı (pembe + mavi)
      g.userData.glints = ['#ffffff', '#ff8cc8', '#8cc8ff', '#e3b8f2'].map(function (c) {   // v3.0: 4 parıltı, FYST logosunun renkleri
        var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: shared.glowMat.map, color: color(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        sp.scale.setScalar(0.32); sp.renderOrder = 3; g.add(sp); return sp;
      });
    }
    return g;
  }
  function applySkin(id) {
    var skin = skinById(id);
    if (curSkin === skin) return;
    curSkin = skin;
    var pos = planeGroup ? planeGroup.position.clone() : null, rot = planeGroup ? planeGroup.rotation.clone() : null;
    if (planeGroup) scene.remove(planeGroup);
    planeGroup = buildPlane(skin);
    if (pos) { planeGroup.position.copy(pos); planeGroup.rotation.copy(rot); }
    scene.add(planeGroup);
    headCol.set(skin.head); tailCol.set(skin.tail); shared.sparkMat.color.set(skin.spark);
    var wx = skin.shape === 'dart' ? -15 : skin.shape === 'delta' ? -13 : skin.shape === 'bottle' ? -14 : -12, wz = skin.shape === 'dart' ? 16 : skin.shape === 'delta' ? 19 : skin.shape === 'bottle' ? 3.5 : 12, k2 = 1.35 / S;  // iz kanat uçlarından çıksın (şişede dipten)
    trailDefs[0].local.set(wx * k2, 3 * k2, -wz * k2); trailDefs[1].local.set(wx * k2, 3 * k2, wz * k2);
  }
  // Dev hediyesi: yanardöner (holografik) kağıt — renk tonu zamanla döner, kontur ve iz zıt tonda
  var devHsl = new THREE.Color();
  // v2.5: canlı skinler. beat = müzik nabzı (0..1)
  var skA = new THREE.Color(), skB = new THREE.Color(), skW = new THREE.Color('#ffffff');
  function animateSkin(t) {
    if (!curSkin || !curSkin.anim || !planeMat) return;
    var a = curSkin.anim, beat = KK.musicPulse ? KK.musicPulse() : 0, halo = planeGroup.userData.halo;
    if (a === 'holo') {                        // FYST: sedef pembe ↔ buz mavisi, beyaz parıltı, yörüngede iki yıldız
      var w = 0.5 + 0.5 * Math.sin(t * 1.6), w2 = 0.5 + 0.5 * Math.sin(t * 2.3 + 1.0);
      skA.set('#ffc6e6').lerp(skB.set('#bfe0ff'), w);
      planeMat.color.copy(skA).lerp(skW, 0.35 * w2); planeMat.emissive.copy(skA); planeMat.emissiveIntensity = 0.55 + 0.25 * w2 + 0.45 * beat;
      outlineMat.color.copy(skW).lerp(skB.set('#ff8fd0'), 0.5 + 0.5 * Math.sin(t * 3.0));
      haloMat.color.copy(skA); haloMat.opacity = 0.6 + 0.2 * w2 + 0.2 * beat;
      if (halo) halo.scale.set(2.5 + 0.3 * beat, 1.8 + 0.2 * beat, 1);
      headCol.copy(skW); tailCol.copy(skA);
      shared.sparkMat.color.set(Math.sin(t * 9) > 0 ? '#ff9ad5' : '#9fd6ff');
      // v3.0: 4 parıltı iki eğik yörüngede, ters yönlerde (çift = saat yönü, tek = ters, 90° arayla)
      (planeGroup.userData.glints || []).forEach(function (g, i) {
        var dirn = i % 2 ? -1 : 1, ang = dirn * t * 3.0 + i * Math.PI / 2, tilt = i % 2 ? -0.5 : 0.5;
        g.position.set(-0.15 + Math.cos(ang) * 0.9, Math.sin(ang) * 0.4 * Math.cos(tilt) + 0.12 * dirn * Math.sin(ang * 2), Math.sin(ang) * 0.4 * Math.sin(tilt) + 0.15);
        g.material.opacity = 0.7 + 0.3 * Math.sin(t * 7 + i * 1.7) + 0.3 * beat;
        g.scale.setScalar(0.3 + 0.08 * Math.sin(t * 5 + i) + 0.12 * beat);
      });
    } else if (a === 'pulse') {                // NOVA: patlayan yıldız gibi nabız
      var pp = Math.pow(Math.abs(Math.sin(t * 2.6)), 3);
      planeMat.emissiveIntensity = curSkin.glow * (0.7 + 0.7 * pp) + 0.3 * beat;
      haloMat.opacity = 0.45 + 0.4 * pp; if (halo) halo.scale.set(2.1 + 0.6 * pp, 1.5 + 0.4 * pp, 1);
    } else if (a === 'drift') {                // NEBULA: pembe → mor → camgöbeği akışı
      var hh = 0.83 + 0.17 * Math.sin(t * 0.7);   // 0.66 (mor-mavi) .. 1.0 (pembe)
      planeMat.color.setHSL(hh % 1, 0.75, 0.78); planeMat.emissive.setHSL(hh % 1, 0.8, 0.45);
      haloMat.color.setHSL((hh + 0.1) % 1, 1, 0.65); tailCol.setHSL((hh + 0.85) % 1, 1, 0.6);
    } else if (a === 'jet') {                  // QUASAR: müzikle çakar
      planeMat.emissiveIntensity = curSkin.glow * (0.7 + 1.6 * beat);
      haloMat.opacity = 0.45 + 0.5 * beat; if (halo) halo.scale.set(2.1 + 0.9 * beat, 1.5 + 0.5 * beat, 1);
    } else if (a === 'void') {                 // SINGULARITY: mor olay ufku konturu nabız atar
      var vv = 0.5 + 0.5 * Math.sin(t * 2.0);
      outlineMat.color.set('#6a2cff').lerp(skB.set('#ff5ad8'), vv * 0.6 + 0.4 * beat);
      haloMat.opacity = 0.35 + 0.3 * vv;
    } else if (a === 'leaf') {                 // v3.0 AGA: zümrüt yeşili, yaprak gibi yumuşak nefes + altın parıltı
      var lf = 0.5 + 0.5 * Math.sin(t * 1.8);
      planeMat.emissive.set('#1fbf6a').lerp(skB.set('#d8f06a'), 0.35 * lf); planeMat.emissiveIntensity = 0.45 + 0.3 * lf + 0.35 * beat;
      haloMat.color.set('#5affa8').lerp(skB.set('#ffe9a0'), 0.4 * lf); haloMat.opacity = 0.5 + 0.2 * lf + 0.2 * beat;
    } else if (a === 'roll') {                 // v3.0 CHEERS: şişe kendi ekseninde döner, köpük gibi parlar
      if (planeGroup.userData.inner) planeGroup.userData.inner.rotation.x = t * 2.4;
      planeMat.emissiveIntensity = 0.3 + 0.35 * beat;
      shared.sparkMat.color.set(Math.sin(t * 11) > 0 ? '#fffbe8' : '#ffd27a');
    } else if (a === 'fire') {                 // SUPERNOVA: turuncu → beyaz ateş
      var ff = 0.5 + 0.5 * Math.sin(t * 5.0);
      planeMat.color.set('#ffb347').lerp(skW, 0.55 * ff); planeMat.emissive.set('#ff6a1a').lerp(skB.set('#ffe0a0'), ff);
      planeMat.emissiveIntensity = 0.8 + 0.4 * ff + 0.3 * beat;
      shared.sparkMat.color.set(ff > 0.5 ? '#fff2c0' : '#ff8a30');
    }
  }

  // ---- Paralaks şehir (v1.6: temaya göre biçim) — iki kopya yan yana döşenir ----
  // par = paralaks oranı (uzak katman yavaş kayar). Şekil ağırlıkları temadan gelir.
  function pickShape(rnd, w) {
    var tot = 0, k;
    for (k in w) tot += w[k];
    var r = rnd() * tot;
    for (k in w) { r -= w[k]; if (r <= 0) return k; }
    return 'box';
  }
  function buildCity(z, minH, maxH, colorHex, count, span, winOpacity, T, seed, par) {
    var group = new THREE.Group();
    var mat = new THREE.MeshLambertMaterial({ color: color(colorHex) });
    var winMat = new THREE.MeshBasicMaterial({ color: color(T.win), transparent: true, opacity: 0.6 * (winOpacity || 1), fog: true });
    var beaconMat = new THREE.MeshBasicMaterial({ color: color(T.lamp), fog: true });
    var winGeo = shared.cityWin;
    var rnd = mulberry(seed);
    function windows(bx, w, top, fz, n) {                    // ön yüzde birkaç ışıklı pencere
      for (var k = 0; k < n; k++) {
        if (rnd() < 0.45) continue;
        var wm = new THREE.Mesh(winGeo, winMat);
        wm.position.set(bx - w / 2 + 0.3 + rnd() * Math.max(0.05, w - 0.6), GROUND + 0.35 + rnd() * Math.max(0.1, top - 0.7), fz + 0.01);
        group.add(wm);
      }
    }
    for (var copy = 0; copy < 2; copy++) {
      rnd = mulberry(seed);   // v2.5: ikinci kopya ilkinin AYNISI olmalı; yoksa katman başa sarınca evler bir anda değişir
      for (var i = 0; i < count; i++) {
        var shape = pickShape(rnd, T.shapes);
        var w = 1.2 + rnd() * 2.2, h = minH + rnd() * (maxH - minH), d = 1.5 + rnd() * 2;
        var bx = -span / 2 + (i + 0.5) * (span / count) + copy * span;
        var bz = z - rnd() * 2, m;
        if (shape === 'dome') {                              // kubbe: yarım küre + taban halkası + kapı ışığı
          var rr = Math.min(w * 0.8, 1.2 + h * 0.35);
          m = new THREE.Mesh(shared.dome, mat);
          m.scale.set(rr, rr * (0.75 + rnd() * 0.4), rr); m.position.set(bx, GROUND, bz);
          group.add(m);
          var ring = new THREE.Mesh(shared.cyl, mat);
          ring.scale.set(rr * 1.06, 0.25, rr * 1.06); ring.position.set(bx, GROUND + 0.1, bz);
          group.add(ring);
          var door = new THREE.Mesh(winGeo, winMat);
          door.scale.set(1.4, 0.8, 1); door.position.set(bx, GROUND + 0.28, bz + rr * 1.06 + 0.01);
          group.add(door);
        } else if (shape === 'cyl') {                        // silindir kule + üstte ince taç
          var cr = w * 0.42;
          m = new THREE.Mesh(shared.cyl, mat);
          m.scale.set(cr, h + 4, cr); m.position.set(bx, GROUND + h / 2 - 2, bz);
          group.add(m);
          var crown = new THREE.Mesh(shared.cyl, mat);
          crown.scale.set(cr * 1.25, 0.25, cr * 1.25); crown.position.set(bx, GROUND + h + 0.1, bz);
          group.add(crown);
          windows(bx, cr * 1.3, h, bz + cr, Math.round(2 + h * 1.2));
        } else if (shape === 'spire') {                      // sivri kule: kısa gövde + uzun koni (kristal gibi)
          var base = new THREE.Mesh(shared.box, mat);
          base.scale.set(w * 0.6, h * 0.35 + 4, d * 0.6); base.position.set(bx, GROUND + h * 0.175 - 2, bz);
          group.add(base);
          m = new THREE.Mesh(shared.cone, mat);
          m.scale.set(w * 0.42, h * 0.9, w * 0.42); m.position.set(bx, GROUND + h * 0.35 + h * 0.45, bz);
          group.add(m);
          windows(bx, w * 0.6, h * 0.35, bz + d * 0.3, Math.round(1 + h * 0.5));
        } else if (shape === 'bunker') {                     // alçak, geniş sığınak; üstünde ısı kalkanı
          m = new THREE.Mesh(shared.box, mat);
          m.scale.set(w * 1.6, h * 0.35 + 4, d); m.position.set(bx, GROUND + h * 0.175 - 2, bz);
          group.add(m);
          var shield = new THREE.Mesh(shared.box, mat);
          shield.scale.set(w * 1.8, 0.12, d * 1.1); shield.position.set(bx, GROUND + h * 0.35 + 0.25, bz);
          group.add(shield);
          windows(bx, w * 1.6, h * 0.35, bz + d / 2, Math.round(2 + h * 0.6));
        } else if (shape === 'antenna') {                    // bina + direk + yanıp sönmeyen işaret lambası
          m = new THREE.Mesh(shared.box, mat);
          m.scale.set(w * 0.8, h * 0.55 + 4, d); m.position.set(bx, GROUND + h * 0.275 - 2, bz);
          group.add(m);
          var mast = new THREE.Mesh(shared.box, mat);
          mast.scale.set(0.08, h * 0.8, 0.08); mast.position.set(bx, GROUND + h * 0.55 + h * 0.4, bz);
          group.add(mast);
          var dish = new THREE.Mesh(shared.dome, mat);
          dish.scale.set(0.45, 0.2, 0.45); dish.rotation.x = Math.PI * 0.6; dish.position.set(bx + w * 0.25, GROUND + h * 0.55 + 0.35, bz);
          group.add(dish);
          var bea = new THREE.Mesh(shared.box, beaconMat);
          bea.scale.setScalar(0.14); bea.position.set(bx, GROUND + h * 0.55 + h * 0.8, bz);
          group.add(bea);
          windows(bx, w * 0.8, h * 0.55, bz + d / 2, Math.round(2 + h * 0.7));
        } else {                                             // klasik kutu bina, ara sıra sivri çatı
          m = new THREE.Mesh(shared.box, mat);
          m.scale.set(w, h + 4, d); m.position.set(bx, GROUND + h / 2 - 2, bz);
          group.add(m);
          windows(bx, w, h, bz + d / 2, Math.round(2 + h * 1.2));
          if (rnd() < 0.25) {
            var spire = new THREE.Mesh(shared.cone, mat);
            spire.scale.set(w * 0.35, 1.6 + rnd() * 1.5, w * 0.35);
            spire.position.set(bx, GROUND + h + spire.scale.y / 2, bz);
            group.add(spire);
          }
        }
      }
    }
    group.userData.span = span;
    group.userData.par = par;
    winMat.userData.base = winMat.opacity; group.userData.winMat = winMat;   // v2.5: müzik nabzı için
    scene.add(group);
    return group;
  }

  // Tekrarlanabilir rastgele sayı (şehir her açılışta aynı görünsün)
  function mulberry(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  // ---- Saat kulesi (bir kapı = üst + alt kule) ----
  var TOP_VISIBLE = Y(-30);                    // üst kulenin görünen en üst noktası (pencere sınırı)
  function buildGate(gate, bodyIdx) {
    var g = new THREE.Group();
    var w = gate.w / S, d = w;
    var gy0 = gate.gapY0 != null ? gate.gapY0 : gate.gapY;
    var amp = gate.amp || 0;
    var gapTop = Y(gy0 - gate.gapH / 2), gapBot = Y(gy0 + gate.gapH / 2);
    var skyTopY = Y(-300);                     // üst kule ekranın üstüne taşsın (hareket payıyla)
    var rnd = mulberry(gate.id * 9973 + 17);   // her kule kendi rastgeleliğiyle, ama kararlı

    function addWindow(parent, face, along, yy, curved) {
      // face: 0 ön (+z), 1 sol (-x), 2 sağ (+x). v2.6 curved: 1 = silindir (cam yüzeye oturur), 2 = altıgen (düz ön yüz 0.433·w'de)
      var lit = rnd() < 0.55;
      var win = new THREE.Mesh(shared.win, lit ? shared.winLit : shared.winDark);
      var out = 0.012;
      if (face === 0) win.position.set(along, yy, (curved === 1 ? Math.sqrt(Math.max(0, w * w / 4 - along * along)) : curved === 2 ? w * 0.433 : d / 2) + out);
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
        glow.scale.set(0.62, 0.8, 1);
        parent.add(glow);
      }
    }

    function tower(y0, y1, capAtBottom, parent, clockRoom) {
      // Korniş ucunda gövdeyi 0.1 kısalt: iki yüzey aynı düzlemde olunca ekran kartı hangisini
      // çizeceğine karar veremiyor ve titreme (z-fighting) oluyor.
      var capEdge = capAtBottom ? y0 : y1;
      if (capAtBottom) y0 += 0.1; else y1 -= 0.1;
      var h = y1 - y0, cy = (y0 + y1) / 2;
      var dir = capAtBottom ? 1 : -1;          // kuleye doğru yön
      var st = style;
      // Gövde: kutu (çoğu), silindir (Mars, Venüs), altıgen (Plüton, Orion)
      var bodyGeo = (st === 'silo' || st === 'cloud') ? shared.round : (st === 'ice' || st === 'crystal') ? shared.hex : shared.box;
      var body = new THREE.Mesh(bodyGeo, shared.towerMat);
      body.scale.set(w, h, d); body.position.y = cy;
      if (bodyGeo === shared.hex) body.rotation.y = Math.PI / 6;   // düz yüz öne baksın (pencereler oturabilsin)
      var busy = [];                                              // v2.6: süslerin kapladığı yükseklikler — pencere buralara konmaz
      function band(y, hh) { busy.push([y, hh]); }
      body.castShadow = true; body.receiveShadow = true;
      parent.add(body);
      if (bodyGeo === shared.box && st !== 'obelisk') [-1, 1].forEach(function (sx) {          // köşe pilastrları
        var p = new THREE.Mesh(shared.box, shared.edgeMat);
        p.scale.set(0.12, h - 0.05, 0.12); p.position.set(sx * (w / 2 - 0.02), cy, d / 2 - 0.02);
        parent.add(p);
      });
      function part(geo, mat, sx, sy, sz, x, y, z) { var m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(x || 0, y, z || 0); if (geo === shared.hex) m.rotation.y = Math.PI / 6; parent.add(m); return m; }
      function along(k) { return capEdge + dir * k; }          // boşluk kenarından kuleye doğru k birim
      function inside(k) { return capAtBottom ? along(k) < limitHi2 : along(k) > GROUND - 2; }
      var limitHi2 = TOP_VISIBLE + 2;
      // Kapak (boşluk kenarı): biçim gök cismine göre
      var capGeo = (st === 'silo' || st === 'cloud') ? shared.round : (st === 'ice' || st === 'crystal') ? shared.hex : shared.box;
      var cap = new THREE.Mesh(capGeo, shared.capMat);
      cap.scale.set(w * 1.18, 0.3, d * 1.18); cap.position.y = capEdge + dir * 0.15;
      cap.castShadow = true; parent.add(cap);
      if (capGeo === shared.hex) cap.rotation.y = Math.PI / 6;
      var i, kk;
      if (st === 'lunar') {                                   // Ay: ince bant + yan anten ve ışık
        part(shared.box, shared.edgeMat, w * 1.08, 0.12, d * 1.08, 0, along(0.95)); band(along(0.95), 0.06);
        part(shared.box, shared.edgeMat, 0.06, 1.2, 0.06, w / 2 + 0.1, along(1.1));
        part(shared.ball, shared.accentMat, 0.09, 0.09, 0.09, w / 2 + 0.1, along(1.75));
      } else if (st === 'bunker') {                           // Merkür: basamaklı kapak + yanlarda soğutucu kanatlar
        part(shared.box, shared.capMat, w * 1.04, 0.24, d * 1.04, 0, along(0.42)); band(along(0.42), 0.12);
        for (i = 0; i < 3; i++) { kk = 1.3 + i * 2.2; if (!inside(kk)) break;
          [-1, 1].forEach(function (sx) { part(shared.box, shared.edgeMat, 0.07, 1.2, d * 0.7, sx * (w / 2 + 0.06), along(kk)); }); }
      } else if (st === 'ice') {                              // Plüton: altıgen buz sütun + yanlardan çıkan kristaller
        [-1, 1].forEach(function (sx) {
          var o = part(shared.octa, shared.accentMat, 0.16, 0.28, 0.16, sx * w * 0.56, along(0.75)); o.rotation.z = sx * 0.5;
          part(shared.octa, shared.edgeMat, 0.11, 0.2, 0.11, sx * w * 0.5, along(1.45), 0.15);
        });
      } else if (st === 'silo') {                             // Mars: silindir silo + çember kaburgalar
        for (i = 0; i < 4; i++) { kk = 0.85 + i * 1.5; if (!inside(kk)) break;
          var rb = part(shared.torus, shared.edgeMat, w * 0.53, w * 0.53, 1.4, 0, along(kk)); rb.rotation.x = Math.PI / 2; band(along(kk), 0.08); }
      } else if (st === 'cloud') {                            // Venüs: bulut şehri — geniş platform diski
        part(shared.round, shared.capMat, w * 1.6, 0.1, d * 1.6, 0, along(1.6));
        part(shared.round, shared.accentMat, w * 1.62, 0.03, d * 1.62, 0, along(1.68)); band(along(1.64), 0.12);
      } else if (st === 'strips') {                           // Neptün: parlayan yatay şeritler
        for (i = 0; i < 6; i++) { kk = 0.6 + i * 1.25; if (!inside(kk)) break; part(shared.box, shared.accentMat, w * 1.03, 0.06, d * 1.03, 0, along(kk)); band(along(kk), 0.04); }
      } else if (st === 'bands') {                            // Jüpiter: kalın-ince bulut bantları
        var bw = [0.45, 0.18, 0.36], pos = 0.6;              // v2.6: 3 kalın-ince bant (5 bant merdiven gibi duruyordu)
        for (i = 0; i < bw.length; i++) { if (!inside(pos)) break; part(shared.box, i === 1 ? shared.accentMat : shared.edgeMat, w * 1.05, bw[i], d * 1.05, 0, along(pos + bw[i] / 2)); band(along(pos + bw[i] / 2), bw[i] / 2); pos += bw[i] + 0.9 + i * 0.5; }
      } else if (st === 'ringed') {                           // Satürn: kulenin etrafında eğik halka
        var rg = part(shared.torus, shared.accentMat, w * 0.85, w * 0.85, 1.2, 0, along(1.0)); rg.rotation.x = Math.PI / 2 - 0.35;
        var rg2 = part(shared.torus, shared.edgeMat, w * 0.98, w * 0.98, 0.6, 0, along(1.0)); rg2.rotation.x = Math.PI / 2 - 0.35; band(along(1.0), 0.55);
      } else if (st === 'tilted') {                           // Uranüs: dik duran halkalar (gezegen gibi yan yatık)
        var t1 = part(shared.torus, shared.accentMat, w * 0.75, w * 0.75, 1.2, 0, along(1.3)); t1.rotation.y = Math.PI / 2; t1.rotation.x = 0.25;
        var t2 = part(shared.torus, shared.edgeMat, w * 0.62, w * 0.62, 0.8, 0, along(1.3)); t2.rotation.y = Math.PI / 2; t2.rotation.x = 0.25;
      } else if (st === 'flare') {                            // Güneş: kenarlardan taşan alev dilleri
        for (i = 0; i < 4; i++) { kk = 0.7 + i * 1.6; if (!inside(kk)) break;
          [-1, 1].forEach(function (sx) { var f = part(shared.cone, shared.accentMat, 0.12, 0.45, 0.12, sx * (w / 2 + 0.08), along(kk)); f.rotation.z = -sx * 0.9; }); }
      } else if (st === 'twin') {                             // Alpha Centauri: çift kapak + iki yıldız küre
        part(shared.box, shared.capMat, w * 0.5, 0.22, d * 1.1, -w * 0.3, along(0.45));
        part(shared.box, shared.capMat, w * 0.5, 0.22, d * 1.1, w * 0.3, along(0.45)); band(along(0.45), 0.11);
        part(shared.ball, shared.accentMat, 0.16, 0.16, 0.16, -w * 0.62, along(0.95));
        part(shared.ball, shared.edgeMat, 0.11, 0.11, 0.11, w * 0.62, along(1.25));
      } else if (st === 'shards') {                           // Oort: buz kırıntısı kümesi
        var sh = [[-0.25, 0.35, 0.4, 0.5], [0.22, 0.55, 0.35, 1.1], [0.0, 0.95, 0.3, 2.0], [0.3, 1.3, 0.22, 2.6]];
        sh.forEach(function (q) { var m = part(shared.octa, q[3] > 1.5 ? shared.accentMat : shared.edgeMat, w * q[2], w * q[2] * 0.7, w * q[2], w * q[0], along(q[1]), d * 0.35); m.rotation.set(q[3], q[3] * 0.7, 0.3); band(along(q[1]), w * q[2] * 0.6); });
      } else if (st === 'crystal') {                          // Orion: altıgen kristal + kapakta parlayan kristal salkımı
        [[-0.32, 0.55, 0.2], [0.05, 0.75, 0.26], [0.36, 0.5, 0.17]].forEach(function (q) { part(shared.octa, shared.accentMat, q[2], q[2] * 1.7, q[2], w * q[0], along(q[1]), d * 0.4); });
        band(along(0.65), 0.5);
        for (i = 0; i < 3; i++) { kk = 1.4 + i * 1.6; if (!inside(kk)) break; part(shared.hex, shared.edgeMat, w * 1.06, 0.07, d * 1.06, 0, along(kk)); band(along(kk), 0.05); }
      } else if (st === 'hover') {                            // Andromeda: havada duran yüzük katmanlar (arada ışık)
        part(shared.box, shared.capMat, w * 1.08, 0.18, d * 1.08, 0, along(0.62));
        part(shared.box, shared.accentMat, w * 0.9, 0.05, d * 0.9, 0, along(0.4));
        part(shared.box, shared.accentMat, w * 0.9, 0.05, d * 0.9, 0, along(0.84));
        part(shared.box, shared.capMat, w * 1.02, 0.14, d * 1.02, 0, along(1.1)); band(along(0.75), 0.45);
      } else if (st === 'obelisk') {                          // Samanyolu: köşelerinde yıldız ışığı akan dikilitaş
        [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sz) { part(shared.box, shared.accentMat, 0.05, Math.min(h, 9), 0.05, sx * (w / 2 + 0.01), along(Math.min(h, 9) / 2 + 0.3), sz * (d / 2 + 0.01)); }); });
        for (i = 0; i < 5; i++) part(shared.ball, shared.accentMat, 0.05, 0.05, 0.05, (i % 2 ? 1 : -1) * (w / 2 - 0.1), along(0.8 + i * 1.1), d / 2 + 0.03);   // köşelerde (pencerelerin dışında)
      } else if (st === 'pylon') {                            // Pulsar: vuruşla parlayan yatay halkalar
        for (i = 0; i < 3; i++) { var pr = part(shared.torus, shared.accentMat, w * 0.72, w * 0.72, 1.4, 0, along(0.65 + i * 0.75)); pr.rotation.x = Math.PI / 2; band(along(0.65 + i * 0.75), 0.08); }
      } else if (st === 'clocktower') {                       // TON 618: saat kulesi — kadran müzikle parlar, akrep ve yelkovan zaman genişlemesiyle ağır ağır döner
        var cY = along(1.25), cZ = d / 2 + 0.02;
        part(shared.box, shared.capMat, w * 1.1, 1.35, 0.06, 0, cY, d / 2 - 0.01);
        var face = part(shared.disc, shared.winLit, 0.88, 0.88, 1, 0, cY, cZ + 0.01);
        var rim = part(shared.torus, shared.edgeMat, 0.55, 0.55, 1.5, 0, cY, cZ + 0.02);
        for (i = 0; i < 12; i++) { var a12 = i * Math.PI / 6; part(shared.box, shared.towerMat, 0.035, i % 3 ? 0.06 : 0.11, 0.01, Math.sin(a12) * 0.44, cY + Math.cos(a12) * 0.44, cZ + 0.025).rotation.z = -a12; }
        [[0.36, 0.035, 0.9], [0.24, 0.05, 0.075]].forEach(function (hd) {
          var pv = new THREE.Group(); pv.position.set(0, cY, cZ + 0.035);
          var hm = new THREE.Mesh(shared.box, shared.towerMat); hm.scale.set(hd[1], hd[0], 0.012); hm.position.y = hd[0] / 2 - 0.04; pv.add(hm);
          pv.userData.speed = hd[2]; parent.add(pv); hands.push(pv);
        });
        band(cY, 0.72);
      }

      // v1.6: saatler şimdilik kaldırıldı ("zaman" teması ileride ayrı bir bölüm olabilir)
      var r = 0;

      // Pencereler: kornişin ötesinden başlayıp kulenin görünen kısmı boyunca, rastgele yüz ve konum
      var yy = capEdge + dir * (0.4 + 2 * Math.max(r, 0) + 0.7);
      var limitLo = capAtBottom ? y0 : GROUND + 0.5, limitHi = capAtBottom ? TOP_VISIBLE : y1 - 0.2;
      // v2.5: pencereler her yüzde 2 sabit yuvaya oturur (merkezler ±0.32 → aralarında 0.30 boşluk),
      // aynı kattaki pencereler aynı yükseklikte; böylece pencereler asla üst üste binmez.
      // v2.6: yuvarlak/altıgen gövdede sadece ön yüze; kanat/alev/küre olan kulelerde yan yüzlere pencere yok; süslerin üstüne pencere yok
      var curved = bodyGeo === shared.round ? 1 : bodyGeo === shared.hex ? 2 : 0;
      var noSide = curved > 0 || st === 'bunker' || st === 'flare' || st === 'twin' || st === 'ice';
      while (yy > limitLo && yy < limitHi) {
        var n = 1 + (rnd() < 0.35 ? 1 : 0);    // bazen aynı katta iki pencere
        var used = {}, fy = yy + (rnd() - 0.5) * 0.12;
        if (busy.some(function (b) { return Math.abs(fy - b[0]) < b[1] + 0.3; })) { yy += dir * 0.4; continue; }
        if (curved === 2) { addWindow(parent, 0, 0, fy, 2); yy += dir * (0.9 + rnd() * 0.7); continue; }   // altıgen ön yüz dar: tek pencere
        for (var k = 0; k < n; k++) {
          var face = noSide ? 0 : rnd() < 0.5 ? 0 : (rnd() < 0.5 ? 1 : 2);
          var slot = rnd() < 0.5 ? 0 : 1;
          if (used[face + '_' + slot]) slot = 1 - slot;
          if (used[face + '_' + slot]) continue;
          used[face + '_' + slot] = true;
          addWindow(parent, face, (slot ? 1 : -1) * (curved ? 0.22 : 0.32) + (rnd() - 0.5) * 0.08, fy, curved);
        }
        yy += dir * (0.9 + rnd() * 0.7);
      }
    }
    var hands = [];
    var style = TOWER_STYLE[BODIES[Math.max(0, Math.min(BODIES.length - 1, bodyIdx | 0))].name] || 'clock';   // v2.6: kule, geçileceği gök cisminin biçiminde
    var top = new THREE.Group(), bot = new THREE.Group();
    tower(gapTop, skyTopY, true, top, 3);
    // Alt kule zeminin 3 birim içinden başlar: kapı yukarı oynadığında tabanı açıkta kalmasın.
    // Saat için yer: kapının en aşağı indiği andaki görünen yükseklik.
    var minVisible = Y(gy0 + amp + gate.gapH / 2) - GROUND;
    tower(GROUND - 3, gapBot, false, bot, minVisible);
    g.add(top); g.add(bot);
    g.userData.top = top; g.userData.bot = bot; g.userData.gy0 = gy0; g.userData.hands = hands;
    scene.add(g);
    return g;
  }

  function syncGates(state, dt) {
    var alive = {}, ahead = 0;
    for (var i = 0; i < state.gates.length; i++) {
      var gate = state.gates[i];
      alive[gate.id] = true;
      if (!gate.passed) ahead++;
      // v2.6: bu kule geçildiğinde skor ≈ şimdiki skor + önündeki geçilmemiş kule sayısı → o skorun gök cismine göre biçimlenir
      var tg = towers[gate.id] || (towers[gate.id] = buildGate(gate, Math.floor(((state.score || 0) + (gate.passed ? 0 : ahead)) / PLANET_EVERY)));
      tg.position.x = X(gate.x + gate.w / 2);
      for (var hi = 0; hi < tg.userData.hands.length; hi++) tg.userData.hands[hi].rotation.z = -state.t * tg.userData.hands[hi].userData.speed;
      // Giriş animasyonu konuma bağlı: x=W+170'te tamamen saklı, x=W-10'da yerinde
      var p = Math.min(1, Math.max(0, (KK.W + 170 - gate.x) / 180));
      var off = Math.pow(1 - p, 3) * 9;        // ease-out (sona doğru yavaşlar)
      var move = (tg.userData.gy0 - gate.gapY) / S; // hareketli kapı: boşluk kayınca iki kule birlikte kayar
      tg.userData.top.position.y = off + move;
      tg.userData.bot.position.y = -off + move;
      if (gate.broken) {                        // v1.5: çarpılan kule çöker — üstü fırlar, altı yere gömülür
        var br = tg.userData.br = Math.min(1, (tg.userData.br || 0) + dt / 0.55);
        var k2 = br * br;
        tg.userData.top.position.y += k2 * 12; tg.userData.top.rotation.z = k2 * 0.5;
        tg.userData.bot.position.y -= k2 * 12; tg.userData.bot.rotation.z = -k2 * 0.15;
      }
      // v2.6: FİNAL — kuleler kara deliğin önünü kapatmasın: 0.7 sn'de üsttekiler yukarı, alttakiler yere çekilir (16 birim)
      if (state.mode === 'finale') {
        var fq = Math.min(1, state.modeTime / 0.7), f2 = fq * fq * 16;
        tg.userData.top.position.y += f2; tg.userData.bot.position.y -= f2;
      }
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
  // v2.5: her skinin kendi iz stili var (TRAIL_STYLES). İz her karede bir nokta bırakır; hız arttıkça hem noktalar
  // seyrekleşir hem de tutulan nokta sayısı artar: n = 34 · len · (1 + 0.6·(katsayı − 1))  → ×2.0'da iz 3.2 kat uzun.
  var TRAIL_N = 34, TRAIL_MAX = 80, trails = [], lastScrollX = null, boost = 0, emitN = 0;
  var TRAIL_STYLES = {
    ribbon:  { w: 1,    tail: 1,   tailA: 1,   len: 1,   spark: 0.18 },
    comet:   { w: 0.8,  tail: 1.9, tailA: 1.5, len: 1.5, spark: 0.12 },           // uzun, geniş, parlak kuyruk
    spark:   { w: 0.65, tail: 0.7, tailA: 0.8, len: 0.9, spark: 0.75 },           // ince şerit, bol kıvılcım
    dash:    { w: 1.15, tail: 1,   tailA: 1,   len: 1.1, spark: 0.1, dash: 7 },   // kesik kesik (pist ışıkları)
    wave:    { w: 1,    tail: 1.1, tailA: 1,   len: 1.1, spark: 0.15, wave: 0.3 },   // dalgalanan iz
    twin:    { w: 1.6,  tail: 0,   tailA: 0,   len: 1.25, spark: 0.3 },           // kuyruk şeridi yok, iki keskin çizgi
    smoke:   { w: 0.7,  tail: 2.6, tailA: 0.6, len: 1.3, spark: 0.05, grow: 1 },  // arkada genişleyen duman
    rainbow: { w: 1.1,  tail: 1.2, tailA: 1.1, len: 1.15, spark: 0.2, hue: 1 },   // boyunca akan gökkuşağı
    pulse:   { w: 1,    tail: 1.1, tailA: 1.1, len: 1.2, spark: 0.15, pulse: 1 },  // geriye akan ışık atımları
    holo:    { w: 1.25, tail: 1.5, tailA: 1.35, len: 1.45, spark: 0.6, holo: 1 }  // FYST'e özel: pembe/mavi holografik dalgalar, beyaz çekirdek
  };
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
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      var idx = [];
      for (var i = 0; i < TRAIL_MAX - 1; i++) { var a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
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
      if (!sp) { if (sparks.length >= 64) return; sp = { s: new THREE.Sprite(shared.sparkMat), life: 0 }; scene.add(sp.s); sparks.push(sp); }
      sp.life = sp.max = 0.35 + Math.random() * 0.3;
      sp.s.visible = true;
      sp.s.position.copy(pos);
      sp.v = new THREE.Vector3(-1.5 - Math.random() * 2.5, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread);
    }
  }
  function updateTrails(state, dScroll, dt) {
    planeGroup.updateMatrixWorld();
    var emit = state.mode !== 'dead', T = state.t;
    var st = TRAIL_STYLES[(curSkin && curSkin.trail) || 'ribbon'] || TRAIL_STYLES.ribbon;
    var kSpeed = state.mode === 'playing' ? Math.max(0, (state.mult || 1) - 1) : 0;
    var n = Math.max(4, Math.min(TRAIL_MAX, Math.round(TRAIL_N * st.len * (1 + 0.6 * kSpeed))));
    var sparkP = st.spark * (curSkin && curSkin.stars ? 1.6 : 1);   // v2.5: yıldız skinleri daha çok kıvılcım saçar
    boost = Math.max(0, boost - dt * 3.5);
    if (emit) emitN++;
    trails.forEach(function (tr, k) {
      var pts = tr.pts, def = tr.def, isTail = k === 2;
      var wMul = isTail ? st.tail : st.w, aMul = isTail ? st.tailA : 1;
      for (var i = 0; i < pts.length; i++) pts[i].x -= dScroll;           // dünya sola kayar, iz de kayar
      if (emit) { tmpV.copy(def.local).applyMatrix4(planeGroup.matrixWorld); var np = tmpV.clone(); np.n = emitN; pts.push(np); }
      else if (pts.length) pts.shift();                                   // ölünce iz yavaşça söner
      while (pts.length > TRAIL_MAX) pts.shift();
      if (emit && !isTail && state.mode === 'playing' && Math.random() < sparkP) spark(pts[pts.length - 1], 1, 0.6);
      var pos = tr.mesh.geometry.attributes.position, col = tr.mesh.geometry.attributes.color;
      tr.mesh.visible = wMul > 0;
      tr.mesh.geometry.setDrawRange(0, (n - 1) * 6);
      var have = Math.min(pts.length, n);
      for (var j = 0; j < n; j++) {
        var q = pts[Math.max(0, pts.length - n + j)] || pts[0];
        if (!q) { pos.setXYZ(j * 2, 0, -99, 0); pos.setXYZ(j * 2 + 1, 0, -99, 0); continue; }
        var f = have < 2 ? 0 : Math.max(0, (j - (n - have)) / (n - 1));   // 0 kuyruk → 1 uçak
        var half = st.grow
          ? def.width * wMul * (0.25 + 0.75 * (1 - f)) * Math.min(1, f * 4) * (1 + boost * 0.8)      // duman: arkada genişler
          : def.width * wMul * (0.35 + 0.65 * f) * (1 + boost * 1.4) * f;
        var yo = st.wave ? st.wave * Math.sin((q.n || 0) * 0.45 - T * 7) * (1 - f) : 0;          // dalga: uzaklaştıkça büyür
        pos.setXYZ(j * 2, q.x, q.y + yo + half, q.z);
        pos.setXYZ(j * 2 + 1, q.x, q.y + yo - half, q.z);
        if (st.holo) { var hw = 0.5 + 0.5 * Math.sin((q.n || 0) * 0.16 - T * 3.0); tmpC.setHSL(0.58 + 0.34 * hw, 0.9, 0.72 + 0.2 * f * (isTail ? 1 : 0.5)); }
        else if (st.hue) tmpC.setHSL(((q.n || 0) * 0.012 + T * 0.15) % 1, 1, 0.62 + 0.15 * f);   // gökkuşağı noktaya bağlı akar
        else tmpC.copy(tailCol).lerp(headCol, Math.pow(f, 0.7));            // uca yakın sıcak, kuyrukta skinin rengi
        var a = Math.pow(f, st.grow ? 0.7 : 1.25) * def.alpha * aMul * (1 + boost * 0.6);
        if (st.dash) a *= ((q.n || 0) % st.dash) < st.dash * 0.55 ? 1.15 : 0.04;
        if (st.pulse) a *= 0.22 + 2.0 * Math.pow(0.5 + 0.5 * Math.sin((q.n || 0) * 0.55 + T * 16), 10);
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
  // v2.5: seviye game.js'den gelir (state.fireLvl) = çarpmadan geçilen kule serisi: 10 küçük, 50 orta, 100 büyük.
  // Her çarpmada (kalkanlı olsa da) duman çıkararak söner.
  // v1.7: renk o anki gök cisminden gelir (Dünya turuncu, Ay buz mavisi, Mars kızıl...).
  function fireColor(score) {
    return BODIES[Math.min(BODIES.length - 1, Math.floor(score / PLANET_EVERY))].fire;
  }
  var smokeSprite = null;
  function extinguishFire() {
    for (var i = 0; i < fire.parts.length; i++) fire.parts[i].life = Math.min(fire.parts[i].life, 0.12);
    if (!smokeSprite) {
      smokeSprite = document.createElement('canvas'); smokeSprite.width = smokeSprite.height = 64;
      var g = smokeSprite.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(200,200,210,0.9)'); gr.addColorStop(0.5, 'rgba(140,140,155,0.45)'); gr.addColorStop(1, 'rgba(90,90,100,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }
    var digits = String(lastScore < 0 ? 0 : lastScore).length, baseW = fire.font * 0.62 * Math.max(1, digits);
    for (var k = 0; k < 26; k++) {
      var life = 0.8 + Math.random() * 0.7;
      fire.smoke.push({ x: fire.w / 2 + (Math.random() - 0.5) * baseW, y: fire.h * 0.8 + Math.random() * 10,
        vx: (Math.random() - 0.5) * 40, vy: -(40 + Math.random() * 60), size: (18 + Math.random() * 22) * (fire.font / 60),
        life: life, max: life, ph: Math.random() * 6.28 });
    }
    fire.burst = 0;
  }
  var FIRE_SCALE = [0, 0.75, 1.0, 1.35];                      // alev boyu çarpanı
  var FIRE_RATE = [0, 32, 55, 85];                          // saniyede doğan alev parçacığı (v2.6: 45/80/130 → 32/55/85, parçacıklar %25 iri)
  var fire = { cv: null, ctx: null, w: 300, h: 240, dpr: 1, parts: [], smoke: [], sprites: {}, acc: 0, burst: 0, color: null, font: 60 };
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
    fire.dpr = 1;   // v2.6: yumuşak alev için 1x yeterli (2x'te 4 kat piksel boyanıyordu)
    fire.layoutDigits = -1;
    fire.font = parseFloat(getComputedStyle(hudScore).fontSize) || 60;
    fire.w = Math.round(fire.font * 5.2); fire.h = Math.round(fire.font * 4);
    fire.cv.width = fire.w * fire.dpr; fire.cv.height = fire.h * fire.dpr;
    fire.cv.style.width = fire.w + 'px'; fire.cv.style.height = fire.h + 'px';
  }
  function updateFire(state, dt) {
    var lvl = state.mode === 'playing' ? (state.fireLvl || 0) : 0;
    if (state.mode !== 'playing') fire.smoke.length = 0;
    if (!lvl && !fire.parts.length && !fire.smoke.length) {
      if (fire.shown) { fire.cv.style.display = 'none'; hudScore.style.textShadow = ''; fire.shown = false; fire.shadow = ''; }
      return;
    }
    if (!fire.shown) { fire.cv.style.display = ''; fire.shown = true; }
    var digits = String(state.score).length;
    // v2.6: konum her karede DOM'dan okunmuyor (her okuma tarayıcıya sayfa düzenini yeniden hesaplatıyordu);
    // sadece basamak sayısı değişince ya da ekran boyutu değişince bir kez ölçülür
    if (fire.layoutDigits !== digits) {
      fire.layoutDigits = digits;
      var cx = hudScore.offsetLeft + hudScore.offsetWidth / 2;
      var base = hudScore.offsetTop + hudScore.offsetHeight * 0.92;
      fire.cv.style.left = Math.round(cx - fire.w / 2) + 'px';
      fire.cv.style.top = Math.round(base - fire.h * 0.86) + 'px';
    }
    var col = fireColor(state.score);
    fire.burst = Math.max(0, fire.burst - dt * 1.6);
    var sc = FIRE_SCALE[lvl] * (1 + fire.burst * 0.6);
    var baseW = fire.font * 0.62 * digits;                     // rakamların genişliği kadar taban
    // Parçacık doğur
    if (lvl) {
      fire.acc += dt * FIRE_RATE[lvl] * (1 + fire.burst * 3);
      while (fire.acc >= 1 && fire.parts.length < 120) {
        fire.acc -= 1;
        var life = 0.45 + Math.random() * 0.45;
        fire.parts.push({
          x: fire.w / 2 + (Math.random() - 0.5) * baseW,
          y: fire.h * 0.86 + Math.random() * 6,
          vx: (Math.random() - 0.5) * 30,
          vy: -(70 + Math.random() * 90) * sc,
          size: (25 + Math.random() * 22) * sc * (fire.font / 60),
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
      if (p.life <= 0) { fire.parts[i] = fire.parts[fire.parts.length - 1]; fire.parts.pop(); continue; }   // v2.6: splice yerine sondakiyle değiştir
      var k = p.life / p.max;                                  // 1 doğum → 0 ölüm
      p.ph += dt * 9;
      p.x += (p.vx + Math.sin(p.ph) * 22) * dt;
      p.y += p.vy * dt;
      p.x += (fire.w / 2 - p.x) * dt * 1.4;                    // alev uca doğru incelir
      var s = p.size * (0.35 + 0.65 * k);
      c.globalAlpha = Math.min(1, k * 1.6) * 0.75;
      c.drawImage(fireSprite(p.col), p.x - s / 2, p.y - s / 2, s, s);
    }
    c.globalCompositeOperation = 'source-over';
    for (var j = fire.smoke.length - 1; j >= 0; j--) {          // duman: yavaş yükselir, genişler, söner
      var q = fire.smoke[j];
      q.life -= dt;
      if (q.life <= 0) { fire.smoke.splice(j, 1); continue; }
      var kk = q.life / q.max;
      q.ph += dt * 3;
      q.x += (q.vx + Math.sin(q.ph) * 14) * dt; q.y += q.vy * dt; q.vy *= 1 - dt * 0.6;
      var ss = q.size * (1.8 - 0.8 * kk);
      c.globalAlpha = Math.min(1, kk * 1.4) * 0.7;
      c.drawImage(smokeSprite, q.x - ss / 2, q.y - ss / 2, ss, ss);
    }
    c.globalAlpha = 1;
    // Rakamlar alev rengiyle parlasın; tutuşma anında sayaç bir an büyüsün
    // v2.6: gölge sadece değişince yazılır (bulanık metin gölgesi her karede yeniden boyanıyordu); 4 px adımlarla
    var shadow = lvl ? '0 3px 0 #1b1838, 0 0 ' + (Math.round((14 + 18 * sc) / 4) * 4) + 'px ' + col : '';
    if (shadow !== fire.shadow) { hudScore.style.textShadow = shadow; fire.shadow = shadow; }
  }
  function igniteFire() { fire.burst = 1; }
  // v2.5: kalkan patlaması — uçağın etrafında alev renginde büyüyüp sönen ateş topu
  var shieldFx = null, shieldT = 0, SHIELD_DUR = 0.5, bubble = null;
  // v2.5: kalkan hazırken uçağın etrafında soluk, nabız atan bir kabarcık
  function ringTexture() {
    return canvasTex(128, 128, function (g, w) {
      var gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.62, 'rgba(255,255,255,0.12)');
      gr.addColorStop(0.82, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.9, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
  }
  function updateBubble(state, x, y) {
    if (!bubble) {
      bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: color('#8fd8ff'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      bubble.renderOrder = 3; scene.add(bubble);
    }
    var on = state.mode === 'playing' && state.shield;
    bubble.visible = on;
    if (!on) return;
    bubble.position.set(x - 0.05, y, 0.2);
    bubble.scale.setScalar(1.75 + Math.sin(state.t * 4) * 0.06);
    bubble.material.opacity = 0.3 + Math.sin(state.t * 4) * 0.08;
  }
  function popShield(x, y, col) {
    if (!shieldFx) {
      shieldFx = new THREE.Sprite(new THREE.SpriteMaterial({ map: shared.glowMat.map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
      shieldFx.renderOrder = 10; scene.add(shieldFx);
    }
    shieldFx.material.color.set(col); shieldFx.position.set(x, y, 0.3); shieldT = SHIELD_DUR;
  }
  function updateShield(rdt, x, y) {
    if (!shieldFx) return;
    shieldT = Math.max(0, shieldT - rdt);
    var u = 1 - shieldT / SHIELD_DUR;                         // 0 → 1
    shieldFx.visible = shieldT > 0;
    shieldFx.position.set(x, y, 0.3);
    shieldFx.scale.setScalar(0.8 + 4.2 * (1 - Math.pow(1 - u, 3)));   // hızlı açılır, yavaşlar
    shieldFx.material.opacity = Math.pow(1 - u, 1.5) * 0.95;
  }

  // ---- v2.1: Hız çizgileri — ×1.3 üstünde belirir, tam hızda yoğunlaşır ----
  // Oyun düzlemi (z=0) ile kamera arasında ince, eklemeli çizgiler; dünyadan 2.2 kat hızlı akar.
  var lines = [], scorePop = 0, camK = 0;
  function updateSpeedLines(state, dt, k) {
    if (!lines.length) {
      var geo = new THREE.PlaneGeometry(1, 0.025);
      for (var i = 0; i < 26; i++) {
        var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        m.userData.seed = Math.random(); m.visible = false; reset(m, true); scene.add(m); lines.push(m);
      }
    }
    function reset(m, anywhere) {
      m.position.set(anywhere ? -12 + Math.random() * 26 : 14 + Math.random() * 6, -5 + Math.random() * 13, 2 + Math.random() * 9);
      m.scale.x = 1.5 + Math.random() * 3.5;
    }
    var on = reduced ? 0 : Math.max(0, Math.min(1, (k - 0.3) / 0.5));   // ×1.3 → 0, ×1.8 → 1
    var v = (state.speed || 0) / S * 2.2;
    for (var j = 0; j < lines.length; j++) {
      var L = lines[j];
      var want = j < Math.round(lines.length * on);
      L.visible = want || L.material.opacity > 0.01;
      if (!L.visible) continue;
      L.material.opacity += ((want ? 0.10 + 0.12 * L.userData.seed : 0) - L.material.opacity) * Math.min(1, dt * 4);
      L.position.x -= v * dt * (0.7 + L.userData.seed * 0.6);
      if (L.position.x < -16) reset(L, false);
    }
  }

  KK.Render3D = {
    init: function (canvas, hud) {
      // v3.0 optimizasyon: 2x ekranlarda kenar yumuşatma (MSAA) gereksiz ve pahalı — sadece düşük piksel yoğunluğunda açık
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: (window.devicePixelRatio || 1) < 1.75, powerPreference: 'high-performance' });
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;      // v3.0: PCFSoft → PCF (gölge başına daha az örnek)

      scene = new THREE.Scene();
      skyCv = document.createElement('canvas'); skyCv.width = 4; skyCv.height = 256;
      skyTexture = new THREE.CanvasTexture(skyCv);
      scene.background = skyTexture;                 // v1.6: gökyüzü temaya göre yeniden boyanır
      scene.fog = new THREE.Fog(color('#4a3466'), 26, 70);

      // Kamera: hafif soldan ve yukarıdan bakan 3/4 açı, derinlik hissi için
      camera = new THREE.PerspectiveCamera(46, KK.W / KK.H, 0.1, 200);
      camera.position.set(-3.6, 0.9, 21);
      camera.lookAt(0.5, -0.4, 0);
      camera.userData.base = camera.position.clone();

      // Işık: mor gökyüzü dolgusu + gün batımından gelen sıcak ana ışık
      hemi = new THREE.HemisphereLight(color('#8d79c9'), color(P.ground), 0.75);
      scene.add(hemi);
      key = new THREE.DirectionalLight(color('#ffb27a'), 0.95);
      // Sağ-önden gelen ışık: gölgeler sola ve arkaya düşer. Böylece soldan çıkıp silinen kulelerin
      // gölgeleri ekranın dışında kalır; gölge kamerası da geniş tutulur ki kenarda kesilmesin.
      key.position.set(9, 10, 9);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);      // v3.0: 2048² → 1024² (gölge haritası 4 kat küçük)
      key.shadow.bias = -0.0005;
      var sc = key.shadow.camera; sc.left = -18; sc.right = 18; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 50;
      scene.add(key);
      rimLight = new THREE.DirectionalLight(color(P.skyLow), 0.5);   // arkadan kenar ışığı
      rimLight.position.set(-6, 3, -12);
      scene.add(rimLight);

      // Paylaşılan geometri/malzemeler (her kule için yeniden yaratmayalım)
      shared.box = new THREE.BoxGeometry(1, 1, 1);
      shared.cone = new THREE.ConeGeometry(1, 1, 4);
      shared.disc = new THREE.CircleGeometry(0.62, 32);
      shared.win = new THREE.PlaneGeometry(0.34, 0.5);
      shared.bit = new THREE.PlaneGeometry(0.16, 0.11);
      shared.dome = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);   // yarım küre
      shared.cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
      // v2.6: gök cismine özel kule parçaları
      shared.hex = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
      shared.round = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
      shared.torus = new THREE.TorusGeometry(1, 0.05, 6, 28);
      shared.octa = new THREE.OctahedronGeometry(1);
      shared.ball = new THREE.SphereGeometry(1, 12, 8);
      shared.cityWin = new THREE.PlaneGeometry(0.22, 0.3);
      shared.towerMat = new THREE.MeshLambertMaterial({ color: color(P.tower) });
      shared.edgeMat = new THREE.MeshLambertMaterial({ color: color(P.towerEdge) });
      shared.capMat = new THREE.MeshLambertMaterial({ color: color(P.towerEdge), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      shared.winLit = new THREE.MeshBasicMaterial({ map: windowTexture(), color: color('#ffd38a') });
      shared.accentMat = new THREE.MeshBasicMaterial({ color: color(P.towerEdge) });   // v2.6: müzikle nabız atan süs (halkalar, şeritler)
      shared.lampLit = new THREE.MeshBasicMaterial({ color: color('#ffd98a') });
      shared.glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: color('#ffc070'), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      shared.winGlowMat = new THREE.SpriteMaterial({ map: shared.glowMat.map, color: color('#ffb860'), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
      shared.sparkMat = new THREE.SpriteMaterial({ map: shared.glowMat.map, color: color('#ffe6b0'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      shared.winDark = new THREE.MeshLambertMaterial({ color: color(P.cityNear) });
      shared.bitMat = new THREE.MeshBasicMaterial({ color: color(P.paper), side: THREE.DoubleSide });

      // Arka plan: güneş yerine TON 618 — ufkun üstünde asılı dev kara delik
      bhMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uFade: { value: 0 } }, vertexShader: BH_VERT, fragmentShader: BH_FRAG,
        transparent: true, depthWrite: false, fog: false,
        // Önceden çarpılmış karışım: renk gökyüzüne EKLENİR, gölge (alfa=1) arkasını siyahla örter
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor
      });
      var bh = new THREE.Mesh(new THREE.PlaneGeometry(58 * 1.9, 58), bhMat);  // en/boy 1.9: disk yanlara uzanır
      // v1.6: gök cisimlerinin yeri — ekranın sol kenarı, yukarı-orta yükseklik, z = -46 düzlemi.
      // Kameradan o ekran noktasına ışın atıp düzlemle kesiştiriyoruz (en/boy değişse de doğru kalır).
      camera.updateMatrixWorld();
      // v2.6: sağ üst. Gök cisimleri ortaya daha yakın (x = 0.70), TON 618 kenarda (x = 1.0) kalır
      var ray = new THREE.Vector3(1.0, 0.58, 0.5).unproject(camera).sub(camera.position).normalize();
      anchorBH = camera.position.clone().addScaledVector(ray, (-46 - camera.position.z) / ray.z);
      ray = new THREE.Vector3(0.70, 0.58, 0.5).unproject(camera).sub(camera.position).normalize();
      anchor = camera.position.clone().addScaledVector(ray, (-46 - camera.position.z) / ray.z);
      bh.position.copy(anchorBH);
      bh.rotation.z = -0.06;                   // diske hafif bir eğim
      scene.add(bh);
      KK.__bh = bh;                            // test kancası
      sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: color('#ff8a5c'), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      sunGlow.position.set(anchor.x - 2, anchor.y, -47);
      sunGlow.scale.set(52, 52, 1);
      scene.add(sunGlow);
      buildPlanets(bh);                          // v1.6: Dünya'dan TON 618'e 12 gök cismi

      // Yıldızlar (havasız dünyalarda görünür; opaklık temadan)
      var sp = [], srnd = mulberry(4242);
      for (var si = 0; si < 420; si++) sp.push(-75 + srnd() * 150, GROUND + 3 + Math.pow(srnd(), 0.7) * 45, -60 - srnd() * 12);
      var sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, sizeAttenuation: true, transparent: true, opacity: 0, fog: false, depthWrite: false }));
      // v2.5: yıldızlar EN ÖNCE çizilsin. Saydam nesneler merkez noktasına göre sıralanır; bulutun merkezi (0,0,0)
      // kameraya gök cisminden (z=-46) yakın sayıldığı için yıldızlar Ay'ın ÜSTÜNE basılıyordu.
      stars.renderOrder = -10;
      scene.add(stars);

      // İlk şehir: Dünya
      var c0 = getCity(0); c0.layers.forEach(function (L) { L.visible = true; }); activeCities.push(c0);
      // Sokak seviyesinde sıcak şehir ışığı pusu (binaların tabanını aydınlatır, boşluk hissini kırar)
      var hazeTex = canvasTex(8, 128, function (g, w, h) {
        var gr = g.createLinearGradient(0, h, 0, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.35, 'rgba(235,215,225,0.18)'); gr.addColorStop(1, 'rgba(160,140,200,0)');   // nötr; renk temadan
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      });
      [[-38, 7, 0.55], [-18.5, 4, 0.45], [-9.5, 2.2, 0.35]].forEach(function (hz) {
        var hm = new THREE.MeshBasicMaterial({ map: hazeTex, transparent: true, opacity: hz[2], blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        hm.userData.base = hz[2];
        hazeMats.push(hm);
        var haze = new THREE.Mesh(new THREE.PlaneGeometry(140, hz[1]), hm);
        haze.position.set(0, GROUND + hz[1] / 2, hz[0]);
        scene.add(haze);
      });

      // Zemin: şehri taşıyan derin taban (arka binaların altını da kapatır)
      baseMat = new THREE.MeshLambertMaterial({ color: color('#211c3c') });
      var base = new THREE.Mesh(new THREE.BoxGeometry(140, 6, 76), baseMat);
      base.position.set(0, GROUND - 3 - 0.02, -36);  // ön kenarı z=+2'de, z=-74'e kadar uzanır
      base.receiveShadow = true;
      scene.add(base);
      // Yol: kulelerin dikildiği ön şerit, oyun hızıyla kayar
      roadTex = roadTexture();
      roadTex.repeat.set(10, 1);
      roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
      var road = new THREE.Mesh(new THREE.PlaneGeometry(80, 8), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, GROUND, -2);          // z: -6 ile +2 arası
      road.receiveShadow = true;
      scene.add(road);
      // v3.0.2: ön meydan — yolun önünden kameraya kadar karo zemin (tam ekranda ve hızda kamera geri
      // çekilince altta boşluk/düz siyah görünüyordu). Kamera z=21+3.9'dan bakınca alt kenar ışını zemine
      // en yakın z≈13'te değiyor; zemin z=+2 → +42 arası, yani her hızda boşluk kalmaz.
      plazaTex = plazaTexture();
      plazaTex.repeat.set(70, 20);                 // 2×2 birimlik karolar
      plazaMat = new THREE.MeshLambertMaterial({ map: plazaTex });
      var plaza = new THREE.Mesh(new THREE.PlaneGeometry(140, 40), plazaMat);
      plaza.rotation.x = -Math.PI / 2;
      plaza.position.set(0, GROUND - 0.005, 22);
      plaza.receiveShadow = true;
      scene.add(plaza);
      // ön kaldırımın dibinde alçak çit/çalı şeridi (zemini bölsün diye)
      var hedge = new THREE.Mesh(new THREE.BoxGeometry(140, 0.32, 0.5), baseMat);
      hedge.position.set(0, GROUND + 0.16, 5.4); hedge.receiveShadow = true;
      scene.add(hedge);
      // Sokak lambaları: arka kaldırımda, yolla aynı hızda kayar
      lamps = new THREE.Group();
      var poleMat = new THREE.MeshLambertMaterial({ color: color('#1a1630') });
      // v3.0.2: ön kaldırım babaları — ışıklı tepeleriyle hızı hissettirir (3 birim arayla, 6'lık döngüye uyar)
      for (var bi = 0; bi < 32; bi++) {
        var bx = -48 + bi * 3;
        var bol = new THREE.Mesh(shared.box, poleMat); bol.scale.set(0.16, 0.5, 0.16); bol.position.set(bx, GROUND + 0.25, 3.0);
        var cap = new THREE.Mesh(shared.box, shared.lampLit); cap.scale.set(0.18, 0.06, 0.18); cap.position.set(bx, GROUND + 0.53, 3.0);
        lamps.add(bol); lamps.add(cap);
      }
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

      themeT = 0; applyTheme(1); themeT = 1;      // Dünya temasıyla başla

      buildTrails();
      applySkin('paper');

      hudScore = hud.querySelector('#score');
      hudFlash = hud.querySelector('#flash');
      initFire(hud);
      initStatus(hud);
    },

    setSkin: function (id) { if (renderer) applySkin(id); },
    // v3.0: yavaş cihaz modu — gölgeler kapanır (her karede gölge haritası çizilmez)
    lowPower: function () { if (!renderer || !renderer.shadowMap.enabled) return; renderer.shadowMap.enabled = false; scene.traverse(function (o) { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.needsUpdate = true; }); } }); },

    resize: function (w, h, dpr) {
      if (!renderer) return;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      // v3.0 tam ekran: ekran 9:16'dan uzunsa yatay görüş açısı aynı kalır, dikey açı büyür →
      // oyun alanı aynı genişlikte, üstte daha çok gökyüzü, altta daha çok yer görünür (siyah şerit yok)
      camera.aspect = w / h;
      vFovK = Math.max(1, (KK.W / KK.H) / camera.aspect);   // tan(dikey/2) çarpanı
      // v3.0.2: fazladan görünen yüksekliğin %70'i üste verilir → şehir ve oyun alanı aşağı iner, alt boşluk azalır.
      // 390×844'te: fazla alan 1 − 1/1.217 = %17.8 → aşağı kayma %17.8·0.7/2 = %6.2 ekran ≈ 53 px
      viewShift = (1 - 1 / vFovK) * 0.7;
      camera.fov = -1;                                      // sonraki karede yeniden hesaplansın
    },

    draw: function (state, dt, realDt) {
      var rdt = realDt == null ? dt : realDt;   // v2.2: durmuşken de parlama/sarsıntı sönsün
      if (!renderer) return;
      // Yeniden başlayınca efektleri temizle
      if (state.mode === 'ready' && lastMode !== 'ready') { shakeT = 0; flashT = 0; cpScore = 0; popT = 0; cpT = 0; for (var i = 0; i < bits.length; i++) { bits[i].life = 0; bits[i].mesh.visible = false; } clearTrails(); }
      lastMode = state.mode;

      var pl = state.plane, px = X(pl.x), py = Y(pl.y);
      for (var e = 0; e < state.events.length; e++) {
        var ev = state.events[e];
        if (ev === 'flap') { spawnBits(px, py, 4, 2.5); flapBurstPending = true; }
        if (ev === 'score') scorePop = 1;
        if (ev === 'milestone') igniteFire();
        if (ev === 'hit') { shakeT = reduced ? 0 : 0.3; flashT = 0.25; spawnBits(px, py, 12, 4); }
        if (ev === 'bump') { shakeT = reduced ? 0 : 0.22; flashT = 0.14; spawnBits(px, py, 10, 3.5); extinguishFire(); }
        if (ev === 'break') spawnBits(px + 0.6, py, 8, 3);
        if (ev === 'shield') { shakeT = reduced ? 0 : 0.16; popShield(px, py, '#bfe8ff'); spawnBits(px, py, 10, 3.5); extinguishFire(); }
        if (ev === 'shieldReady') popT = 1.6;
        if (ev === 'checkpoint') { cpScore = state.score; cpToast.textContent = '\u2713 CHECKPOINT SAVED \u00b7 ' + state.score; cpT = 2.8; }
        if (ev === 'complete') { warpT = 1; flashT = 0.35; shakeT = reduced ? 0 : 0.5; }
        if (ev === 'life') livesPulse = 1;
      }

      // Uçak: konum + burun açısı + hıza göre hafif yatış (3D'ye özel)
      planeGroup.position.set(px, py, 0);
      planeGroup.rotation.set(Math.max(-0.5, Math.min(0.5, pl.vy / 900)), 0, -pl.angle);
      // Dokunulmazken uçak yanıp söner (saniyede ~4.5 kez)
      planeGroup.visible = !(state.mode === 'playing' && state.invuln > 0 && Math.sin(state.t * 28) < 0);
      // v2.5 FİNAL: uçak kara deliğe 2 tur spiral çizerek çekilir. İlerleme e = u² (başta yavaş, sonda hızlı);
      // derinliğe (z → kara deliğin düzlemi) gider ve spagettileşir: boy ×(1 + 2e²), en ×(1 − 0.7e).
      finE = 0;
      if (state.mode === 'finale' && state.finaleFrom) {
        var bhp = planets[planets.length - 1].mesh.position;
        var fu = Math.min(1, state.modeTime / ((KK.Game.config && KK.Game.config.FINALE_DUR) || 3.4)), fe = fu * fu;
        var fx0 = X(state.finaleFrom.x) - bhp.x, fy0 = Y(state.finaleFrom.y) - bhp.y;
        // v2.6: dönüş ekranda kalsın — sarmal yarıçapı en fazla 7 birim (eskiden uçağın kara deliğe uzaklığı ≈ 25+ birimdi, ekrandan taşıyordu);
        // ilk %25'te uçak bulunduğu yerden sarmala yumuşakça katılır
        // v2.6: merkezde daha çok dönsün — yarıçap (1−u)^1.6 ile erken küçülür, açı 2π·(1.25u + 2.5u³): toplam 3.75 tur, çoğu merkezde
        var d0 = Math.sqrt(fx0 * fx0 + fy0 * fy0), fr = Math.min(d0, 7) * Math.pow(1 - fu, 1.6), fa = Math.atan2(fy0, fx0) + Math.PI * 2 * (1.25 * fu + 2.5 * fu * fu * fu);
        var jw = 1 - Math.min(1, fu / 0.25); jw = jw * jw * (3 - 2 * jw);
        planeGroup.position.set(bhp.x + fr * Math.cos(fa) + jw * (fx0 - Math.min(d0, 7) * Math.cos(fa)),
                                bhp.y + fr * Math.sin(fa) * 0.55 + jw * (fy0 - Math.min(d0, 7) * Math.sin(fa) * 0.55), bhp.z * Math.pow(fe, 1.3));
        planeGroup.rotation.set(0, 0, fa + Math.PI / 2);
        planeGroup.scale.set(1 + 2 * fe * fe, 1 - 0.7 * fe, 1 - 0.7 * fe);
        planeGroup.visible = fu < 1;
        shakeT = Math.max(shakeT, reduced ? 0 : 0.04 + 0.22 * fe);
        if (fu >= 0.97 && !finFlash) { finFlash = true; flashT = 0.7; }
        finE = fe;
      } else { planeGroup.scale.set(1, 1, 1); finFlash = false; }

      syncGates(state, dt);
      updateBits(dt);
      var dS = lastScrollX == null ? 0 : (state.scrollX - lastScrollX) / S;
      if (dS < 0 || dS > 2) { dS = 0; clearTrails(); }
      lastScrollX = state.scrollX;
      if (flapBurstPending) { flapBurst(); flapBurstPending = false; }
      animateSkin(state.t);
      updateTrails(state, dS, dt);

      // Paralaks: şehir katmanları farklı hızda kayar, iki kopya döngüyle döşenir
      updateCities(state, dt);                       // v1.6: şehirler kayar; gök cismi değişince batar/yükselir
      // Yol ve lambalar oyunla aynı hızda kayar (doku 8 birimde bir tekrar eder, lambalar 6'da bir)
      var worldScroll = state.scrollX / S;
      roadTex.offset.x = (worldScroll / 8) % 1;
      plazaTex.offset.x = (worldScroll / 2) % 1;
      lamps.position.x = -(worldScroll % 6);
      // Pencere ışıkları hafifçe nefes alır
      // v2.5: müzik nabzı (ui.js): pencereler, hareler ve sokak pusu vuruşla birlikte parlar
      var beat = KK.musicPulse ? KK.musicPulse() : 0;
      // v2.6: vuruş hissedilsin diye taban kısıldı, vuruş payı büyütüldü: pencere parıltısı 0.33+0.4·b → 0.16+0.95·b (vuruşta ~6 kat)
      shared.glowMat.opacity = 0.34 + Math.sin(state.t * 2.3) * 0.04 + 0.6 * beat;
      shared.winGlowMat.opacity = 0.16 + Math.sin(state.t * 1.7) * 0.03 + 0.95 * beat;
      sunGlow.material.opacity = 0.33 + Math.sin(state.t * 0.8) * 0.05;  // kara delik hafifçe nabız atar
      bhMat.uniforms.uTime.value = state.t;          // disk ve halkalar akar
      updatePlanets(state, dt);
      shared.winLit.color.copy(curTheme.win).multiplyScalar(0.55 + 1.15 * beat);
      shared.accentMat.color.copy(curTheme.edge).multiplyScalar(0.75 + 1.1 * beat);
      for (var hz = 0; hz < hazeMats.length; hz++) hazeMats[hz].opacity = hazeMats[hz].userData.base * (0.45 + 1.6 * beat);
      for (var ci = 0; ci < activeCities.length; ci++) activeCities[ci].layers.forEach(function (L) { var wm = L.userData.winMat; if (wm) wm.opacity = wm.userData.base * (0.45 + 1.4 * beat); });
      // Kamera: hazırda yavaş salınım, çarpınca sarsıntı
      // v2.1: hız katsayısıyla kamera geri çekilir ve görüş açısı genişler (hız hissi):
      //   geri çekilme = 2.6·(k−1) birim, FOV = 46° + 7°·(k−1)  → ×2.0'da +2.6 birim, 53°
      var base = camera.userData.base;
      var sway = state.mode === 'ready' && !reduced ? Math.sin(state.t * 0.6) * 0.6 : 0;
      var k = state.mode === 'playing' ? Math.max(0, (state.mult || 1) - 1) : 0;
      camK += (k - camK) * Math.min(1, dt * 1.5);
      warpT = Math.max(0, warpT - rdt * 1.4);
      var fov = 46 + 7 * camK + 9 * Math.sin(Math.min(1, warpT) * Math.PI) * (reduced ? 0 : 1) - 8 * finE;   // v2.5: finalde yakınlaşır
      if (vFovK > 1.0001) fov = 2 * Math.atan(Math.tan(fov * Math.PI / 360) * vFovK) * 180 / Math.PI;   // v3.0: uzun ekran
      if (KK.DEBUG_CAMK != null) camK = KK.DEBUG_CAMK;   // test kancası (hız etkisini görmek için)
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov; camera.updateProjectionMatrix();
        if (viewShift) { camera.projectionMatrix.elements[9] = viewShift; camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert(); }   // görüntüyü NDC'de aşağı kaydır
      }
      camera.position.set(base.x + sway, base.y, base.z + 2.6 * camK);
      if (!reduced && camK > 0.6 && state.mode === 'playing') {           // tam hıza yakın: hafif motor titreşimi
        var rum = (camK - 0.6) * 0.05;
        camera.position.x += (Math.random() - 0.5) * rum; camera.position.y += (Math.random() - 0.5) * rum;
      }
      updateSpeedLines(state, dt, camK);
      if (shakeT > 0) {
        shakeT -= rdt;
        var a = 0.35 * Math.max(shakeT, 0) / 0.3;
        camera.position.x += (Math.random() - 0.5) * a; camera.position.y += (Math.random() - 0.5) * a;
      }
      if (finE > 0) {                                   // v2.5: finalde kamera kara deliğe döner
        var bhq = planets[planets.length - 1].mesh.position, lk = 0.3 * finE;
        camera.lookAt(0.5 + (bhq.x - 0.5) * lk, -0.4 + (bhq.y + 0.4) * lk, bhq.z * lk);
      } else camera.lookAt(0.5, -0.4, 0);

      renderer.render(scene, camera);

      // HUD: skor (sadece oynarken) ve beyaz flaş
      if (state.mode === 'playing') {
        if (state.score !== lastScore) { hudScore.textContent = state.score; lastScore = state.score; }
        hudScore.hidden = false;
      } else { hudScore.hidden = true; lastScore = -1; }
      updateFire(state, dt);
      updateShield(rdt, px, py);
      updateBubble(state, px, py);
      updateStatus(state, rdt);
      scorePop = Math.max(0, scorePop - dt * 5);
      var sc2 = 1 + fire.burst * 0.35 + scorePop * 0.12;
      // v3.0: stil sadece değer değişince yazılır (her kare yazmak tarayıcıya stil yeniden hesaplatıyordu)
      var tf = sc2 > 1.001 ? 'scale(' + sc2.toFixed(3) + ')' : '';
      if (tf !== hudTf) { hudScore.style.transform = tf; hudTf = tf; }
      var fo = 0; if (flashT > 0) { flashT -= rdt; fo = Math.max(flashT, 0) / 0.25 * 0.7; }
      if (fo !== hudFo) { hudFlash.style.opacity = fo; hudFo = fo; }
    }
  };
})();
