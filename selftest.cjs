/* 「文脉在兹」iOS 离线版自检：node selftest.cjs
 * 覆盖引擎、文本导入、快照往返、EPUB/FB2 本机直读、离线约束、
 * 8 类格式清单、三端命名与图标同源。全程不需要网络与浏览器。
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const WEB = path.join(HERE, 'web');
const AND = path.join(HERE, '..', 'HistoryAndroid');
const DESK = path.join(HERE, '..', 'HistoryStandalone');
/* 交付 zip 解压到任意目录时，同级电脑版 / 安卓版工程并不随包附带：
   这些跨端同源断言应优雅跳过，而不是让自检崩溃。 */
const SIBLINGS = fs.existsSync(path.join(DESK, 'engine.py')) &&
                 fs.existsSync(path.join(AND, 'web'));
let skipped = 0;
function skip(name) {
  skipped++;
  console.log('  SKIP ' + name + '（解压包未附带同级电脑/安卓工程）');
}
const E = require(path.join(WEB, 'offline-engine.js'));
const IM = require(path.join(WEB, 'importer.js'));
let pass = 0, fail = 0;
function check(ok, name, extra) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' | ' + JSON.stringify(extra) : '')); }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }
function sha(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12); }
function has(p) { return fs.existsSync(p); }

const variants = JSON.parse(read(path.join(WEB, 'variants.json')));
const text = [
  '# 卷一 田赋',
  '唐初定租庸調之法，凡授田之丁，歲輸粟二石，謂之租。',
  '每丁歲役二旬，不役則收其庸，日三尺。',
  '浮收米羨之弊，晚清州縣多有之。',
  '',
  '# 卷二 兵制',
  '府兵之制，起於西魏，立於周隋，備於唐。',
  '調發有制，番上有時。'
].join('\n');

console.log('='.repeat(64));
console.log('  文脉在兹 · iOS 离线版自检');
console.log('='.repeat(64));

console.log('\n[1] 文本导入与锚点');
const book = IM.makeBook({ text, title: '測試史料彙編', code: 'TST', existing: [], author: '佚名' });
check(book.sections.length === 2, '按 # 标题分成 2 节', book.sections.length);
check(book.paragraphs >= 5, '生成多个段落锚点', book.paragraphs);
check(book.sections[0].paras[0].anchor === 'TST-0001', '锚点从 0001 连续');
const allText = book.sections.flatMap(s => s.paras.map(p => p.text)).join('\n');
check(allText.includes('，') && allText.includes('。'), '全角标点原样保留，未篡改引文');
check(!allText.includes('script'), '无脚本内容混入');

console.log('\n[2] 检索引擎');
const lib = [book];
function srch(kw, opts) {
  return E.search(lib, Object.assign({ keywords: kw, mode: 'or', tolerant: true,
    per_book: 20, context: 160, variants }, opts || {}));
}
let r = srch('租庸调');
check(r.hits.length > 0, '简搜繁：租庸调 → 租庸調', r.hits.length);
r = srch('租庸調');
check(r.hits.length > 0, '繁搜繁：租庸調');
r = srch('州县');
check(r.hits.length > 0, '简搜繁：州县 → 州縣');
r = srch('米羡');
check(r.hits.length > 0, '简搜繁：米羡 → 米羨');
r = srch('浮收 府兵');
check(r.hits.length >= 2, 'or 模式多词命中', r.hits.length);
r = srch('浮收 府兵', { mode: 'and' });
check(r.hits.length === 0, 'and 模式要求同段全命中');
r = srch('府兵之制', { mode: 'phrase' });
check(r.hits.length > 0, 'phrase 整句短语命中');
r = srch('府兵制');
check(r.hits.length > 0 && !r.fallback, '词表变体：府兵制 → 府兵之制（正常命中，不误报回退）');
r = srch('府兵制度');
check(r.hits.length > 0 && !!r.fallback, '零结果透明回退二字词干并标注', r.fallback);
check(r.fallback && /回退/.test(r.fallback.message), '回退提示明确说明不是原词命中');
r = srch('完全不存在的词');
check(r.hits.length === 0 && !r.fallback, '真正无结果时不谎报命中');
r = srch('府兵', { section: '2' });
check(r.hits.length > 0 && r.hits.every(h => h.section_no === 2), '章节过滤生效');
r = srch('府兵', { tolerant: false });
check(r.hits.length > 0, '关闭异体容错仍可检索本字');
r = srch('府兵', { book_ids: ['nope'] });
check(r.hits.length === 0, '按书过滤生效');

