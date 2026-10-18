// Paper Wing v2.5 — FYST açılış logosu
// Siyah ekran → BAM (logo oturur, sarsıntı, renk ayrışması, şok dalgası, tok darbe sesi)
// → holografik ışık sol alttan sağ üste geçer (pembe önde, mavi arkada) → kararır, oyun açılır.
// v3.0.6: atlanamaz (dokunuş/tuş yutulur). #bot veya #nointro ile hiç gösterilmez.
(function () {
window.KK = window.KK || {};
// ───────── Holografik logo: WebGL shader, logonun şekli maske olarak kullanılır ─────────
var LOGO_SRC = '';   // istenirse siluet PNG (sadece şeffaflığı kullanılır); boşsa Anton ile "FYST" çizilir
var HOLO = (function () {
  var cv = document.getElementById('introCv'), gl, prog, U = {}, aspect = 1, t0 = 0, sweepT = -1, bamT = -1, raf = 0;
  var VS = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }';
  var FS = [
    'precision highp float; varying vec2 uv; uniform sampler2D uMask; uniform float uT, uSweep, uAsp, uAb, uShock;',
    'float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }',
    'float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*f*(f*(f*6.-15.)+10.);',
    '  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }',
    'float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<3;i++){ s+=a*n(p); p=p*2.03+17.; a*=.45; } return s/.7111; }',
    // Gradyan haritası: Krita için verdiğimiz 11 duraklı tablo (beyaz zemin, koyu tarafta mavi, açık tarafta pembe→lila→mavi hare)
    'vec3 C(float r,float g,float b){ return vec3(r,g,b)/255.; }',
    'float S(float a,float b,float v){ return smoothstep(a,b,v); }',
    'vec3 gmap(float v){ vec3 c = C(242.,246.,255.);',
    '  c=mix(c,C(207.,230.,255.),S(.00,.17,v)); c=mix(c,C(150.,206.,255.),S(.17,.25,v));',
    '  c=mix(c,C(220.,239.,255.),S(.25,.33,v)); c=mix(c,C(255.,255.,255.),S(.33,.42,v));',
    '  c=mix(c,C(255.,224.,239.),S(.60,.70,v)); c=mix(c,C(255.,140.,200.),S(.70,.78,v));',
    '  c=mix(c,C(227.,184.,242.),S(.78,.86,v)); c=mix(c,C(207.,226.,255.),S(.86,.93,v));',
    '  c=mix(c,C(255.,255.,255.),S(.93,1.,v)); return c; }',
    'void main(){',
    '  float a = texture2D(uMask, uv).a;',
    // BAM renk ayrışması: pembe kopya sola, mavi kopya sağa kayık, uAb 1 → 0 sönerek birleşir
    '  vec2 off = vec2(.045, .02)*uAb;',
    '  float aP = texture2D(uMask, uv + off).a*uAb, aB = texture2D(uMask, uv - off).a*uAb;',
    '  vec3 ghost = C(255.,90.,190.)*aP + C(80.,170.,255.)*aB;',
    '  float ga = max(aP, aB)*(1.-a);',
    '  if (a < .003) { gl_FragColor = vec4(ghost*(1.-a), ga); return; }',
    '  vec2 s = vec2(uv.x*uAsp, uv.y);',
    // kumaş şeritleri: sol alt→sağ üst yönünde 3x uzatılmış gürültü + akış bükmesi (domain warp)
    '  vec2 d = vec2(.7071,.7071), nn = vec2(-.7071,.7071);',
    '  vec2 q = vec2(dot(s,d)*.9, dot(s,nn)*2.7);',
    '  q += .4*vec2(fbm(q*.6+vec2(0., uT*.06)), fbm(q*.6+vec2(5.2, -uT*.05)));',
    '  float v = fbm(q*1.1);',
    '  v = .5 + (v-.5)*1.9;',
    // ışık bandı: g = 0 sol alt, 1 sağ üst. uSweep: <0 başlamadı, 0..1 ilerliyor, >1 bitti
    '  float g = (s.x + s.y) / (uAsp + 1.);',
    '  float on = step(0., uSweep) * step(uSweep, 1.);',
    '  float b = mix(-.35, 1.35, clamp(uSweep,0.,1.)), dd = g - b;',
    '  float band = on * exp(-dd*dd/(2.*.14*.14));',            // holografi ışıkla birlikte ilerler
    '  float core = on * exp(-dd*dd/(2.*.022*.022));',          // ince beyaz çekirdek
    '  float passed = uSweep > 1. ? 1. : on * smoothstep(0., .25, -dd);',  // ışığın geride bıraktığı iz
    // şok dalgası: logonun ortasından dışa yayılan renk halkası (0.5 sn'de söner)
    '  float r = length((s - vec2(uAsp*.5, .5)) / vec2(uAsp*.5, .5));',
    '  float ring = uShock < 0. ? 0. : exp(-pow(r - uShock*3.2, 2.)/.03)*exp(-uShock*4.);',
    '  v = .5 + (v-.5)*(1. + .7*band);',                         // ışığın içinde renkler daha doygun
    '  v += .3*band*sin(dd*30. - uT*4.) + .5*ring*sin(r*18.) + .05*sin(uT*.7 + g*3.);',
    '  float sheen = .9 + .08*fbm(q*.6 + 3.);',
    '  vec3 W = vec3(.95,.95,.97) * sheen;',                     // düz beyaz (hafif inci)
    '  vec3 H = gmap(clamp(v,0.,1.)) * mix(sheen, .97, band);',
    '  float hk = clamp(mix(.06, .5, passed) + band + ring, 0., 1.);',  // önce %6, ışıkta %100, geride %50
    '  vec3 col = mix(W, H, hk);',
    '  col = mix(col, C(255.,140.,205.), .4*band*smoothstep(0.,.1,dd));',    // önde pembe ışık
    '  col = mix(col, C(140.,200.,255.), .4*band*smoothstep(0.,.1,-dd));',   // arkada mavi
    '  col += vec3(1.,.96,.98)*core*.35 + .35*ring;',
    '  col = min(col, 1.);',
    '  gl_FragColor = vec4(col*a + ghost*(1.-a), a + ga);',
    '}'].join('\n');

  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(s); return s; }
  // Halil'in logosu: Anton, yükseklik/genişlik ölçeği = (192/350)/(609/662) ≈ 0.596
  var SQUASH = 0.596;
  function maskFromText() {
    var fs = 400, c = document.createElement('canvas'), x = c.getContext('2d'), txt = 'FYST';
    x.font = fs + 'px Anton'; var m = x.measureText(txt);
    var w = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight), asc = m.actualBoundingBoxAscent, h = Math.ceil((asc + m.actualBoundingBoxDescent) * SQUASH), pad = 70;
    c.width = w + pad * 2; c.height = h + pad * 2;
    x.font = fs + 'px Anton'; x.fillStyle = '#fff'; x.textBaseline = 'alphabetic';
    x.translate(pad + m.actualBoundingBoxLeft, pad); x.scale(1, SQUASH); x.fillText(txt, 0, asc);
    return c;
  }
  function setup(src) {
    aspect = src.width / src.height;
    var dpr = Math.min(window.devicePixelRatio || 1, 3), cssW = Math.min(innerWidth * .76, 500)   /* v3.0: %84 → %76 (biraz küçük) */, cssH = cssW / aspect;
    cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px'; cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) { var x2 = cv.getContext('2d'); if (x2) x2.drawImage(src, 0, 0, cv.width, cv.height); return false; }
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    ['uMask', 'uT', 'uSweep', 'uAsp', 'uAb', 'uShock'].forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
    gl.uniform1i(U.uMask, 0); gl.uniform1f(U.uAsp, aspect);
    return true;
  }
  function frame(now) {
    var t = (now - t0) / 1000, sw = -1;
    if (sweepT >= 0) { var k = Math.min(1, (now - sweepT) / 1000); sw = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; if (k >= 1) sw = 2; }
    gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    var db = bamT < 0 ? -1 : (now - bamT) / 1000;
    gl.uniform1f(U.uAb, db < 0 ? 0 : Math.exp(-db / 0.07)); gl.uniform1f(U.uShock, db < 0 || db > 0.6 ? -1 : db);
    gl.uniform1f(U.uT, t); gl.uniform1f(U.uSweep, sw); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = requestAnimationFrame(frame);
  }
  return {
    ready: function () {
      var srcP = LOGO_SRC
        ? new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = LOGO_SRC; })
        : (document.fonts ? document.fonts.load('400px Anton') : Promise.resolve()).then(maskFromText);
      // font en fazla 1.5 sn beklenir
      var slow = new Promise(function (res) { setTimeout(res, 1500); }).then(maskFromText);
      return Promise.race([srcP, slow]).then(function (src) { if (!setup(src)) return; t0 = performance.now(); raf = requestAnimationFrame(frame); });
    },
    sweep: function () { sweepT = performance.now(); },
    bam: function () { bamT = performance.now(); },
    stop: function () { cancelAnimationFrame(raf); if (gl) { var e = gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); } }
  };
})();

