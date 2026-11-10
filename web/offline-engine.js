/* 文脉在兹 · 完全离线检索引擎
 * 与电脑版 engine.py 的检索语义保持一致，但 100% 在设备本地运行，无任何网络请求。
 * 浏览器：window.OfflineEngine   Node：require('./offline-engine.js')
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OfflineEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function escapeClass(s) {
    return String(s).replace(/[\\\]\-\^]/g, '\\$&');
  }

  /* 把「简⇄繁异体」对照表编译成并查集索引，避免每次检索遍历 2600+ 条 */
  function buildEquivIndex(charEquiv) {
    var parent = new Map();
    function find(x) {
      var p = parent.get(x);
      if (p === undefined) { parent.set(x, x); return x; }
      if (p !== x) { p = find(p); parent.set(x, p); }
      return p;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    }
    Object.keys(charEquiv || {}).forEach(function (k) {
      find(k);
      String(charEquiv[k] || '').split('').forEach(function (c) { union(k, c); });
    });
    var groups = new Map();
    parent.forEach(function (_, x) {
      var r = find(x);
      if (!groups.has(r)) groups.set(r, new Set());
      groups.get(r).add(x);
    });
    var index = new Map();
    groups.forEach(function (set) {
      var chars = Array.from(set);
      chars.forEach(function (c) { index.set(c, chars); });
    });
    return index;
  }

  function charPattern(ch, equivIndex) {
    var alts = equivIndex ? equivIndex.get(ch) : null;
    if (!alts || alts.length < 2) return escapeRe(ch);
    return '[' + escapeClass(alts.join('')) + ']';
  }

  function compileWord(word, variants, tolerant, equivIndex) {
    var v = tolerant ? (variants || {}) : { char_equiv: {}, words: {} };
    var words = [word].concat((v.words || {})[word] || []);
    var pats = [];
    words.forEach(function (w) {
      if (!w) return;
      var p = '';
      for (var i = 0; i < w.length; i++) p += charPattern(w[i], equivIndex);
      pats.push(p);
    });
    return '(?:' + Array.from(new Set(pats)).join('|') + ')';
  }

  function compileQuery(keywords, mode, tolerant, asRegex, variants, equivIndex) {
    if (asRegex) return { patterns: [new RegExp(keywords, 'g')], words: [keywords] };
    var list = mode === 'phrase'
      ? [String(keywords).trim()]
      : String(keywords).trim().split(/[\s,，、|]+/).filter(Boolean);
    return {
      words: list,
      patterns: list.map(function (w) {
        return new RegExp(compileWord(w, variants, tolerant, equivIndex), 'g');
      })
    };
  }

  function relaxedKeywords(keywords) {
    return String(keywords).trim().split(/[\s,，、|]+/).filter(Boolean)
      .map(function (w) { return w.length > 2 ? w.slice(0, 2) : w; })
      .join(' ');
  }

  function warnings(keywords, bookCount) {
    var out = [
      '锚点是程序按段落切分的编号，不是底本页码；正式引用前请核对纸书。',
      '片段仅用于定位，请点开锚点查看完整段落原文后再引用。',
      '导入书籍的一手／二手属性由你自行判定，程序不代为分级。'
    ];
    if (!bookCount) out.unshift('书库为空：请先在「导入」页载入书库快照或直接粘贴文本。');
    if (bookCount > 0) out.push('当前离线书库共 ' + bookCount + ' 部书；全部数据只存在这台设备上。');
    return out;
  }

  function parseRequest(text, books) {
    var s = String(text || '').trim(), notes = [];
    var bookIds = [], chapter = '', keywords = s, mode = 'or', tolerant = true;
    (books || []).forEach(function (b) {
      var name = (b.title || '').trim();
      if (name && s.indexOf(name) >= 0) {
        bookIds.push(b.id);
        keywords = keywords.split(name).join(' ');
      } else if (name && s.indexOf('《' + name + '》') >= 0) {
        bookIds.push(b.id);
        keywords = keywords.split('《' + name + '》').join(' ');
      }
    });
    if (bookIds.length) notes.push('限定书名：' + bookIds.length + ' 部');
    var m = s.match(/第\s*([0-9一二三四五六七八九十百]+)\s*[卷章节篇]/);
    if (m) { chapter = m[1]; keywords = keywords.replace(m[0], ' '); notes.push('限定章节：' + chapter); }
    if (/同时|都要|并且|全部命中|\band\b/i.test(s)) { mode = 'and'; notes.push('模式：全部词命中'); keywords = keywords.replace(/同时|都要|并且|全部命中|\band\b/gi, ' '); }
    else if (/精确|短语|原句|整句|完全匹配|\bphrase\b/i.test(s)) { mode = 'phrase'; notes.push('模式：整句短语'); keywords = keywords.replace(/精确|短语|原句|整句|完全匹配|\bphrase\b/gi, ' '); }
    if (/关闭异体|精确字形|不容错/i.test(s)) { tolerant = false; notes.push('已关闭简繁异体容错'); keywords = keywords.replace(/关闭异体|精确字形|不容错/g, ' '); }
    keywords = keywords
      .replace(/帮我|请|查一下|查查|检索|搜索|找一下|看看|有没有|怎么记载|如何记载|里|中|关于|的记载|相关史料|史料/g, ' ')
      .replace(/[，。！？、；：「」『』（）()【】《》\s]+/g, ' ')
      .trim();
    if (!keywords) keywords = s.replace(/[《》]/g, '').trim();
    return { keywords: keywords, chapter: chapter, book_ids: bookIds, mode: mode,
             tolerant: tolerant, as_regex: false, notes: notes };
  }

  function sectionMatches(sec, filter) {
    if (!filter) return true;
    var f = String(filter).trim();
    if (!f) return true;
    if (/^\d+$/.test(f) && String(sec.no || '') === f) return true;
    return String(sec.title || '').toLowerCase().indexOf(f.toLowerCase()) >= 0;
  }

  function scan(library, opts) {
    var keywords = String(opts.keywords || '').trim();
    if (!keywords) throw new Error('请输入检索词');
    var variants = opts.variants || {};
    var equivIndex = opts.tolerant === false ? null : buildEquivIndex(variants.char_equiv || {});
    var q = compileQuery(keywords, opts.mode || 'or', opts.tolerant !== false,
                         !!opts.as_regex, variants, equivIndex);
    var perBook = Math.max(1, Number(opts.per_book || 20));
    var context = Math.max(40, Number(opts.context || 160));
    var bookFilter = opts.book_ids && opts.book_ids.length ? new Set(opts.book_ids) : null;
    var started = Date.now();
    var hits = [], byBook = {}, total = 0;

    (library || []).forEach(function (b) {
      if (bookFilter && !bookFilter.has(b.id)) return;
      (b.sections || []).forEach(function (sec) {
        if (!sectionMatches(sec, opts.section)) return;
        (sec.paras || []).forEach(function (para) {
          var text = para.text || '', matched = [], count = 0, first = -1;
          q.patterns.forEach(function (pat, i) {
            pat.lastIndex = 0;
            var m, n = 0;
            while ((m = pat.exec(text)) !== null) {
              n++;
              if (first < 0 || m.index < first) first = m.index;
              if (m.index === pat.lastIndex) pat.lastIndex++;
              if (n > 2000) break;
            }
            if (n) { matched.push(q.words[i]); count += n; }
          });
          if (!count) return;
          if ((opts.mode || 'or') === 'and' && matched.length < q.patterns.length) return;
          total++;
          byBook[b.id] = (byBook[b.id] || 0) + 1;
          var a = Math.max(0, (first < 0 ? 0 : first) - Math.floor(context / 3));
          var z = Math.min(text.length, (first < 0 ? context : first) + context);
          var snippet = (a ? '…' : '') + text.slice(a, z) + (z < text.length ? '…' : '');
          hits.push({
            book_id: b.id, book_title: b.title, code: b.code || '',
            section_no: sec.no || 0, section_title: sec.title || '',
            anchor: para.anchor, text: snippet,
            cite: '《' + b.title + '》' + (sec.title || '') + '　[' + para.anchor + ']',
            score: count * 10 + matched.length * 5 + Math.min(text.length, 300) / 300,
            matched: matched
          });
        });
      });
    });
    hits.sort(function (x, y) {
      return y.score - x.score || String(x.book_title).localeCompare(String(y.book_title)) ||
             String(x.anchor).localeCompare(String(y.anchor));
    });
    var seen = {}, kept = [];
    hits.forEach(function (h) {
      if ((seen[h.book_id] || 0) >= perBook) return;
      seen[h.book_id] = (seen[h.book_id] || 0) + 1;
      kept.push(h);
    });
    return {
      keywords: keywords, mode: opts.mode || 'or', words: q.words,
      tolerant: opts.tolerant !== false, as_regex: !!opts.as_regex,
      hits: kept,
      stats: { returned: kept.length, matched_paragraphs: total,
               scanned_books: (library || []).length, by_book: byBook,
               seconds: (Date.now() - started) / 1000, total_books: (library || []).length },
      warnings: warnings(keywords, (library || []).length)
    };
  }

  function search(library, opts) {
    var o = Object.assign({}, opts);
    var r = scan(library, o);
    r.fallback = null;
    if (!r.hits.length && !o.as_regex && (o.mode || 'or') !== 'phrase') {
      var relaxed = relaxedKeywords(o.keywords);
      if (relaxed && relaxed !== o.keywords) {
        var o2 = Object.assign({}, o, { keywords: relaxed });
        var r2 = scan(library, o2);
        if (r2.hits.length) {
          r2.fallback = { from: o.keywords, to: relaxed,
                          message: '原词零命中，已透明回退到「' + relaxed + '」；这不是原词命中，请核对原文。' };
          return r2;
        }
      }
    }
    return r;
  }

  function lookup(library, anchor) {
    /* 按整本书铺平段落序列，前后段可跨章节（上一节末段 / 下一节首段）。 */
    for (var i = 0; i < (library || []).length; i++) {
      var b = library[i], seq = [];
      (b.sections || []).forEach(function (sec) {
        (sec.paras || []).forEach(function (p) { seq.push({ p: p, sec: sec }); });
      });
      var k = -1;
      for (var j = 0; j < seq.length; j++) {
        if (seq[j].p.anchor === anchor) { k = j; break; }
      }
      if (k < 0) continue;
      var x = seq[k], sec = x.sec;
      return {
        found: true, anchor: anchor, text: x.p.text || '',
        prev: k > 0 ? seq[k - 1].p.text : '',
        next: k < seq.length - 1 ? seq[k + 1].p.text : '',
        book_title: b.title, book_id: b.id, code: b.code || '',
        section_title: sec.title || '', section_no: sec.no || 0,
        author: b.author || '', source: b.source || '', note: b.note || '',
        cite: '《' + b.title + '》' + (sec.title || '') + '　[' + anchor + ']'
      };
    }
    return { found: false, anchor: anchor, text: '', cite: '' };
  }

  function citation(detail) {
    if (!detail || !detail.found) return '';
    return '《' + detail.book_title + '》' + (detail.section_title || '') +
           '　[' + detail.anchor + ']\n' + detail.text +
           '\n（据本设备离线书库，锚点为程序切分段落编号，引用前请核对纸本）';
  }

  function exportHits(library, hits, format, keywords) {
    var fmt = format || 'markdown';
    if (fmt === 'json') return JSON.stringify({ keywords: keywords, hits: hits }, null, 2);
    if (fmt === 'csv') {
      var esc = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
      return '\ufeff' + ['书名', '章节', '锚点', '命中词', '片段', '引用格式'].join(',') + '\n' +
        hits.map(function (h) {
          return [h.book_title, h.section_title, h.anchor, (h.matched || []).join(' '),
                  h.text, h.cite].map(esc).join(',');
        }).join('\n');
    }
    var lines = ['# 史料检索报告', '', '- 检索词：' + (keywords || ''),
                 '- 命中：' + hits.length + ' 条（离线书库）',
                 '- 生成时间：' + new Date().toLocaleString(), '',
                 '> 锚点为程序按段落切分的编号，非纸本页码；以下为片段，正式引用请回查完整段落并核对纸书。', ''];
    var last = '';
    hits.forEach(function (h) {
      if (h.book_title !== last) { lines.push('## 《' + h.book_title + '》', ''); last = h.book_title; }
      var d = lookup(library, h.anchor);
      lines.push('### ' + h.cite, '', d.text || h.text, '');
    });
    return lines.join('\n');
  }

  function stats(library) {
    var books = 0, sections = 0, paragraphs = 0, chars = 0;
    (library || []).forEach(function (b) {
      books++;
      (b.sections || []).forEach(function (s) {
        sections++;
        (s.paras || []).forEach(function (p) { paragraphs++; chars += (p.text || '').length; });
      });
    });
    return { books: books, sections: sections, paragraphs: paragraphs, chars: chars };
  }

  return {
    buildEquivIndex: buildEquivIndex, compileQuery: compileQuery,
    relaxedKeywords: relaxedKeywords, parseRequest: parseRequest,
    search: search, lookup: lookup, citation: citation,
    exportHits: exportHits, warnings: warnings, stats: stats,
    VERSION: '1.0.0-offline'
  };
});