console.log('\n[3] 锚点回查与导出');
r = srch('府兵之制');
const anchor = r.hits[0].anchor;
const d = E.lookup(lib, anchor);
check(d.found === true, '锚点可回查');
check(d.text === '府兵之制，起於西魏，立於周隋，備於唐。', '回查返回完整段落原文且保留全角标点', d.text);
check(d.prev.length > 0 && d.next.length > 0, '同时返回前后相邻段落');
check(/《測試史料彙編》/.test(d.cite) && d.cite.includes(anchor), '引用格式含书名与锚点');
check(E.citation(d).includes(d.text), '复制引用包含原文');
const md = E.exportHits(lib, r.hits, 'markdown', '府兵之制');
check(md.includes('# 史料检索报告') && md.includes(d.text), '导出 Markdown 含完整原文');
check(E.exportHits(lib, r.hits, 'csv', 'x').includes('书名'), '导出 CSV 含表头');
check(JSON.parse(E.exportHits(lib, r.hits, 'json', 'x')).hits.length === r.hits.length, '导出 JSON 结构完整');
check(E.stats(lib).books === 1 && E.stats(lib).paragraphs === book.paragraphs, '统计正确');

console.log('\n[4] 需求解析');
const p = E.parseRequest('帮我查一下《測試史料彙編》第2卷 府兵制 怎么记载', lib);
check(p.chapter === '2', '识别章号');
check(p.book_ids.length === 1 && p.book_ids[0] === book.id, '识别书名');
check(p.keywords.includes('府兵'), '提取关键词', p.keywords);
check(p.mode === 'or', '默认模式');
check(E.parseRequest('同时 浮收 府兵', lib).mode === 'and', '识别「同时」为 and');

console.log('\n[5] 快照导出与导入格式');
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wenmai-'));
const data = path.join(tmp, 'data');
fs.mkdirSync(path.join(data, 'books', book.id), { recursive: true });
fs.writeFileSync(path.join(data, 'catalog.json'), JSON.stringify({ books: [{
  id: book.id, title: book.title, code: book.code, author: book.author,
  publisher: '', year: '', source: '', note: '', kind: 'text', pinned: false, created: ''
}] }));
fs.writeFileSync(path.join(data, 'books', book.id, 'sections.json'),
  JSON.stringify({ sections: book.sections }));
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ per_book: 20, context: 240 }));
const outSnap = path.join(tmp, 'snapshot.json');
execFileSync(process.env.PYTHON || 'python',
  [path.join(HERE, 'export_snapshot.py'), '--data', data, '--out', outSnap],
  { encoding: 'utf8' });
const snap = JSON.parse(read(outSnap));
check(snap.format === 'wenmaizaizi-snapshot', '快照格式标记 = 文脉在兹');
check(IM.SNAPSHOT_FORMATS.indexOf(snap.format) >= 0, '桌面/命令行快照能被手机端识别');
check(IM.SNAPSHOT_FORMATS.indexOf('myhistorylib-snapshot') >= 0, '兼容读取早期开发版快照');
check(snap.books.length === 1 && snap.books[0].sections.length === 2, '快照含全部书籍与章节');
check(snap.books[0].sections[0].paras[0].text.includes('租庸調'), '快照正文保留原字');
check(Object.keys(snap.variants.char_equiv).length > 2000, '快照含完整简繁对照表');
check(snap.settings.per_book === 20, '快照含检索设置');
check(snap.source.startsWith('文脉在兹'), '快照标注来源为文脉在兹');

/* localStorage 环境下实测快照导出 / 恢复 / 旧格式兼容 */
global.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};
const S = require(path.join(WEB, 'store.js'));