// ───────── Ses: hepsi WebAudio sentezi (dosya yok) ─────────
var ctx = null, out = null;
function audio() {
  if (ctx) return ctx;
  var AC = window.AudioContext || window.webkitAudioContext;
  try { ctx = new AC({ latencyHint: 0.05 }); } catch (e) { ctx = new AC(); }   // v3.0.5: oyundaki gibi 50 ms tampon
  // v3.0.5: BAM'in enerjisinin %98'i 140 Hz altındaydı ve tepesi 2.14'e çıkıyordu (1.0 üstü = kırpılma → cızırtı).
  // Oyunda işe yarayan çözüm burada da: 140 Hz yüksek geçiren → tepe 0.66, hoparlör zorlanmaz; doygunluk harmonikleri kalır.
  var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140; hp.Q.value = 0.707;
  var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -8; comp.ratio.value = 12; comp.attack.value = 0.002;
  out = ctx.createGain(); out.gain.value = 0.85; out.connect(hp); hp.connect(comp); comp.connect(ctx.destination);
  return ctx;
}
function noiseBuf(c, sec) { var b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = b.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
function reverb(c, sec, decay) {
  var b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate);   // v3.0.5: tek kanal (yarı iş)
  for (var ch = 0; ch < 1; ch++) { var d = b.getChannelData(ch); for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay); }
  var cv = c.createConvolver(); cv.buffer = b; var w = c.createGain(); w.gain.value = 0.45; cv.connect(w); w.connect(out); return cv;
}
// BAM (tok): telefon hoparlörü ~150 Hz altını çalamaz → 50 Hz'lik bası tanh doygunlukla
// 100/150/200 Hz harmoniklerine taşıyoruz (kulak eksik temel frekansı kendisi tamamlar)
function sfxBam() {
  var c = audio(), t = c.currentTime + 0.01, rv = reverb(c, 2.2, 2.2);   // v3.0.5: 3.2 → 2.2 sn (kuyruk zaten sönmüştü)
  var low = c.createGain(); low.gain.value = 1; low.connect(out); low.connect(rv);
  var sat = c.createWaveShaper(), curve = new Float32Array(1024);
  for (var i = 0; i < 1024; i++) { var xx = i / 511.5 - 1; curve[i] = Math.tanh(3 * xx) / Math.tanh(3); }
  sat.curve = curve; var slp = c.createBiquadFilter(); slp.type = 'lowpass'; slp.frequency.value = 900;
  var sg2 = c.createGain(); sg2.gain.value = 0.45; sat.connect(slp); slp.connect(sg2); sg2.connect(out); sg2.connect(rv);
  function osc(type, f0, f1, glide, peak, dec, toSat) {
    var o = c.createOscillator(), g = c.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + glide);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.connect(g); g.connect(low); if (toSat) g.connect(sat); o.start(t); o.stop(t + dec + 0.05);
  }
  osc('sine', 50, 30, 1.4, 1.0, 1.7, true);        // derin alt bas (doygunluğa da gider)
  osc('triangle', 100, 46, 0.35, 0.8, 0.85, true);  // gövde
  osc('sine', 160, 70, 0.18, 0.55, 0.3, false);     // telefonda duyulan "tok" vuruş
  var n = c.createBufferSource(), lp = c.createBiquadFilter(), ng = c.createGain();
  n.buffer = noiseBuf(c, 0.5); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2200, t); lp.frequency.exponentialRampToValueAtTime(120, t + 0.25);
  ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.55, t + 0.003); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  n.connect(lp); lp.connect(ng); ng.connect(out); ng.connect(rv); n.start(t); n.stop(t + 0.35);
}
// Parlama sesi: yükselen, ince, metalik "şıng"
function sfxShine() {
  var c = audio(), t = c.currentTime + 0.01, rv = reverb(c, 1.6, 3);
  var n = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
  n.buffer = noiseBuf(c, 0.8); bp.type = 'bandpass'; bp.Q.value = 6;
  bp.frequency.setValueAtTime(2000, t); bp.frequency.exponentialRampToValueAtTime(9000, t + 0.6);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  n.connect(bp); bp.connect(g); g.connect(out); g.connect(rv); n.start(t); n.stop(t + 0.75);
  [2637, 3951].forEach(function (f, i) {
    var o = c.createOscillator(), og = c.createGain(); o.type = 'sine'; o.frequency.value = f;
    var s = t + 0.4 + i * 0.06;
    og.gain.setValueAtTime(0.0001, s); og.gain.exponentialRampToValueAtTime(0.07, s + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, s + 0.9);
    o.connect(og); og.connect(out); og.connect(rv); o.start(s); o.stop(s + 1);
  });
}
// Zaman çizelgesi (ms): 350 BAM · 900 holografik ışık (1000 ms) · 2700 kararma · 3100 bitti
function playIntro(done) {
  var el = document.getElementById('intro'), timers = [], ended = false;
  // v3.0.6: açılış atlanamaz — tuşlar ve dokunuşlar yutulur (oyuna da geçmez), logo sonuna kadar oynar (~3.1 sn)
  function eatKeys(e) { e.stopImmediatePropagation(); e.preventDefault(); }
  function finish() {
    if (ended) return; ended = true; HOLO.stop(); el.remove(); KK.introActive = false;
    window.removeEventListener('keydown', eatKeys, true);
    if (ctx) setTimeout(function () { try { ctx.close(); } catch (e) {} }, 1200);   // yankı kuyruğu bitsin
    if (done) done();
  }
  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
  KK.introActive = true;
  window.addEventListener('keydown', eatKeys, true);
  el.addEventListener('pointerdown', function (e) { e.stopPropagation(); e.preventDefault(); try { if (ctx && ctx.state !== 'running') ctx.resume(); } catch (er) {} });
  setTimeout(finish, 6000);   // emniyet: ne olursa olsun 6 sn'de kalkar
  HOLO.ready().catch(function () {}).then(function () {
    if (ended) return;
    at(350, function () { el.classList.add('bam'); HOLO.bam(); try { sfxBam(); } catch (e) {} });
    at(900, function () { el.classList.add('shine'); HOLO.sweep(); try { sfxShine(); } catch (e) {} });
    at(2700, function () { el.classList.add('out'); });
    at(3100, finish);
  });
}

var el0 = document.getElementById('intro');
if (!el0) return;
if (/^#(bot|nointro)$/.test(location.hash)) { el0.remove(); return; }
KK.introActive = true;
function go() {
  // Test sayfası için: tarayıcı sekmesinde ses ancak dokunuşla açılır → önce "dokun" ekranı, sonra sesli açılış
  if (KK.introTapStart) {
    var hint = document.createElement('div'); hint.textContent = 'tap to start';
    hint.style.cssText = 'position:absolute;left:0;right:0;bottom:22%;text-align:center;color:#8a8794;font:600 14px/1 Figtree,system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase';
    el0.appendChild(hint);
    el0.addEventListener('pointerdown', function (e) { e.stopPropagation(); hint.remove(); try { audio().resume(); } catch (er) {} playIntro(); }, { once: true });
    return;
  }
  playIntro();
}
if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
})();
