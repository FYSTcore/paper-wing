/* Paper Wing — çevrimiçi skor tablosu (KK.Online), v2.5
 * Firebase'in SDK'sı yerine doğrudan REST: anonim giriş (Identity Toolkit) + Firestore.
 * Firestore kuralları (Halil'in konsolunda): herkes okur; herkes SADECE kendi belgesini (uid) yazar,
 * sadece yükselterek ve süresine göre mümkünse (kule ≤ 1.1·saniye + 5).
 * Yapı:  alltime/{uid}                 → { name, score, run, secs, stars, skin }
 *        weekly/{2026-W42}/scores/{uid} → aynı alanlar (her pazartesi yeni hafta)
 * İnternet yoksa skor kuyrukta bekler, bir sonraki fırsatta gönderilir.
 */
window.KK = window.KK || {};
(function () {
  'use strict';
  // ---- Halil'in Firebase projesi (Project settings → Your apps → Web). Boşsa çevrimiçi tablo kapalı. ----
  var CFG = { apiKey: 'AIzaSyCW8EidQK9GIdD8DEAUxVsfkelcSXHl-ew', projectId: 'paperwing-44f85' };   // web anahtarı gizli değildir; güvenliği Firestore kuralları sağlar

  // Test sürümü ayrı koleksiyonlara yazar (gerçek tabloyu kirletmesin)
  var PFX = KK.TEST_BUILD ? 'test_' : '';
  var LS = { auth: 'kk.fb.auth', name: 'kk.name', best: 'kk.fb.best', week: 'kk.fb.week', queue: 'kk.fb.queue' };
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* yoksay */ } }
  function getJ(k) { try { return JSON.parse(get(k) || 'null'); } catch (e) { return null; } }
  function enabled() { return !!(CFG.apiKey && CFG.projectId && window.fetch); }

  // ISO hafta kimliği (pazartesi başlar, cihazın saatine göre): 2026-W42
  function weekId(d) {
    d = d ? new Date(d) : new Date();
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
    var y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    var w = Math.ceil(((t - y0) / 86400000 + 1) / 7);
    return t.getUTCFullYear() + '-W' + (w < 10 ? '0' : '') + w;
  }

  // ---- Anonim giriş: kimlik telefonda saklanır (refreshToken), idToken 1 saat geçerli ----
  var tok = null, tokExp = 0;
  function authed() {
    if (tok && Date.now() < tokExp - 60000) return Promise.resolve(tok);
    var a = getJ(LS.auth);
    var req = a && a.refresh
      ? fetch('https://securetoken.googleapis.com/v1/token?key=' + CFG.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(a.refresh) }).then(function (r) { if (!r.ok) throw new Error('refresh ' + r.status); return r.json(); })
          .then(function (j) { return { idToken: j.id_token, refreshToken: j.refresh_token, localId: j.user_id, expiresIn: j.expires_in }; })
      : fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + CFG.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"returnSecureToken":true}' })
          .then(function (r) { if (!r.ok) throw new Error('signup ' + r.status); return r.json(); });
    return req.then(function (j) {
      tok = { id: j.idToken, uid: j.localId }; tokExp = Date.now() + (+j.expiresIn || 3600) * 1000;
      set(LS.auth, JSON.stringify({ refresh: j.refreshToken, uid: j.localId }));
      return tok;
    });
  }
  function uid() { var a = getJ(LS.auth); return a && a.uid; }

  var BASE = function () { return 'https://firestore.googleapis.com/v1/projects/' + CFG.projectId + '/databases/(default)/documents'; };
  function fields(e) {
    return { name: { stringValue: e.name }, score: { integerValue: String(e.score) }, run: { integerValue: String(e.run) },
      secs: { doubleValue: Math.round(e.secs * 10) / 10 }, stars: { integerValue: String(e.stars) }, skin: { stringValue: String(e.skin || '').slice(0, 20) } };
  }
  function put(path, e, t) {
    return fetch(BASE() + '/' + path, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t.id },
      body: JSON.stringify({ fields: fields(e) }) }).then(function (r) { if (!r.ok) throw new Error('write ' + r.status); return true; });
  }

  // ---- Skor gönder: sadece kendi tüm zamanlar / haftalık rekorunu kırınca. Başarısızsa kuyrukta bekler. ----
  // e = { score, run, secs, stars, skin }
  function submit(e) {
    if (!enabled() || !(e.score > 0) || !(e.run > 0)) return Promise.resolve(false);
    var name = get(LS.name); if (!name) { queueBest(e); return Promise.resolve(false); }
    e.name = name;
    var wk = weekId(), best = +get(LS.best) || 0, w = getJ(LS.week) || {};
    var doAll = e.score > best, doWeek = !(w.id === wk && w.best >= e.score);
    if (!doAll && !doWeek) return Promise.resolve(false);
    return authed().then(function (t) {
      var jobs = [];
      if (doAll) jobs.push(put(PFX + 'alltime/' + t.uid, e, t).then(function () { set(LS.best, String(e.score)); }));
      if (doWeek) jobs.push(put(PFX + 'weekly/' + wk + '/scores/' + t.uid, e, t).then(function () { set(LS.week, JSON.stringify({ id: wk, best: e.score })); }));
      return Promise.all(jobs);
    }).then(function () { clearQueue(e); return true; }, function () { queueBest(e); return false; });
  }
  function queueBest(e) { var q = getJ(LS.queue); if (!q || e.score > q.score) set(LS.queue, JSON.stringify({ score: e.score, run: e.run, secs: e.secs, stars: e.stars, skin: e.skin, wk: weekId() })); }
  function clearQueue(e) { var q = getJ(LS.queue); if (q && q.score <= e.score) set(LS.queue, null); }
  function flush() { var q = getJ(LS.queue); if (q && get(LS.name)) { if (q.wk !== weekId()) set(LS.week, null); return submit(q); } return Promise.resolve(false); }

  // İsim değişince: kayıtlı rekorlar yeni isimle yeniden yazılır (kurallar aynı skorla isim değişikliğine izin verir)
  function setName(n) {
    n = String(n || '').replace(/[^\w .\-ğüşıöçĞÜŞİÖÇ]/g, '').trim().slice(0, 14);
    if (!n) return Promise.resolve(false);
    var old = get(LS.name); set(LS.name, n);
    if (!enabled() || old === n) return flush();
    var best = +get(LS.best) || 0;
    if (!best) return flush();
    return top('alltime').then(function (list) {   // kendi belgemizi bul, isimle yeniden yaz
      var me = list.filter(function (x) { return x.me; })[0];
      if (!me) return flush();
      return authed().then(function (t) { return put(PFX + 'alltime/' + t.uid, { name: n, score: me.score, run: me.run, secs: me.secs, stars: me.stars, skin: me.skin }, t); });
    }).then(flush, function () { return false; });
  }

  // ---- İlk 20 ----  which: 'week' | 'alltime'
  function top(which, n) {
    if (!enabled()) return Promise.reject(new Error('off'));
    var parent = which === 'week' ? BASE() + '/' + PFX + 'weekly/' + weekId() : BASE();
    var q = { structuredQuery: { from: [{ collectionId: which === 'week' ? 'scores' : PFX + 'alltime' }],
      orderBy: [{ field: { fieldPath: 'score' }, direction: 'DESCENDING' }], limit: n || 20 } };
    var me = uid();
    return fetch(parent + ':runQuery?key=' + CFG.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) })
      .then(function (r) { if (!r.ok) throw new Error('read ' + r.status); return r.json(); })
      .then(function (rows) {
        return rows.filter(function (r) { return r.document; }).map(function (r) {
          var f = r.document.fields || {}, id = r.document.name.split('/').pop();
          var num = function (k) { var v = f[k]; return v ? +(v.integerValue || v.doubleValue || 0) : 0; };
          return { name: (f.name && f.name.stringValue) || '?', score: num('score'), run: num('run'), secs: num('secs'), stars: num('stars'),
            skin: (f.skin && f.skin.stringValue) || '', me: id === me };
        });
      });
  }

  KK.Online = { enabled: enabled, submit: submit, flush: flush, top: top, setName: setName, name: function () { return get(LS.name); },
    weekId: weekId, config: CFG };
})();
