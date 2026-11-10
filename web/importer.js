/* 「文脉在兹」本机导入层（iOS / 安卓离线版共用）。
 *
 * 全部在本机完成，不上传任何文件、不发起任何网络请求。
 * 本机直读：书库快照 JSON / EPUB / FB2 / TXT / MD / CSV / 粘贴文本。
 * PDF、MOBI、AZW、AZW3(KF8)、KFX：请在电脑版导入后导出书库快照带过来
 *   —— 这些容器需要 PDF 文字层解析、PalmDB/HUFF-CDIC 解压或 Calibre 转换，
 *      由电脑版 formats.py 完成；手机端只接收已切好锚点的纯 JSON。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OfflineImporter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var HEAD = /^(?:#{1,6}\s+\S|第[一二三四五六七八九十百千零〇\d]+[卷章节篇回部]\s*\S*|(?:卷|章|篇|回)[一二三四五六七八九十百千零〇\d]+\s*\S*|[一二三四五六七八九十]+、\S)/;

  /* 与电脑版 formats.USER_FORMATS 一一对应；local 表示手机端能否本机直读 */
  var FORMATS = [
    { label: 'EPUB',        ext: '.epub',  local: true  },
    { label: 'PDF',         ext: '.pdf',   local: false },
    { label: 'MOBI',        ext: '.mobi',  local: false },
    { label: 'AZW',         ext: '.azw',   local: false },
    { label: 'AZW3 (KF8)',  ext: '.azw3',  local: false },
    { label: 'KFX',         ext: '.kfx',   local: false },
    { label: 'TXT/MD/CSV',  ext: '.txt',   local: true  },
    { label: 'FB2',         ext: '.fb2',   local: true  }
  ];

  var LOCAL_EXT = /\.(json|epub|fb2|txt|md|markdown|csv|text)$/i;
  var SNAPSHOT_ONLY = /\.(pdf|mobi|azw|azw3|kfx)$/i;
  var SNAPSHOT_FORMATS = ['wenmaizaizi-snapshot', 'myhistorylib-snapshot'];

  function clean(t) {
    return String(t || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
      .replace(/[\u00a0\u3000\t\r]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .replace(/(?<=[\u4e00-\u9fff]) +(?=[\u4e00-\u9fff])/g, '')
      .trim();
  }

  function splitLong(text, max) {
    var limit = max || 420, out = [], buf = '';
    for (var i = 0; i < text.length; i++) {
      buf += text[i];
      if (buf.length >= limit && /[。！？；;]/.test(text[i])) { out.push(buf); buf = ''; }
    }
    if (buf.trim()) out.push(buf);
    return out;
  }

  function sectionsFromText(text, chapterPattern) {
    var custom = null;
    if (chapterPattern) { try { custom = new RegExp(chapterPattern); } catch (e) { /* 忽略非法正则 */ } }
    var lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var sections = [], cur = null;

    function pushLine(s) {
      var t = clean(s);
      if (!t) return;
      if (!cur) cur = { no: sections.length + 1, title: '正文', paras: [] };
      splitLong(t).forEach(function (seg) { cur.paras.push({ text: seg }); });
    }
    function flushSection() {
      if (cur && cur.paras.length) sections.push(cur);
      cur = null;
    }
    function heading(s) {
      if (!s || s.length > 60) return false;
      if (custom && custom.test(s)) return true;
      return HEAD.test(s);
    }
    lines.forEach(function (line) {
      var s = line.trim();
      if (!s) return;                       // 空行不产生锚点
      if (heading(s)) {
        flushSection();
        cur = { no: sections.length + 1, title: clean(s.replace(/^#{1,6}\s*/, '')).slice(0, 80), paras: [] };
        return;
      }
      pushLine(s);                         // 每行一个锚点段落，与电脑版一致
    });
    flushSection();
    if (!sections.length) sections = [{ no: 1, title: '正文', paras: [] }];
    return sections;
  }

  function nextCode(books) {
    var max = 0;
    (books || []).forEach(function (b) {
      var m = /^([A-Za-z]{1,4})(\d*)$/.exec(b.code || '');
      if (m) max = Math.max(max, parseInt(m[2] || '0', 10) || 0);
      else max = Math.max(max, (books || []).length);
    });
    return 'BK' + String(max + 1).padStart(2, '0');
  }

  function makeBook(opts) {
    var text = opts.text || '', title = String(opts.title || '').trim();
    if (!title) throw new Error('请填写书名');
    var code = String(opts.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || nextCode(opts.existing || []);
    if (!/^[A-Z]{1,4}\d{0,3}$/.test(code)) throw new Error('书代码只能用 1–4 个大写字母（可跟数字），如 BK01');
    var sections = sectionsFromText(text, opts.chapter_pattern);
    var n = 0, chars = 0;
    sections.forEach(function (s) {
      s.no = s.no || 0;
      s.paras.forEach(function (p) {
        n++;
        p.anchor = code + '-' + String(n).padStart(4, '0');
        p.text = clean(p.text);
        chars += p.text.length;
      });
    });
    if (!n) throw new Error('没有提取到正文，请检查文本内容');
    return {
      id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title: title, code: code, author: opts.author || '', publisher: opts.publisher || '',
      year: opts.year || '', source: opts.source || '本机导入', note: opts.note || '',
      kind: opts.kind || 'text', pinned: false,
      created: new Date().toLocaleString(),
      sections: sections, paragraphs: n, chars: chars
    };
  }

  /* ---------------- EPUB：随包 fflate 离线解压，不联网 ---------------- */
  function fflateLib() {
    if (typeof fflate !== 'undefined') return fflate;               // 浏览器 / WebView
    if (typeof require !== 'undefined') {
      try { return require('./vendor/fflate.js'); } catch (e) { /* 继续 */ }
      try { return require('fflate'); } catch (e) { /* 继续 */ }
    }
    return null;
  }

  function htmlToLines(raw) {
    var s = String(raw || '');
    s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
         .replace(/<style[\s\S]*?<\/style>/gi, ' ')
         .replace(/<\?xml[\s\S]*?\?>/gi, ' ');
    s = s.replace(/<(h[1-6])\b[^>]*>/gi, '\n# ');
    s = s.replace(/<\/(?:h[1-6]|p|div|li|tr|blockquote|section|article)>/gi, '\n');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<[^>]+>/g, '');
    return s.split('\n').map(clean).filter(function (x) { return !!x; });
  }

  async function epubToText(file) {
    var F = fflateLib();
    if (!F) throw new Error('EPUB 解压组件缺失，请安装完整的「文脉在兹」离线包');
    var buf = await file.arrayBuffer();
    var entries;
    try { entries = F.unzipSync(new Uint8Array(buf)); }
    catch (e) { throw new Error('EPUB 解压失败，文件可能损坏或加密：' + e.message); }
    var names = Object.keys(entries);
    var dec = new TextDecoder('utf-8');
    function entry(name) {
      if (name && entries[name]) return dec.decode(entries[name]);
      var low = String(name || '').toLowerCase();
      var hit = names.find(function (n) { return n.toLowerCase() === low; });
      return hit ? dec.decode(entries[hit]) : '';
    }
    var container = entry('META-INF/container.xml');
    var rf = (/full-path\s*=\s*["']([^"']+\.opf)["']/i.exec(container) || [])[1]
          || names.find(function (n) { return /\.opf$/i.test(n); }) || '';
    var opf = entry(rf);
    var tm = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>|<title[^>]*>([\s\S]*?)<\/title>/i.exec(opf);
    var title = clean((tm && (tm[1] || tm[2])) || '');

    var manifest = {}, m, re = /<item\b[^>]*>/gi;
    while ((m = re.exec(opf))) {
      var id = (/\bid\s*=\s*["']([^"']+)["']/i.exec(m[0]) || [])[1];
      var href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0]) || [])[1];
      if (id && href) manifest[id] = href;
    }
    var spine = [], rr = /<itemref\b[^>]*>/gi;
    while ((m = rr.exec(opf))) {
      var ref = (/\bidref\s*=\s*["']([^"']+)["']/i.exec(m[0]) || [])[1];
      if (ref && manifest[ref]) spine.push(manifest[ref]);
    }
    if (!spine.length) spine = names.filter(function (n) { return /\.(?:x?html?|htm)$/i.test(n); });
    var base = rf.indexOf('/') >= 0 ? rf.replace(/\/[^/]+$/, '/') : '';
    function resolve(href) {
      var cand = base + href.replace(/^\//, '');
      if (entries[cand]) return cand;
      var fn = href.split('/').pop().toLowerCase();
      return names.find(function (n) { return n.toLowerCase().slice(-fn.length) === fn; }) || '';
    }
    var lines = [];
    if (title) lines.push('# ' + title);
    spine.forEach(function (href) {
      var n = resolve(href);
      if (!n) return;
      lines = lines.concat(htmlToLines(entry(n)));
    });
    if (lines.length < 2) throw new Error('EPUB 中未提取到正文（扫描图片版不适用）');
    return { text: lines.join('\n'), title: title };
  }

  /* ---------------- FB2：FictionBook XML，按 section/title 分章 ---------------- */
  function fb2ToText(xml) {
    var s = String(xml || '');
    var tm = /<book-title[^>]*>([\s\S]*?)<\/book-title>/i.exec(s);
    var title = clean((tm && tm[1]) || '');
    var body = s.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
    var lines = [];
    if (title) lines.push('# ' + title);
    var re = /<title\b[^>]*>([\s\S]*?)<\/title>|<subtitle\b[^>]*>([\s\S]*?)<\/subtitle>|<p\b[^>]*>([\s\S]*?)<\/p>|<v\b[^>]*>([\s\S]*?)<\/v>/gi;
    var m;
    while ((m = re.exec(body))) {
      var t = clean(m[1] || m[2] || m[3] || m[4] || '');
      if (!t) continue;
      lines.push((m[1] || m[2]) ? '# ' + t : t);
    }
    if (lines.length < 2) throw new Error('FB2 中未提取到正文');
    return { text: lines.join('\n'), title: title };
  }

  async function readFile(file) {
    var name = (file && file.name) || '';
    var lower = name.toLowerCase();
    var stem = name.replace(/\.[^.]+$/, '');
    if (/\.json$/i.test(lower)) {
      var txt = await file.text();
      var obj = JSON.parse(txt);
      if (!obj || SNAPSHOT_FORMATS.indexOf(obj.format) < 0) {
        throw new Error('JSON 不是书库快照（应为电脑版「导出手机书库快照」生成的文件）');
      }
      return { type: 'snapshot', data: obj, name: name };
    }
    if (/\.epub$/i.test(lower)) {
      var ep = await epubToText(file);
      return { type: 'text', data: ep.text, name: ep.title || stem, kind: 'epub' };
    }
    if (/\.fb2$/i.test(lower)) {
      var fb = fb2ToText(await file.text());
      return { type: 'text', data: fb.text, name: fb.title || stem, kind: 'fb2' };
    }
    if (SNAPSHOT_ONLY.test(lower)) {
      throw new Error(
        (name.split('.').pop() || '').toUpperCase() +
        ' 由电脑版解析更稳妥：请在「文脉在兹」电脑版导入这本书，'
        + '再到「我的书库与设置 → 导出手机书库快照」，把 JSON 传到手机后在这里选取。'
        + '手机端本机可直接导入 EPUB / FB2 / TXT / MD / CSV。');
    }
    if (/\.(txt|md|markdown|csv|text)$/i.test(lower)) {
      return { type: 'text', data: await file.text(), name: stem };
    }
    throw new Error('不支持的文件类型：' + name
      + '。可导入 EPUB / FB2 / TXT / MD / CSV / 书库快照 JSON。');
  }

  return { FORMATS: FORMATS, LOCAL_EXT: LOCAL_EXT, SNAPSHOT_ONLY: SNAPSHOT_ONLY,
           SNAPSHOT_FORMATS: SNAPSHOT_FORMATS,
           clean: clean, splitLong: splitLong, sectionsFromText: sectionsFromText,
           nextCode: nextCode, makeBook: makeBook, readFile: readFile,
           htmlToLines: htmlToLines, fb2ToText: fb2ToText, epubToText: epubToText };
});
