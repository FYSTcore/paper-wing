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
    { name: 'URANUS', kind: 5, R: 11.7, spin: 0.15, tilt: 1.68, incl: -0.20, atm: '#8ff0f0', atmK: 0.7, fire: '#26e0e8', glow: '#6fd8e0',
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
    { name: 'TON 618', kind: 'bh', R: 8.0, fire: '#ff4fb4', glow: '#ff8a5c',
      sky: [P.skyTop, P.skyMid, P.skyLow], fog: '#4a3466', hemi: ['#8d79c9', P.ground, 0.75], key: ['#ffb27a', 0.95], rim: P.skyLow,
      city: [P.cityFar, P.cityNear, '#1f1a38'], win: P.glow, tower: P.tower, edge: P.towerEdge, base: '#211c3c',
      road: '#b4a6e6', lamp: '#ffd98a', haze: '#ffa874', stars: 0.2, shapes: { box: 1, spire: 0.25 } }
  ];
  var PLANET_EVERY = KK.PLANET_EVERY = 200;                                   // kaç puanda bir gök cismi değişir (v2.0: tekrar 200)
  var PL_HX = 2.6, PL_HY = 1.6;                             // dörtgenin yarı boyu (gezegen yarıçapı biriminde)
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
    '  col = mix(col, vec3(0.93,0.96,1.0), smoothstep(0.80, 0.86, abs(lat) + (m - 0.5)*0.2));',
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
    '  col = mix(col, vec3(0.38,0.14,0.07), smoothstep(0.035, 0.0, abs(lat + 0.08 + (m-0.5)*0.06)) * 0.6);',
    '  col = mix(col, vec3(0.96,0.94,0.90), smoothstep(0.86, 0.91, abs(lat) + (m - 0.5)*0.12));',
    '  return col * (0.025 + 1.05*lam);',
    '#elif KIND == 3',                                        // JÜPİTER
    '  float tl = lat + (fbm(q*4.0) - 0.5)*0.10;',
    '  float b = sin(tl*22.0), b2 = sin(tl*8.5 + 1.0);',
    '  vec3 col = mix(vec3(0.93,0.88,0.77), vec3(0.78,0.58,0.40), smoothstep(-0.3, 0.6, b));',
    '  col = mix(col, vec3(0.52,0.34,0.22), smoothstep(0.5, 0.95, b2)*0.55);',
    '  col *= 0.88 + 0.22*fbm(vec3(q.x*3.0, q.y*26.0, q.z*3.0));',
    '  vec2 ll = lonlat(q); vec2 d = (ll - vec2(0.7, -0.38)) * vec2(1.0, 2.2); float sp = length(d);',
    '  col = mix(col, vec3(0.95,0.85,0.72), smoothstep(0.24, 0.19, sp)*0.6);',
    '  col = mix(col, vec3(0.78,0.32,0.18), smoothstep(0.19, 0.12, sp));',
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
    '  return 0.75*smoothstep(0.012, 0.0, abs(rr - 1.56)) + 0.4*smoothstep(0.008, 0.0, abs(rr - 1.47)) + 0.35*smoothstep(0.008, 0.0, abs(rr - 1.41));',
    '#endif',
    '}',
    'void main(){',
    '  vec2 p = (vUv*2.0 - 1.0) * vec2(' + PL_HX.toFixed(2) + ', ' + PL_HY.toFixed(2) + ');',
    '  float r = length(p);',
    '  float quad = smoothstep(1.0, 0.8, abs(vUv.x*2.0 - 1.0)) * smoothstep(1.0, 0.75, abs(vUv.y*2.0 - 1.0));', // dörtgen kenarı görünmesin
    '  vec3 L = normalize(vec3(0.75, 0.30, 0.60));',
    '  vec3 C = vec3(0.0); float A = 0.0;',
    '#if RING',
    '  vec3 ax = vec3(0.0, 1.0, 0.0); ax.yz = rot(ax.yz, -uIncl); ax.xy = rot(ax.xy, -uTilt);',
    '  float rz = -(ax.x*p.x + ax.y*p.y) / ax.z;',
    '  vec3 hp = vec3(p, rz);',
    '  float ra = min(1.0, ringDensity(length(hp)) * 1.2);',
    '  float tt = -dot(hp, L);',
    '  float shade = (tt > 0.0 && length(hp + tt*L) < 1.0) ? 0.18 : 1.0;',
    '#if KIND == 4',
    '  vec3 rc = vec3(1.0, 0.91, 0.70) * shade;',
    '#else',
    '  vec3 rc = vec3(0.70, 0.84, 0.90) * shade;',
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
  var anchor = null;                                        // gök cisminin merkezi (ekranın sol kenarında)
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
        mat = new THREE.ShaderMaterial(Object.assign({
          uniforms: { uTime: { value: 0 }, uFade: { value: 0 }, uSpin: { value: def.spin }, uTilt: { value: def.tilt },
                      uIncl: { value: def.incl }, uAtmK: { value: def.atmK }, uAtm: { value: color(def.atm) } },
          defines: { KIND: def.kind, RING: (def.kind === 4 || def.kind === 5) ? 1 : 0 },
          vertexShader: BH_VERT, fragmentShader: PL_FRAG
        }, blend));
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * PL_HX * def.R, 2 * PL_HY * def.R), mat);
        scene.add(mesh);
      }
      mesh.position.copy(anchor);
      var vis = i === 0 ? 1 : 0;
      mat.uniforms.uFade.value = vis;
      mesh.visible = vis > 0;
      planets.push({ def: def, mesh: mesh, mat: mat, vis: vis, baseS: mesh.scale.x });
    });
    glowCol = color(BODIES[0].glow);
    BODIES.forEach(function (T) { T.c = themeColors(T); });
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

  function updatePlanets(state, dt) {
    var want = state.mode === 'ready' ? 0 : Math.min(BODIES.length - 1, Math.floor(state.score / PLANET_EVERY));
    if (want !== planetIdx) {
      if (state.mode === 'playing' && want > planetIdx) { banner.firstChild.textContent = want * PLANET_EVERY; banner.lastChild.textContent = BODIES[want].name; bannerT = 2.6; }
      switchCity(planetIdx, want);
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
      // Gelen soldan kayarak girer, giden sola kayıp çıkar
      pl.mesh.position.x = anchor.x - (1 - e) * pl.def.R * 2.4;
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
  var livesEl = null, multEl = null, lastLives = -1, lastMult = '', livesWrap = null;
  var PLANE_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M2 12 L22 4 L15 21 L11 14 Z" fill="currentColor"/><path d="M11 14 L22 4" stroke="#1b1838" stroke-width="1.4"/></svg>';
  function initStatus(hud) {
    livesWrap = document.createElement('div');
    livesWrap.style.cssText = 'position:absolute;top:max(10px,env(safe-area-inset-top,0px));left:max(12px,env(safe-area-inset-left,0px));pointer-events:none;display:none;font:700 13px/1 var(--font-body);color:var(--paper);text-shadow:0 2px 0 #1b1838';
    livesEl = document.createElement('div'); livesEl.style.cssText = 'display:flex;gap:4px;color:var(--paper)';
    multEl = document.createElement('div'); multEl.style.cssText = 'margin-top:6px;letter-spacing:.06em;opacity:.85;font-variant-numeric:tabular-nums';
    livesWrap.appendChild(livesEl); livesWrap.appendChild(multEl);
    hud.appendChild(livesWrap);
    banner = document.createElement('div');
    banner.style.cssText = 'position:absolute;left:0;right:0;top:24%;text-align:center;pointer-events:none;opacity:0;color:var(--paper)';
    banner.innerHTML = '<div style="font:800 13px/1 var(--font-body);letter-spacing:.3em;color:var(--glow);margin-bottom:6px"></div><div style="font-family:var(--font-display);font-size:clamp(24px,8vmin,42px);letter-spacing:.06em;text-shadow:0 3px 0 #1b1838,0 0 22px rgba(160,190,255,.55)"></div>';
    hud.appendChild(banner);
  }
  function updateStatus(state) {
    var on = state.mode === 'playing';
    livesWrap.style.display = on ? '' : 'none';
    if (!on) { lastLives = -1; return; }
    var max = (KK.Game.config && KK.Game.config.LIVES) || 2;
    if (state.hitsLeft !== lastLives) {
      var html = '';
      for (var i = 0; i < max; i++) html += '<span style="display:inline-block;transition:opacity .3s,transform .3s;' + (i < state.hitsLeft ? '' : 'opacity:.22;transform:scale(.8)') + '">' + PLANE_SVG + '</span>';
      livesEl.innerHTML = html; lastLives = state.hitsLeft;
    }
    var m = '×' + (state.mult || 1).toFixed(2);
    if (state.fireOut) m += '  \u00b7  FIRE ' + Math.max(0, state.score - state.fireHitScore) + '/' + ((KK.Game.config && KK.Game.config.FIRE_RELIGHT) || 150);
    if (m !== lastMult) { multEl.textContent = 'SPEED ' + m; lastMult = m; }
    multEl.style.color = (state.mult || 1) >= ((KK.Game.config && KK.Game.config.SPEED_MULT_MAX) || 2) - 0.001 ? 'var(--glow)' : '';
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
    { id: 'paper',    name: 'PAPER',    req: 0,    paper: '#fbf7ef', shade: '#d9d0c0', line: '#0b0918', glow: 0.35, head: '#ffe2a6', tail: '#9b7bff', spark: '#ffe6b0' },
    { id: 'midnight', name: 'MIDNIGHT', req: 50,   paper: '#2a3566', shade: '#18204a', line: '#ffcf6b', glow: 0.25, head: '#9fd0ff', tail: '#3a4bff', spark: '#bfe0ff' },
    { id: 'ember',    name: 'EMBER',    req: 100,  paper: '#ff6a3d', shade: '#b8321a', line: '#2a0a04', glow: 0.45, head: '#ffd27a', tail: '#ff3a1a', spark: '#ffb060' },
    { id: 'lunar',    name: 'LUNAR',    req: 200,  paper: '#c9d2e0', shade: '#8f9ab0', line: '#0b0918', glow: 0.30, head: '#e6f4ff', tail: '#7fa8ff', spark: '#e6f4ff' },
    { id: 'solar',    name: 'SOLAR',    req: 800,  paper: '#ffd23a', shade: '#ff9a1a', line: '#5a1a00', glow: 0.75, head: '#fffbe0', tail: '#ff7a1a', spark: '#fff2a8' },
    { id: 'ringed',   name: 'RINGED',   req: 1400, paper: '#e8d6a8', shade: '#b89a60', line: '#2a1a08', glow: 0.35, head: '#fff0c0', tail: '#c0a060', spark: '#ffe8b0' },
    { id: 'void',     name: 'VOID',     req: 2200, paper: '#141022', shade: '#07060c', line: '#ff8a5c', glow: 0.10, head: '#ffb070', tail: '#a24bff', spark: '#ff9a6a' },
    { id: 'fyst',     name: 'FYST · DEV GIFT', secret: true, shape: 'dart', paper: '#ffffff', shade: '#d8d8e8', line: '#ffffff', glow: 0.6, head: '#ffffff', tail: '#ffffff', spark: '#ffffff' }
  ];
  function skinById(id) { for (var i = 0; i < KK.SKINS.length; i++) if (KK.SKINS[i].id === id) return KK.SKINS[i]; return KK.SKINS[0]; }
  var curSkin = null, planeMat = null, outlineMat = null;

  // ---- Kağıt uçak: üçgenlerden elle kurulmuş geometri ----
  // Klasik: iki kanat + omurga. 'dart' (dev hediyesi): daha uzun burun, geniş ok kanatlar, kuyruk dikmesi.
  function buildPlane(skin) {
    skin = skin || KK.SKINS[0];
    var u = 1 / S, dart = skin.shape === 'dart';
    var N = dart ? [24, 0, 0] : [18, 0, 0], C = [-12, 1, 0];
    var L = dart ? [-15, 3.5, -16] : [-12, 3, -12], R = dart ? [-15, 3.5, 16] : [-12, 3, 12], K = [-12, -6, 0];
    var tris = [[N, C, L], [N, R, C], [N, K, C]];          // sol kanat, sağ kanat, omurga
    var cols = [skin.paper, skin.paper, skin.shade];
    if (dart) {                                             // kuyruk dikmesi + kanat ucu kanatçıkları
      tris.push([[-6, 1, 0], [-13, 1, 0], [-15, 8, 0]]); cols.push(skin.shade);
      tris.push([[-11, 3.2, -13], [-15, 3.5, -16], [-14, 7, -15]]); cols.push(skin.paper);
      tris.push([[-11, 3.2, 13], [-14, 7, 15], [-15, 3.5, 16]]); cols.push(skin.paper);
    }
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
    g.add(inner);
    mesh.scale.setScalar(1.35);               // 3D'de uzaklıktan küçük görünmesin (çarpışma kutusu aynı)
    var cx = -2 / S * 1.35;                   // konturu uçağın kendi merkezi etrafında büyüt
    outline.scale.setScalar(1.35 * 1.2);
    outline.position.x = cx - cx * 1.2;
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
    var wx = skin.shape === 'dart' ? -15 : -12, wz = skin.shape === 'dart' ? 16 : 12, k2 = 1.35 / S;  // iz kanat uçlarından çıksın
    trailDefs[0].local.set(wx * k2, 3 * k2, -wz * k2); trailDefs[1].local.set(wx * k2, 3 * k2, wz * k2);
  }
  // Dev hediyesi: yanardöner (holografik) kağıt — renk tonu zamanla döner, kontur ve iz zıt tonda
  var devHsl = new THREE.Color();
  function animateSkin(t) {
    if (!curSkin || curSkin.id !== 'fyst') return;
    var h = (t * 0.12) % 1;
    planeMat.color.setHSL(h, 0.55, 0.78); planeMat.emissive.setHSL(h, 0.9, 0.55);
    outlineMat.color.setHSL((h + 0.5) % 1, 1, 0.7);
    headCol.setHSL(h, 1, 0.75); tailCol.setHSL((h + 0.33) % 1, 1, 0.6);
    shared.sparkMat.color.setHSL((h + 0.15) % 1, 1, 0.8);
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

      // v1.6: saatler şimdilik kaldırıldı ("zaman" teması ileride ayrı bir bölüm olabilir)
      var r = 0;

      // Pencereler: kornişin ötesinden başlayıp kulenin görünen kısmı boyunca, rastgele yüz ve konum
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

  function syncGates(state, dt) {
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
      if (gate.broken) {                        // v1.5: çarpılan kule çöker — üstü fırlar, altı yere gömülür
        var br = tg.userData.br = Math.min(1, (tg.userData.br || 0) + dt / 0.55);
        var k2 = br * br;
        tg.userData.top.position.y += k2 * 12; tg.userData.top.rotation.z = k2 * 0.5;
        tg.userData.bot.position.y -= k2 * 12; tg.userData.bot.rotation.z = -k2 * 0.15;
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
      if (emit && k < 2 && state.mode === 'playing' && Math.random() < (curSkin && curSkin.id === 'fyst' ? 0.55 : 0.18)) spark(pts[pts.length - 1], 1, 0.6);
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
  // Seviye: 10'da küçük, 50'de orta, 100'de büyük.
  // v1.7: renk o anki gök cisminden gelir (Dünya turuncu, Ay buz mavisi, Mars kızıl...).
  // Çarpınca ateş söner (duman), çarpmadan sonra 150 puan toplayınca büyük alevle geri yanar.
  function fireLevel(score) { return score < 10 ? 0 : score < 50 ? 1 : score < 100 ? 2 : 3; }
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
  var FIRE_RATE = [0, 45, 80, 130];                         // saniyede doğan alev parçacığı
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
    fire.dpr = Math.min(window.devicePixelRatio || 1, 2);
    fire.font = parseFloat(getComputedStyle(hudScore).fontSize) || 60;
    fire.w = Math.round(fire.font * 5.2); fire.h = Math.round(fire.font * 4);
    fire.cv.width = fire.w * fire.dpr; fire.cv.height = fire.h * fire.dpr;
    fire.cv.style.width = fire.w + 'px'; fire.cv.style.height = fire.h + 'px';
  }
  function updateFire(state, dt) {
    var lvl = state.mode === 'playing' && !state.fireOut ? fireLevel(state.score) : 0;
    if (state.mode !== 'playing') fire.smoke.length = 0;
    if (!lvl && !fire.parts.length && !fire.smoke.length) { fire.cv.style.display = 'none'; hudScore.style.textShadow = ''; return; }
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
      key.shadow.mapSize.set(2048, 2048);
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
      shared.cityWin = new THREE.PlaneGeometry(0.22, 0.3);
      shared.towerMat = new THREE.MeshLambertMaterial({ color: color(P.tower) });
      shared.edgeMat = new THREE.MeshLambertMaterial({ color: color(P.towerEdge) });
      shared.capMat = new THREE.MeshLambertMaterial({ color: color(P.towerEdge), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      shared.winLit = new THREE.MeshBasicMaterial({ map: windowTexture(), color: color('#ffd38a') });
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
      var ray = new THREE.Vector3(-1.0, 0.36, 0.5).unproject(camera).sub(camera.position).normalize();
      anchor = camera.position.clone().addScaledVector(ray, (-46 - camera.position.z) / ray.z);
      bh.position.copy(anchor);
      bh.rotation.z = -0.06;                   // diske hafif bir eğim
      scene.add(bh);
      KK.__bh = bh;                            // test kancası
      sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: color('#ff8a5c'), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      sunGlow.position.set(anchor.x + 2, anchor.y, -47);
      sunGlow.scale.set(52, 52, 1);
      scene.add(sunGlow);
      buildPlanets(bh);                          // v1.6: Dünya'dan TON 618'e 12 gök cismi

      // Yıldızlar (havasız dünyalarda görünür; opaklık temadan)
      var sp = [], srnd = mulberry(4242);
      for (var si = 0; si < 420; si++) sp.push(-75 + srnd() * 150, GROUND + 3 + Math.pow(srnd(), 0.7) * 45, -60 - srnd() * 12);
      var sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, sizeAttenuation: true, transparent: true, opacity: 0, fog: false, depthWrite: false }));
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

      themeT = 0; applyTheme(1); themeT = 1;      // Dünya temasıyla başla

      buildTrails();
      applySkin('paper');

      hudScore = hud.querySelector('#score');
      hudFlash = hud.querySelector('#flash');
      initFire(hud);
      initStatus(hud);
    },

    setSkin: function (id) { if (renderer) applySkin(id); },

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
        if (ev === 'bump') { shakeT = reduced ? 0 : 0.22; flashT = 0.14; spawnBits(px, py, 10, 3.5); extinguishFire(); }
        if (ev === 'break') spawnBits(px + 0.6, py, 8, 3);
      }

      // Uçak: konum + burun açısı + hıza göre hafif yatış (3D'ye özel)
      planeGroup.position.set(px, py, 0);
      planeGroup.rotation.set(Math.max(-0.5, Math.min(0.5, pl.vy / 900)), 0, -pl.angle);
      // Dokunulmazken uçak yanıp söner (saniyede ~4.5 kez)
      planeGroup.visible = !(state.mode === 'playing' && state.invuln > 0 && Math.sin(state.t * 28) < 0);

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
      lamps.position.x = -(worldScroll % 6);
      // Pencere ışıkları hafifçe nefes alır
      shared.glowMat.opacity = 0.5 + Math.sin(state.t * 2.3) * 0.06;
      shared.winGlowMat.opacity = 0.33 + Math.sin(state.t * 1.7) * 0.04;
      sunGlow.material.opacity = 0.33 + Math.sin(state.t * 0.8) * 0.05;  // kara delik hafifçe nabız atar
      bhMat.uniforms.uTime.value = state.t;          // disk ve halkalar akar
      updatePlanets(state, dt);

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
      updateStatus(state);
      if (flashT > 0) { flashT -= dt; hudFlash.style.opacity = Math.max(flashT, 0) / 0.25 * 0.7; }
      else hudFlash.style.opacity = 0;
    }
  };
})();
