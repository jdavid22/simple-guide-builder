/* draft.js — autosave safety net for the in-progress project.
 *
 * Persists the live project object to IndexedDB (structured clone — no
 * JSON.stringify of multi-MB base64) so a refresh, tab-close or crash never
 * loses work. Explicit Save/Load remain the source of truth; this is a net.
 *
 * Tiers, degrading gracefully and never blocking editing:
 *   A. IndexedDB full draft            (normal)
 *   B. localStorage "lite" draft       (quota/unavailable: media swapped for
 *      their filenames; restore re-asks for the files via the Locate-images flow)
 *   C. unavailable                     (status only)
 *
 * Multi-tab: last-write-wins but never silently — a tab that sees a newer write
 * from another live tab PAUSES and offers "Take over".
 *
 * Classic script -> global `Draft`.
 */
(function (global) {
  'use strict';

  var DB = 'gb-guide-builder', STORE = 'drafts', KEY = 'current';
  var LITE_KEY = 'gb.draft.lite', LITE_META = 'gb.draft.lite.meta';
  var LITE_MAX = 3.5 * 1024 * 1024;
  var DEBOUNCE = 1200, MAXWAIT = 10000;

  var opts = {};
  var db = null, dbFailed = false;
  var enabled = false;                 // gated off until the launch decision
  var rev = 0, writtenRev = 0;
  var timer = null, firstChangeAt = 0;
  var inFlight = false, again = false;
  var tabId = Math.random().toString(36).slice(2);
  var ownedSince = 0;

  // Public, read-only status snapshot.
  var api = { state: 'idle', lastSavedAt: 0, lite: false };
  // state: idle | pending | saving | saved | lite | error | unavailable | paused

  function setState(s) { api.state = s; if (opts.onStatus) opts.onStatus(api); }

  function hasLocal() { try { return !!global.localStorage; } catch (e) { return false; } }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (db) return resolve(db);
      if (dbFailed || !global.indexedDB) return reject(new Error('unavailable'));
      var req;
      try { req = global.indexedDB.open(DB, 1); } catch (e) { dbFailed = true; return reject(e); }
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'key' }); };
      req.onsuccess = function () {
        db = req.result;
        db.onversionchange = function () { try { db.close(); } catch (e) {} db = null; };
        resolve(db);
      };
      req.onerror = function () { dbFailed = true; reject(req.error || new Error('open failed')); };
      req.onblocked = function () { reject(new Error('blocked')); };
    });
  }

  function meta(project) {
    var steps = 0;
    Object.keys(project.tracks || {}).forEach(function (p) {
      var t = project.tracks[p] || {};
      steps += (t.workflow || []).length + (t.overview || []).length;
    });
    var bytes = (global.Storage && global.Storage.estimateBytes) ? global.Storage.estimateBytes(project) : 0;
    return { title: project.title || '', steps: steps, bytes: bytes };
  }

  function init(o) { opts = o || {}; }

  // Called once the launch decision is made (restored / discarded / no draft).
  function setOwned() {
    ownedSince = Date.now();
    enabled = true;
    if (api.state === 'paused') setState('idle');
  }
  function takeOver() { setOwned(); markChanged(); }

  function markChanged() {
    rev++;
    if (!enabled) return;
    if (api.state !== 'paused') setState('pending');
    schedule();
  }

  function schedule() {
    var now = Date.now();
    if (!firstChangeAt) firstChangeAt = now;
    if (timer) clearTimeout(timer);
    var wait = Math.min(DEBOUNCE, Math.max(0, MAXWAIT - (now - firstChangeAt)));
    timer = setTimeout(flush, wait);
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    firstChangeAt = 0;
    if (!enabled || rev === writtenRev || api.state === 'paused') return;
    if (inFlight) { again = true; return; }
    write();
  }

  function write() {
    var project = opts.getProject && opts.getProject();
    if (!project) return;
    var targetRev = rev;
    inFlight = true; setState('saving');
    var m = meta(project);
    var rec = { key: KEY, schema: 1, project: project, savedAt: Date.now(), tabId: tabId,
                title: m.title, steps: m.steps, bytes: m.bytes };
    openDb().then(function (d) {
      var tx = d.transaction(STORE, 'readwrite');
      var store = tx.objectStore(STORE);
      var getReq = store.get(KEY);
      getReq.onsuccess = function () {
        var prev = getReq.result;
        if (prev && prev.tabId !== tabId && prev.savedAt > ownedSince) {
          // Another live tab wrote after we took ownership: pause, don't clobber.
          try { tx.abort(); } catch (e) {}
          inFlight = false; again = false;
          setState('paused');
          return;
        }
        try { store.put(rec); } catch (e) { /* surfaces via tx.onerror */ }
      };
      tx.oncomplete = function () {
        inFlight = false;
        if (api.state !== 'paused') {
          writtenRev = targetRev; api.lastSavedAt = rec.savedAt; api.lite = false; setState('saved');
        }
        if (again) { again = false; if (rev !== writtenRev) write(); }
      };
      tx.onerror = tx.onabort = function () {
        inFlight = false;
        if (api.state === 'paused') return;
        var err = tx.error;
        if (err && /quota/i.test(err.name || '')) writeLite(project, targetRev);
        else setState('error');
      };
    }).catch(function () { writeLite(project, targetRev); });
  }

  // Tier B: text/annotations only; media replaced by their filenames.
  function writeLite(project, targetRev) {
    try {
      if (!hasLocal()) throw new Error('no localStorage');
      var json = JSON.stringify(project, function (k, v) {
        if ((k === 'src' || k === 'data') && typeof v === 'string' && v.indexOf('data:') === 0) return this.name || '';
        if (k === 'image' && typeof v === 'string' && v.indexOf('data:') === 0) return '';
        return v;
      });
      if (json.length > LITE_MAX) throw new Error('too large');
      var m = meta(project), now = Date.now();
      global.localStorage.setItem(LITE_KEY, json);
      global.localStorage.setItem(LITE_META, JSON.stringify({ savedAt: now, title: m.title, steps: m.steps, bytes: m.bytes, lite: true }));
      writtenRev = targetRev; api.lastSavedAt = now; api.lite = true; setState('lite');
    } catch (e) {
      setState((global.indexedDB || hasLocal()) ? 'error' : 'unavailable');
    }
    inFlight = false;
  }

  // Resolves to a draft record ({project} or {json, lite:true}, plus savedAt/title/steps/bytes) or null.
  function load() {
    return openDb().then(function (d) {
      return new Promise(function (resolve) {
        try {
          var req = d.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; }).then(function (rec) {
      if (rec && rec.project) return rec;
      try {
        var json = global.localStorage.getItem(LITE_KEY), mt = global.localStorage.getItem(LITE_META);
        if (json && mt) { var m = JSON.parse(mt); m.json = json; m.lite = true; return m; }
      } catch (e) {}
      return null;
    });
  }

  // Drop the draft (explicit Save / Load / New / Discard). "draft exists" <=> "unsaved work exists".
  function clear() {
    if (timer) { clearTimeout(timer); timer = null; }
    firstChangeAt = 0; again = false;
    writtenRev = rev;
    try { global.localStorage.removeItem(LITE_KEY); global.localStorage.removeItem(LITE_META); } catch (e) {}
    api.lite = false; api.lastSavedAt = 0;
    openDb().then(function (d) {
      try { d.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY); } catch (e) {}
    }).catch(function () {});
    setState('idle');
  }

  function fmtAgo(ms) {
    if (!ms) return '';
    var s = Math.round((Date.now() - ms) / 1000);
    if (s < 45) return 'just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    return 'at ' + new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  if (global.document) {
    global.document.addEventListener('visibilitychange', function () {
      if (global.document.visibilityState === 'hidden') flush();
    });
  }
  global.addEventListener('pagehide', flush);

  global.Draft = {
    init: init, load: load, markChanged: markChanged, flush: flush, clear: clear,
    setOwned: setOwned, takeOver: takeOver, fmtAgo: fmtAgo, api: api
  };
})(typeof window !== 'undefined' ? window : this);
