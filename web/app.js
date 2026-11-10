/* 文脉在兹 · 离线版 UI (iOS / Android)
 * 全部数据来自本机 Store / Engine / Importer，没有任何 fetch / XHR / 远程资源。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var E = window.OfflineEngine, ST = window.OfflineStore, IM = window.OfflineImporter;
  var S = {
    books: [], variants: {}, settings: { per_book: 20, context: 240 },
    result: null, detail: null, mode: 'or', importKind: 'file',
    pickedFile: null, page: 'search'
  };
  var PAGE_TITLE = { search: '检索史料', import: '导入底本', library: '我的书库', settings: '设置' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('on'); }, 2300);
  }
  function log(msg) {
    var box = $('logBox');
    box.textContent += (box.textContent && !/\n$/.test(box.textContent) ? '\n' : '') + msg;
    box.scrollTop = box.scrollHeight;
  }
  function highlight(text, words) {
    var out = esc(text);
    (words || []).forEach(function (w) {
      if (!w) return;
      try {
        var re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        out = out.replace(re, function (m) { return '<mark>' + m + '</mark>'; });
      } catch (e) { /* 忽略异常词 */ }
    });
    return out;
  }
  function download(name, content, mime) {
    var blob = new Blob([content], { type: mime || 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1200);
  }
  async function copy(text) {
    if (!text) { toast('没有可复制的内容'); return; }
    try { await navigator.clipboard.writeText(text); toast('已复制'); }
    catch (e) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('已复制'); } catch (e2) { toast('复制失败，请长按选择'); }
      ta.remove();
    }
  }

  /* ---------------- 初始化与书库状态 ---------------- */
  async function init() {
    /* ?storage=local 仅用于预览与自检：强制走 localStorage 后端 */
    var qs = new URLSearchParams(location.search);
    await ST.init(qs.get('storage') === 'local' ? { storage: 'localStorage' } : {});
    var v = await ST.variants();
    if (!v || !v.char_equiv) {
      v = window.BUILTIN_VARIANTS || { char_equiv: {}, words: {} };
      await ST.setVariants(v);
    }
    S.variants = v;
    S.settings = await ST.settings();
    $('perBook').value = S.settings.per_book || 20;
    $('context').value = S.settings.context || 240;
    bind();
    await refresh();
    applyDeepLink();
  }

  async function refresh() {
    S.books = await ST.books();
    var st = E.stats(S.books);
    $('statusText').textContent = '离线就绪 · ' + st.books + ' 部书';
    $('libStat').innerHTML = '本机书库：<b>' + st.books + '</b> 部书 / <b>' + st.sections +
      '</b> 节 / <b>' + st.paragraphs.toLocaleString() + '</b> 段 / <b>' +
      st.chars.toLocaleString() + '</b> 字';
    $('emptyCard').classList.toggle('hidden', st.books > 0);
    $('statusKv').innerHTML =
      '存储方式：<b>' + esc(ST.storageMode()) + '</b><br>' +
      '检索引擎：<b>offline-engine.js v' + esc(E.VERSION) + '</b><br>' +
      '简繁对照：<b>' + Object.keys(S.variants.char_equiv || {}).length + '</b> 条（随程序分发）<br>' +
      '网络请求：<b>0 个</b> · 不需要电脑开机<br>' +
      '书库：<b>' + st.books + '</b> 部 / <b>' + st.paragraphs + '</b> 个锚点';
    $('variantInfo').textContent = '已载入 ' + Object.keys(S.variants.char_equiv || {}).length +
      ' 条简繁异体对照与 ' + Object.keys(S.variants.words || {}).length + ' 组同义词。';
    var sel = $('bookSel'), cur = sel.value;
    sel.innerHTML = '<option value="">全部书籍</option>' + S.books.map(function (b) {
      return '<option value="' + esc(b.id) + '">《' + esc(b.title) + '》</option>';
    }).join('');
    if (cur) sel.value = cur;
    renderLibrary();
  }

  function renderLibrary() {
    var box = $('libList');
    if (!S.books.length) {
      box.innerHTML = '<div class="empty">书库还是空的。到「导入」页载入快照或粘贴一段史料。</div>';
      return;
    }
    var list = S.books.slice().sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0); });
    box.innerHTML = list.map(function (b) {
      var st = E.stats([b]);
      return '<div class="lib" data-id="' + esc(b.id) + '">' +
        '<div class="lib-name">《' + esc(b.title) + '》' +
          '<span class="badge core">' + esc(b.code) + '</span>' +
          (b.pinned ? '<span class="badge good">置顶</span>' : '') + '</div>' +
        '<div class="lib-path">' + st.sections + ' 节 / ' + st.paragraphs + ' 段 / ' +
          st.chars.toLocaleString() + ' 字 · ' + esc(b.author || '著者未填') +
          (b.note ? ' · ' + esc(b.note) : '') + '</div>' +
        '<div class="lib-actions">' +
          '<button class="btn btn-soft btn-sm" data-act="pin">' + (b.pinned ? '取消置顶' : '置顶') + '</button>' +
          '<button class="btn btn-soft btn-sm" data-act="edit">编辑信息</button>' +
          '<button class="btn btn-soft btn-sm btn-danger" data-act="del">删除</button>' +
        '</div></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.lib'), function (node) {
      node.addEventListener('click', async function (ev) {
        var btn = ev.target.closest('button'); if (!btn) return;
        var id = node.getAttribute('data-id'), act = btn.getAttribute('data-act');
        var book = S.books.filter(function (x) { return x.id === id; })[0];
        if (!book) return;
        if (act === 'pin') { book.pinned = !book.pinned; await ST.saveBook(book); await refresh(); }
        else if (act === 'del') {
          if (!confirm('确定删除《' + book.title + '》？此操作不可撤销，建议先导出快照。')) return;
          await ST.deleteBook(id); await refresh(); toast('已删除');
        } else if (act === 'edit') {
          var t = prompt('书名', book.title); if (t === null) return;
          var a = prompt('著者', book.author || ''); if (a === null) return;
          var n = prompt('备注（版本／一手二手）', book.note || ''); if (n === null) return;
          book.title = t.trim() || book.title; book.author = a; book.note = n;
          await ST.saveBook(book); await refresh(); toast('已保存');
        }
      });
    });
  }

  /* ---------------- 检索 ---------------- */
  function searchOpts(kw) {
    var bid = $('bookSel').value;
    return {
      keywords: kw, mode: S.mode,
      tolerant: $('tolerant').checked, as_regex: $('regexMode').checked,
      book_ids: bid ? [bid] : [], section: $('section').value.trim(),
      per_book: parseInt($('perBook').value, 10) || 20,
      context: parseInt($('context').value, 10) || 240,
      variants: S.variants
    };
  }
  function doParse(alsoSearch) {
    var text = $('reqText').value.trim();
    if (!text) { toast('请先写一句话需求'); return; }
    var r = E.parseRequest(text, S.books);
    $('kw').value = r.keywords;
    $('section').value = r.chapter || '';
    $('tolerant').checked = r.tolerant !== false;
    $('bookSel').value = r.book_ids.length ? r.book_ids[0] : '';
    S.mode = r.mode;
    Array.prototype.forEach.call($('modeSeg').querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-v') === r.mode);
    });
    var n = $('parseNotes');
    n.innerHTML = (r.notes.length ? r.notes : ['未识别到限定条件，按普通关键词检索'])
      .map(function (x) { return '<div>· ' + esc(x) + '</div>'; }).join('') +
      '<div>· 提取关键词：<b>' + esc(r.keywords) + '</b>（可在下方修改）</div>';
    n.classList.remove('hidden');
    if (alsoSearch) doSearch(); else toast('已解析，可修改条件后检索');
  }
  function doSearch() {
    var kw = $('kw').value.trim();
    if (!kw) { toast('请输入检索词'); return; }
    try {
      var r = E.search(S.books, searchOpts(kw));
      S.result = r; renderResults(r);
    } catch (e) { toast('检索失败：' + e.message); }
  }
  function renderResults(r) {
    var bar = $('statbar');
    bar.innerHTML = '检索「<b>' + esc(r.keywords) + '</b>」· 命中 <b>' + r.stats.returned +
      '</b> 条 / 共 <b>' + r.stats.matched_paragraphs + '</b> 段 · 扫描 ' +
      r.stats.scanned_books + ' 部书 · ' + r.stats.seconds.toFixed(2) + ' 秒（本机）';
    bar.classList.remove('hidden');
    $('warnings').innerHTML = (r.warnings || []).map(function (w) {
      return '<div>' + esc(w) + '</div>';
    }).join('') + (r.fallback ? '<div>' + esc(r.fallback.message) + '</div>' : '');
    var box = $('results');
    if (!r.hits.length) {
      box.innerHTML = '<div class="empty">没有命中。换个词、关闭章节限定，或到「导入」页补充底本。</div>';
      $('exportRow').style.display = 'none'; return;
    }
    var groups = {}, order = [];
    r.hits.forEach(function (h) {
      if (!groups[h.book_title]) { groups[h.book_title] = []; order.push(h.book_title); }
      groups[h.book_title].push(h);
    });
    box.innerHTML = order.map(function (name) {
      return '<div class="group"><span class="g-name">《' + esc(name) + '》</span>' +
        '<span class="g-count">' + groups[name].length + ' 条</span></div>' +
        groups[name].map(function (h) {
          return '<div class="hit" data-anchor="' + esc(h.anchor) + '">' +
            '<div class="hit-top"><span class="hit-cite">' + esc(h.cite) + '</span>' +
            '<span class="anchor">' + esc(h.anchor) + '</span></div>' +
            '<div class="hit-extra">' + esc(h.section_title || '') +
              (h.matched && h.matched.length ? ' · 命中 ' + esc(h.matched.join('、')) : '') + '</div>' +
            '<div class="hit-text">' + highlight(h.text, r.words) + '</div></div>';
        }).join('');
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.hit'), function (n) {
      n.addEventListener('click', function () { openDetail(n.getAttribute('data-anchor')); });
    });
    $('exportRow').style.display = 'flex';
  }
  function openDetail(anchor) {
    var d = E.lookup(S.books, anchor);
    S.detail = d;
    $('sheetBody').innerHTML = d.found
      ? '<div class="detail-cite">' + esc(d.cite) + '</div>' +
        '<div class="detail-tip">以下为完整段落原文与相邻段落；锚点是程序切分编号，不是纸本页码。</div>' +
        (d.prev ? '<div class="detail-ctx">上一段：' + esc(d.prev) + '</div>' : '') +
        '<div class="detail-body">' + esc(d.text) + '</div>' +
        (d.next ? '<div class="detail-ctx">下一段：' + esc(d.next) + '</div>' : '') +
        '<div class="detail-src">底本：《' + esc(d.book_title) + '》· ' + esc(d.section_title || '') +
          ' | 著者：' + esc(d.author || '未填') + ' | 来源：' + esc(d.source || '本机导入') +
          (d.note ? ' | 备注：' + esc(d.note) : '') + '</div>'
      : '<div class="empty">未找到该锚点，书库可能已被修改。</div>';
    $('sheet').classList.add('on'); $('backdrop').classList.add('on');
  }
  function closeSheet() { $('sheet').classList.remove('on'); $('backdrop').classList.remove('on'); }

  /* ---------------- 导入 ---------------- */
  async function doImport() {
    log('────────────────────────────');
    try {
      if (S.importKind === 'file') {
        if (!S.pickedFile) { toast('请先选择文件'); return; }
        var parsed = await IM.readFile(S.pickedFile);
        if (parsed.type === 'snapshot') {
          log('▶ 载入书库快照：' + S.pickedFile.name);
          var r = await ST.importSnapshot(parsed.data, true);
          log('✔ 已合并 ' + r.books + ' 部书，当前共 ' + r.total + ' 部');
          log('  快照导出时间：' + (parsed.data.exported_at || '未知'));
        } else {
          var title = $('title').value.trim() || parsed.name;
          log('▶ 导入文本：' + title + '（' + S.pickedFile.name + '）');
          var book = IM.makeBook({
            text: parsed.data, title: title, code: $('code').value,
            kind: parsed.kind, author: $('author').value, year: $('year').value,
            publisher: $('publisher').value, note: $('note').value,
            chapter_pattern: $('pattern').value, existing: S.books
          });
          await ST.saveBook(book);
          log('✔ 生成 ' + book.sections.length + ' 节 / ' + book.paragraphs +
              ' 个锚点 / ' + book.chars + ' 字，代码 ' + book.code);
        }
      } else {
        var text = $('pasteText').value;
        if (!text.trim()) { toast('粘贴的文本为空'); return; }
        var t2 = $('title').value.trim();
        if (!t2) { toast('粘贴导入请填写书名'); return; }
        log('▶ 导入粘贴文本：' + t2);
        var b2 = IM.makeBook({
          text: text, title: t2, code: $('code').value,
          author: $('author').value, year: $('year').value,
          publisher: $('publisher').value, note: $('note').value,
          chapter_pattern: $('pattern').value, existing: S.books
        });
        await ST.saveBook(b2);
        log('✔ 生成 ' + b2.sections.length + ' 节 / ' + b2.paragraphs + ' 个锚点，代码 ' + b2.code);
      }
      await ST.setSettings({ per_book: parseInt($('perBook').value, 10) || 20,
                             context: parseInt($('context').value, 10) || 240 });
      await refresh();
      log('✔ 完成。回到「检索」页即可查到，全程未联网。');
      toast('导入成功');
    } catch (e) { log('✖ 导入失败：' + e.message); toast('导入失败：' + e.message); }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.addEventListener('click', function () { showPage(tab.getAttribute('data-page')); });
    });
    $('btnStatus').addEventListener('click', function () {
      toast(ST.storageMode() + ' · ' + E.stats(S.books).books + ' 部书 · 0 个网络请求');
    });
    $('modeSeg').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      S.mode = b.getAttribute('data-v');
      Array.prototype.forEach.call($('modeSeg').querySelectorAll('button'), function (x) {
        x.classList.toggle('on', x === b);
      });
    });
    $('importSeg').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      S.importKind = b.getAttribute('data-v');
      Array.prototype.forEach.call($('importSeg').querySelectorAll('button'), function (x) {
        x.classList.toggle('on', x === b);
      });
      $('importFile').classList.toggle('hidden', S.importKind !== 'file');
      $('importText').classList.toggle('hidden', S.importKind !== 'text');
    });
    $('btnPick').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function () {
      S.pickedFile = $('fileInput').files[0] || null;
      $('fileName').textContent = S.pickedFile ? S.pickedFile.name +
        '（' + Math.round(S.pickedFile.size / 1024) + ' KB）' : '尚未选择文件';
      if (S.pickedFile && !$('title').value.trim() && /\.(txt|md|csv|markdown)$/i.test(S.pickedFile.name)) {
        $('title').value = S.pickedFile.name.replace(/\.[^.]+$/, '');
      }
    });
    $('btnParse').addEventListener('click', function () { doParse(false); });
    $('btnParseSearch').addEventListener('click', function () { doParse(true); });
    $('btnSearch').addEventListener('click', doSearch);
    $('kw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
    $('btnImport').addEventListener('click', doImport);
    $('btnSheetClose').addEventListener('click', closeSheet);
    $('backdrop').addEventListener('click', closeSheet);
    $('btnCopyCite').addEventListener('click', function () { copy(E.citation(S.detail)); });
    $('btnCopyText').addEventListener('click', function () { copy(S.detail && S.detail.text); });
    $('btnShare').addEventListener('click', async function () {
      var t = E.citation(S.detail);
      if (!t) { toast('请先回查原文'); return; }
      if (navigator.share) {
        try { await navigator.share({ title: '史料引文', text: t }); } catch (e) { /* 用户取消 */ }
      } else { copy(t); }
    });
    $('btnExport').addEventListener('click', function () {
      if (!S.result) return;
      var md = E.exportHits(S.books, S.result.hits, 'markdown', S.result.keywords);
      download('report.md', md, 'text/markdown;charset=utf-8');
      toast('报告已导出');
    });
    $('btnFetchAll').addEventListener('click', function () {
      if (!S.result) return;
      var lines = S.result.hits.map(function (h) {
        var d = E.lookup(S.books, h.anchor);
        return d.cite + '\n' + d.text + '\n';
      });
      download('fulltext.txt', lines.join('\n'), 'text/plain;charset=utf-8');
      toast('已取回 ' + lines.length + ' 段完整原文');
    });
    $('btnBackup').addEventListener('click', async function () {
      var snap = await ST.snapshot();
      download('文脉在兹_书库快照.json', JSON.stringify(snap));
      toast('快照已导出，请存到「文件」App');
    });
    $('btnPickRestore').addEventListener('click', function () { $('restoreFile').click(); });
    $('restoreFile').addEventListener('change', async function () {
      var f = $('restoreFile').files[0]; if (!f) return;
      var box = $('restoreLog'); box.classList.remove('hidden');
      try {
        var obj = JSON.parse(await f.text());
        var r = await ST.importSnapshot(obj, true);
        box.textContent = '✔ 已合并 ' + r.books + ' 部书，当前共 ' + r.total + ' 部';
        await refresh(); toast('快照已导入');
      } catch (e) { box.textContent = '✖ ' + e.message; } finally { $('restoreFile').value = ''; }
    });
    $('btnVariantEdit').addEventListener('click', function () {
      $('variantText').classList.toggle('hidden');
      $('variantText').value = JSON.stringify(S.variants, null, 2);
    });
    $('btnVariantSave').addEventListener('click', async function () {
      try {
        var v = JSON.parse($('variantText').value);
        if (!v.char_equiv) throw new Error('缺少 char_equiv');
        S.variants = v; await ST.setVariants(v); await refresh(); toast('对照表已保存');
      } catch (e) { toast('JSON 有误：' + e.message); }
    });
    if ('serviceWorker' in navigator &&
        (location.protocol === 'https:' || location.hostname === 'localhost' ||
         location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    }
  }

  function showPage(name) {
    S.page = name;
    Array.prototype.forEach.call(document.querySelectorAll('.page'), function (p) {
      p.classList.toggle('active', p.id === 'page-' + name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('on', t.getAttribute('data-page') === name);
    });
    $('pageTitle').textContent = PAGE_TITLE[name] || '文脉在兹';
    window.scrollTo(0, 0);
  }

  function applyDeepLink() {
    var qs = new URLSearchParams(location.search);
    var page = qs.get('page');
    if (page && PAGE_TITLE[page]) showPage(page);
    var req = qs.get('req'), q = qs.get('q');
    if (req) { $('reqText').value = req; doParse(true); }
    else if (q) { $('kw').value = q; doSearch(); }
    if (req || q) {
      setTimeout(function () {
        var bar = $('statbar');
        if (bar) window.scrollTo(0, Math.max(0, bar.getBoundingClientRect().top + window.scrollY - 96));
      }, 350);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