console.log('\n[6] 静态依赖与离线约束');
const appjs = read(path.join(WEB, 'app.js'));
const impjs = read(path.join(WEB, 'importer.js'));
check(!/\bfetch\s*\(|XMLHttpRequest|WebSocket\b/.test(appjs), '界面代码无任何网络请求');
check(!/\bfetch\s*\(|XMLHttpRequest|WebSocket\b/.test(impjs), '导入代码无任何网络请求');
for (const f of ['index.html', 'app.css', 'app.js', 'offline-engine.js', 'store.js',
  'importer.js', 'variants.js', 'variants.json', 'sw.js', 'manifest.webmanifest',
  'vendor/fflate.js', 'vendor/LICENSE.fflate.txt']) {
  check(has(path.join(WEB, f)), '资源存在：' + f);
}
const sw = read(path.join(WEB, 'sw.js'));
check(sw.includes('./vendor/fflate.js') && sw.includes('wenmaizaizi-offline'),
  'Service Worker 缓存离线解压组件且已换新缓存名');
check(read(path.join(WEB, 'index.html')).includes('vendor/fflate.js'),
  '页面引用随包分发的 fflate，不联网取 CDN');
const bad = /\.workbuddy|book-research-library|scripts[\\/]facts\.py|HistoryDesk|HistoryMobile|8766|8765/;
const codeFiles = [
  path.join(HERE, 'export_snapshot.py'),
  path.join(HERE, 'capacitor.config.json'),
  path.join(HERE, 'package.json'),
  path.join(HERE, '.github', 'workflows', 'build-ios.yml')
].concat(fs.readdirSync(WEB).filter(f => f.endsWith('.js')).map(f => path.join(WEB, f)));
const hits = codeFiles.filter(f => bad.test(read(f)));
check(hits.length === 0, '源码不引用技能目录 / 兄弟项目 / 旧端口', hits);
const webFiles = fs.readdirSync(WEB);
check(webFiles.every(f => /^[\x20-\x7E]+$/.test(f)), 'web/ 文件名全 ASCII（规避爱思助手错误码 45）');
const cap = JSON.parse(read(path.join(HERE, 'capacitor.config.json')));
check(cap.appId === 'cn.wenmaizaizi.app' && /^[A-Za-z0-9.\-]+$/.test(cap.appId), 'appId 全 ASCII');
check(cap.appName === 'WenMaiZaiZi' && cap.webDir === 'web', 'appName / webDir 正确');
const wf = read(path.join(HERE, '.github', 'workflows', 'build-ios.yml'));
check(wf.includes('CODE_SIGNING_ALLOWED=NO'), '云构建产出未签名 IPA 供爱思助手签名');
check(wf.includes('Non-ASCII path found'), '云构建自检非 ASCII 路径');
check(wf.includes('CFBundleDisplayName') && wf.includes('文脉在兹'), '主屏幕显示名为文脉在兹');
check(wf.includes('WenMaiZaiZi-unsigned.ipa'), 'IPA 产物文件名统一');
check(wf.includes('permissions:') && wf.includes('contents: write'),
  '云构建申请 contents: write 权限以发布 Release');
check(wf.includes('gh release') && wf.includes('releases/download'),
  '云构建自动发布可匿名下载的 IPA 附件');
for (const f of ['一键推送到GitHub.bat', '一键取回IPA.bat',
                 'fetch_ipa.py', '接下来只做这3件事.txt']) {
  check(fs.existsSync(path.join(HERE, f)), '随包提供安装辅助：' + f);
}
const fip = read(path.join(HERE, 'fetch_ipa.py'));
check(fip.includes('MIRRORS') && fip.includes('gh-proxy.com') &&
      fip.includes('ghproxy.net'), 'IPA 取回内置实测可用的镜像通道');
check(fip.includes('--check') && fip.includes('--self-test') &&
      fip.includes('network_check'), 'IPA 取回支持网络通道体检与离线自检');
check(/def try_download\(/.test(fip) && /def inspect_ipa\(/.test(fip) &&
      fip.includes('ProxyHandler({})'), '下载失败自动降级、双路代理、IPA 结构校验');
check(fip.includes('text/html') && fip.includes('PK\\x03\\x04'),
      '镜像返回 HTML 错误页或假包会被识别并跳过');
const pushBat = read(path.join(HERE, '一键推送到GitHub.bat'));
check(pushBat.includes('schannelCheckRevoke') && pushBat.includes('http.version=HTTP/1.1') &&
      pushBat.includes('curl.exe'), '推送脚本含网络体检与 Windows 证书 / HTTP1.1 兜底');
check(read(path.join(HERE, '一键取回IPA.bat')).includes('--check'),
      '取回失败时自动给出通道体检');
check(read(path.join(HERE, '接下来只做这3件事.txt')).includes('gh-proxy.com') &&
      read(path.join(HERE, 'README.md')).includes('gh-proxy.com'),
      '极简清单与 README 均记录镜像 / 加速器方案与边界');

console.log('\n[7] 命名与 8 类格式清单');
const html = read(path.join(WEB, 'index.html'));
const manifest = JSON.parse(read(path.join(WEB, 'manifest.webmanifest')));
check(html.includes('<title>文脉在兹') && html.includes('apple-mobile-web-app-title" content="文脉在兹"'),
  '页面标题与主屏幕名 = 文脉在兹');
check(manifest.name.includes('文脉在兹') && manifest.short_name === '文脉在兹', 'PWA 名称 = 文脉在兹');
check(IM.FORMATS.length === 8, '手机端格式清单 8 项');
for (const lab of ['EPUB', 'PDF', 'MOBI', 'AZW', 'AZW3 (KF8)', 'KFX', 'TXT/MD/CSV', 'FB2']) {
  check(IM.FORMATS.map(x => x.label).includes(lab), '清单含 ' + lab);
}
check(IM.FORMATS.filter(x => x.local).length === 3, '本机直读 3 类（EPUB / FB2 / TXT·MD·CSV）');
check(/accept="[^"]*\.epub[^"]*\.fb2/.test(html), '文件选择器接受 EPUB / FB2');
check(!/我的史料库|MyHistoryLib|HistoryDesk|HistoryMobile/.test(read(path.join(HERE, 'README.md'))),
  'README 无旧名称 / 旧方案');
if (SIBLINGS) {
  const deskFormats = read(path.join(DESK, 'formats.py'));
  for (const ext of ['.epub', '.pdf', '.mobi', '.azw', '.azw3', '.kfx', '.fb2', '.txt']) {
    check(deskFormats.includes('"' + ext + '"'), '电脑版支持 ' + ext);
  }
} else {
  skip('电脑版 8 类格式清单');
}

console.log('\n[8] 统一图标与三端同源');
const master = path.join(HERE, 'app_icon.png');
check(sha(master) === sha(path.join(HERE, 'assets', 'AppIcon-1024.png')), '原生 App 图标母版同源');
if (SIBLINGS) {
  check(has(path.join(DESK, 'app_icon.png')) && has(path.join(DESK, 'app_icon.ico')), '电脑版 png/ico 存在');
  check(sha(master) === sha(path.join(DESK, 'app_icon.png')), 'iOS / 电脑版主图同源');
  check(sha(master) === sha(path.join(AND, 'app_icon.png')), 'iOS / 安卓主图同源');
} else {
  skip('三端主图同源（3 项）');
}
for (const s of [180, 192, 512]) {
  check(has(path.join(WEB, 'icon-' + s + '.png')), 'iOS icon-' + s + ' 存在');
  if (SIBLINGS) {
    check(sha(path.join(WEB, 'icon-' + s + '.png')) === sha(path.join(AND, 'web', 'icon-' + s + '.png')),
      '安卓 icon-' + s + ' 与 iOS 同源');
  }
}
/* iOS / 安卓 web/ 必须逐字节一致 */
function walk(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name !== '.DS_Store' && e.name !== 'Thumbs.db') out.push(p);
  }
  return out;
}
const rel = (p, base) => path.relative(base, p).replace(/\\/g, '/');
if (SIBLINGS) {
  const A = walk(path.join(AND, 'web')), B = walk(WEB);
  const nA = A.map(p => rel(p, path.join(AND, 'web'))).sort();
  const nB = B.map(p => rel(p, WEB)).sort();
  check(nA.length === nB.length && nA.every((n, i) => n === nB[i]),
    'iOS / 安卓 web/ 文件清单完全一致', nA.length + ' vs ' + nB.length);
  const diff = nA.filter(n => sha(path.join(WEB, n)) !== sha(path.join(AND, 'web', n)));
  check(diff.length === 0, 'iOS / 安卓 web/ 字节级同源', diff.slice(0, 4));
} else {
  skip('iOS / 安卓 web/ 字节级同源（2 项）');
}

(async () => {
  console.log('\n[9] 本机导入实测（EPUB / FB2 / 快照 / 快照引导）');
  const fflate = require(path.join(WEB, 'vendor', 'fflate.js'));
  const u8 = fflate.strToU8;
  const epub = fflate.zipSync({
    'mimetype': u8('application/epub+zip'),
    'META-INF/container.xml': u8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
    'OEBPS/content.opf': u8('<package><metadata><dc:title>文脉在兹测试</dc:title></metadata><manifest><item id="c1" href="c1.xhtml"/></manifest><spine><itemref idref="c1"/></spine></package>'),
    'OEBPS/c1.xhtml': u8('<html><body><h1>卷一</h1><p>府兵之制，起于西魏。</p><p>某阁藏书，全角逗号，保持原貌。</p></body></html>')
  });
  const fake = (name, bytes, txt) => ({
    name: name,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => txt
  });
  try {
    const ep = await IM.readFile(fake('a.epub', epub));
    check(ep.type === 'text' && ep.name === '文脉在兹测试', 'EPUB 本机解包并取书名');
    check(ep.data.includes('府兵之制') && ep.data.includes('，保持原貌'), 'EPUB 正文与全角标点保真');
    const bk = IM.makeBook({ text: ep.data, title: ep.name, existing: [] });
    check(bk.paragraphs >= 2 && /-0001$/.test(bk.sections[0].paras[0].anchor), 'EPUB 锚点连续可用');
  } catch (e) { check(false, 'EPUB 本机解包并取书名', e.message); }
  const fb2 = '<FictionBook><description><title-info><book-title>FB2测试</book-title></title-info></description>'
    + '<body><section><title><p>卷一</p></title><p>府兵之制，起于西魏。</p></section></body></FictionBook>';
  try {
    const fb = await IM.readFile(fake('a.fb2', Buffer.from(fb2), fb2));
    check(fb.type === 'text' && fb.data.includes('府兵之制'), 'FB2 本机解析');
  } catch (e) { check(false, 'FB2 本机解析', e.message); }
  try {
    const js = await IM.readFile(fake('snapshot.json', Buffer.from(JSON.stringify(snap)), JSON.stringify(snap)));
    check(js.type === 'snapshot' && js.data.books.length === 1, '电脑版快照可本机载入');
  } catch (e) { check(false, '电脑版快照可本机载入', e.message); }
  try {
    await IM.readFile(fake('a.pdf', Buffer.from('x'), 'x'));
    check(false, 'PDF 给出快照引导');
  } catch (e) { check(e.message.includes('导出手机书库快照'), 'PDF 给出快照引导'); }

  try {
    await S.init({ storage: 'localStorage' });
    await S.saveBook(book);
    const s2 = await S.snapshot();
    check(s2.format === 'wenmaizaizi-snapshot', '手机端导出快照使用新格式');
    await S.replaceBooks([]);
    const res = await S.importSnapshot(JSON.parse(JSON.stringify(s2)), false);
    check(res.total === 1 && (await S.books()).length === 1, '手机端快照恢复');
    const legacy = JSON.parse(JSON.stringify(s2));
    legacy.format = 'myhistorylib-snapshot';
    const res2 = await S.importSnapshot(legacy, false);
    check(res2.total === 1, '手机端兼容读取早期开发版快照');
  } catch (e) { check(false, '手机端快照导出 / 恢复', e.message); }

  console.log('\n[N] 三端互通：手机快照可回灌电脑');
  if (SIBLINGS) {
    const enginePy = read(path.join(DESK, 'engine.py'));
    const uiPy = read(path.join(DESK, 'desktop_ui.py'));
    check(/def build_snapshot\(/.test(enginePy), '桌面可导出快照给手机');
    check(/def import_snapshot\(/.test(enginePy), '桌面可导入手机导出的快照');
    check(enginePy.includes('SNAPSHOT_FORMATS') &&
          enginePy.includes('wenmaizaizi-snapshot') &&
          enginePy.includes('myhistorylib-snapshot'), '桌面兼容新旧两种快照标记');
    check(uiPy.includes('btn_snapshot_in') && uiPy.includes('load_snapshot'),
          '桌面书库页有「导入手机书库快照」入口');
    check(uiPy.includes('merge=True'), '桌面导入按 id 覆盖合并，不会清空现有书库');
  } else {
    skip('桌面引擎快照导出 / 回灌（5 项）');
  }
  try {
    const s3 = await S.snapshot();
    check(s3.format === 'wenmaizaizi-snapshot' && Array.isArray(s3.books) &&
          s3.books.every(bk => bk.sections.every(sec =>
            sec.paras.every(p => !!p.anchor && typeof p.text === 'string'))),
          '手机快照的书籍 / 章节 / 锚点原文结构与桌面快照同构');
  } catch (e) { check(false, '手机快照结构与桌面同构', e.message); }

  console.log('\n' + '='.repeat(64));
  console.log('  结果：' + pass + ' PASS / ' + fail + ' FAIL' +
              (skipped ? ' / ' + skipped + ' SKIP（跨端工程未随包附带）' : ''));
  console.log('='.repeat(64));
  process.exit(fail ? 1 : 0);
})();
