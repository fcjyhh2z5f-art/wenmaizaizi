/* 本地书库存储：IndexedDB 为主，localStorage 兜底。
 * 不发起任何网络请求；书库快照可完整导出为 JSON 供备份与换设备。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OfflineStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 内部存储键不是产品名：改名会让已装设备读不到原书库，故一律保留。
     只有对外交换的快照线格式换成了 wenmaizaizi-snapshot（仍兼容旧标记）。 */
  var DB_NAME = 'myhistorylib', DB_VER = 1;
  var db = null, mode = 'IndexedDB';
  var LS_KEY = 'myhistorylib:all';
  var SNAPSHOT_FORMAT = 'wenmaizaizi-snapshot';
  var LEGACY_SNAPSHOT_FORMAT = 'myhistorylib-snapshot';
  function isSnapshot(obj) {
    return !!obj && (obj.format === SNAPSHOT_FORMAT || obj.format === LEGACY_SNAPSHOT_FORMAT);
  }

  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function lsWrite(obj) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); return true; }
    catch (e) { throw new Error('本地存储空间不足，请先删掉几本书或导出快照后清理：' + e.message); }
  }

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VER); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('open failed')); };
      req.onblocked = function () { reject(new Error('blocked')); };
    });
  }

  function tx(store, mode_, fn) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, mode_), s = t.objectStore(store), r;
      try { r = fn(s); } catch (e) { reject(e); return; }
      t.oncomplete = function () { resolve(r && r.result !== undefined ? r.result : r); };
      t.onerror = function () { reject(t.error || new Error('tx failed')); };
      t.onabort = function () { reject(t.error || new Error('tx aborted')); };
    });
  }

  async function init(opts) {
    opts = opts || {};
    if (opts.storage === 'localStorage') { db = null; mode = 'localStorage'; return mode; }
    /* iOS 隐私模式 / 存储被禁用 / 部分 WebView 会让 indexedDB.open 永远不回调。
       加超时保护，避免整个界面因为等待存储而白屏。 */
    var timeout = opts.timeout || 2500;
    try {
      db = await Promise.race([
        openDB(),
        new Promise(function (_, reject) {
          setTimeout(function () { reject(new Error('IndexedDB open timeout')); }, timeout);
        })
      ]);
      mode = 'IndexedDB';
    } catch (e) { db = null; mode = 'localStorage'; }
    return mode;
  }
  function storageMode() { return mode; }

  async function books() {
    if (!db) return (lsRead().books || []).slice();
    return await tx('books', 'readonly', function (s) { return s.getAll(); }) || [];
  }
  async function saveBook(book) {
    if (!db) {
      var a = lsRead();
      a.books = (a.books || []).filter(function (b) { return b.id !== book.id; });
      a.books.push(book); lsWrite(a); return book;
    }
    return await tx('books', 'readwrite', function (s) { return s.put(book); });
  }
  async function deleteBook(id) {
    if (!db) {
      var a = lsRead();
      a.books = (a.books || []).filter(function (b) { return b.id !== id; });
      lsWrite(a); return true;
    }
    return await tx('books', 'readwrite', function (s) { return s.delete(id); });
  }
  async function replaceBooks(list) {
    if (!db) { var a = lsRead(); a.books = list || []; lsWrite(a); return; }
    await tx('books', 'readwrite', function (s) { s.clear(); (list || []).forEach(function (b) { s.put(b); }); });
  }
  async function meta(key, def) {
    if (!db) { var a = lsRead(); return (a.meta || {})[key] === undefined ? def : (a.meta || {})[key]; }
    var r = await tx('meta', 'readonly', function (s) { return s.get(key); });
    return r && r.value !== undefined ? r.value : def;
  }
  async function setMeta(key, value) {
    if (!db) { var a = lsRead(); a.meta = a.meta || {}; a.meta[key] = value; lsWrite(a); return; }
    await tx('meta', 'readwrite', function (s) { return s.put({ key: key, value: value }); });
  }
  async function variants() { return await meta('variants', null); }
  async function setVariants(v) { return await setMeta('variants', v); }
  async function settings() { return await meta('settings', { per_book: 20, context: 240 }); }
  async function setSettings(s) { return await setMeta('settings', s); }

  async function snapshot() {
    return {
      format: SNAPSHOT_FORMAT, version: 1,
      exported_at: new Date().toISOString(),
      books: await books(), variants: await variants(),
      settings: await settings()
    };
  }

  async function importSnapshot(obj, merge) {
    if (!isSnapshot(obj) || !Array.isArray(obj.books)) {
      throw new Error('不是有效的书库快照文件');
    }
    var incoming = obj.books.map(normalizeBook);
    var list = merge ? await books() : [];
    incoming.forEach(function (b) {
      list = list.filter(function (x) { return x.id !== b.id; });
      list.push(b);
    });
    await replaceBooks(list);
    if (obj.variants) await setVariants(obj.variants);
    if (obj.settings) await setSettings(obj.settings);
    return { books: incoming.length, total: list.length };
  }

  function normalizeBook(b) {
    var out = {
      id: String(b.id || ('b' + Math.random().toString(36).slice(2, 10))),
      title: String(b.title || '未命名'), code: String(b.code || 'BK'),
      author: b.author || '', publisher: b.publisher || '', year: b.year || '',
      source: b.source || '', note: b.note || '', kind: b.kind || 'text',
      pinned: !!b.pinned, created: b.created || '',
      sections: []
    };
    (b.sections || []).forEach(function (s, i) {
      out.sections.push({
        no: s.no || i + 1, title: String(s.title || '正文'),
        paras: (s.paras || []).map(function (p, j) {
          return { anchor: String(p.anchor || (out.code + '-' + ('000' + (j + 1)).slice(-4))),
                   text: String(p.text || '') };
        })
      });
    });
    return out;
  }

  return {
    init: init, storageMode: storageMode, books: books, saveBook: saveBook,
    deleteBook: deleteBook, replaceBooks: replaceBooks,
    meta: meta, setMeta: setMeta, variants: variants, setVariants: setVariants,
    settings: settings, setSettings: setSettings,
    snapshot: snapshot, importSnapshot: importSnapshot, normalizeBook: normalizeBook
  };
});
