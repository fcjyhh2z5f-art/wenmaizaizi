# 文脉在兹 · iPhone 完全离线版

**书与检索引擎都在这台手机上。** 没有服务器地址、没有访问令牌、没有任何网络请求；电脑关机、飞行模式都能检索与导入。与电脑版、安卓版共用同一枚**极简图标**：藏青纯色底（`#1B2A4A`）+ 白色行书「文」，没有边框、纹样或印章。字形取自王羲之《兰亭序》（褚遂良临本）「文」字墨迹，从绢本扫描图中按颜色分离出纯墨笔画，剔除赭色绢纹与网站水印；笔画的提按、牵丝与捺末枯笔飞白均为原帖所有。原作为东晋书法作品，字形本身属公有领域，不使用任何现代标识。

三端关系：**电脑版（Windows）负责导入全部 8 类电子书、切分锚点；iOS / 安卓离线版负责随身检索**，三者通过一份纯 JSON 快照**双向**交换书库，互不依赖。iOS 与安卓版共用**逐字节相同**的 `web/` 代码与图标。

**「互通」的确切含义**：不是实时同步、不是云同步。三端刻意做成零网络（本 App 零 `fetch`，安卓版连 INTERNET 权限都不申请），所以哪一端都不需要另一端开机或联网；代价是同步要**显式传一个 JSON 文件**。电脑 → 手机用桌面「导出手机书库快照」，手机 → 电脑用本 App「书库 → 导出快照」再在桌面点「导入手机书库快照」。合并按书 `id` 覆盖、不删其他书，往返后锚点编号不变。

---

## 1. 三种用法，推荐第一种

| 方式 | 是否真离线 | 需要什么 |
| --- | --- | --- |
| **① 原生 App（推荐）** | ✅ 资源全打进 App，天然离线 | Windows + GitHub 免费账号 + 爱思助手 + 数据线；**不用 Mac、不用 $99** |
| ② PWA 兜底 | ✅ 首次打开后由 Service Worker 缓存 | 一次 HTTPS 地址（如 GitHub Pages），之后「添加到主屏幕」 |
| ③ 电脑本地预览 | 仅开发核对用 | `启动离线预览.bat`，只开 localhost，不是运行依赖 |

> 注意：**不要用电脑的局域网 HTTP 地址**当作离线 PWA 入口。Service Worker 只在 HTTPS / localhost 注册，局域网 HTTP 的图标不会缓存页面，电脑一关就白屏——这正是本版要解决的问题。

---

## 2. 不用 Mac 做出真 App 的完整链路

```
Windows 写好的本目录 → push 到 GitHub → Actions 在云端 macOS 编译出未签名 IPA
→ 下载 IPA 回 Windows → 爱思助手 Apple ID 签名 → 数据线装进 iPhone → 信任描述文件
→ 之后完全离线使用
```

### 第 1 步：云构建（不用 Mac、不用付费）

**最省事（推荐）**：直接双击 **`一键推送到GitHub.bat`**（脚本会自动初始化本地 git 仓库并提交；解压包不含 `.git` 属正常）→ 窗口已内置本包对应的仓库 `fcjyhh2z5f-art/wenmaizaizi`，**直接按回车** → 浏览器弹一次 GitHub 授权，点 Authorize → 推送完成，Actions 自动开始编译。等 3–8 分钟后双击 **`一键取回IPA.bat`**，IPA 会自动下载到当前目录并校验包结构。极简清单见 `接下来只做这3件事.txt`。

> 需要换仓库：在提示处粘贴新地址再回车；新建仓库时选 Public、**不要勾选任何初始化文件**（README / .gitignore / license），否则推送会冲突。本脚本不再自动弹出「新建仓库」页。

手动做法：在 GitHub 新建公开仓库，把本目录**全部内容**作为仓库根 push 上去（`.github/` 是隐藏目录，别用网页拖拽上传，容易漏）→ `Actions` → `Build unsigned iOS IPA for WenMaiZaiZi` → `Run workflow` → 下载工件 `WenMaiZaiZi-unsigned-ipa`。

workflow 在 `macos-15` runner 上执行 `npm install` → `npx cap add ios` → `cap sync` → 写入 `CFBundleDisplayName = 文脉在兹` → **不签名** `xcodebuild archive` → 打包 IPA → 打包前自检非 ASCII 路径（见错误码 45）→ 最后**自动把 IPA 发布为 Release `v3.0.0` 的附件**。公开仓库的 Release 附件可匿名下载，所以 `fetch_ipa.py` 不需要任何 GitHub 令牌就能把成品取回；`upload-artifact` 仍保留作双保险（保留 30 天）。

私有仓库也能跑，只是 macOS 分钟按 10 倍折算计费；个人自用建议公开仓库。

#### 第 1.5 步：GitHub 打不开时的镜像与加速器（本机实测 2026-11-11）

| 通道 | 状态 | 对 iOS 安装链路的作用 |
| --- | --- | --- |
| `github.com` | ✅ 直连正常 | 网页建仓库、**git push**（必须） |
| `api.github.com` | ✅ 直连正常 | 查询 Release 附件 |
| `codeload.github.com` / `objects.githubusercontent.com` | ✅ 直连正常 | 源码打包 / 附件下载 |
| `raw.githubusercontent.com` | ❌ 不通，hosts 也修不了 | **本工程不需要**：云构建全在 GitHub 机房内跑，不走本机 raw |
| `https://gh-proxy.com/` | ✅ 实测可用 | 代理 github.com 网页 / Release 下载 / API |
| `https://ghproxy.net/` | ✅ 实测可用 | 代理 raw 文件、支持 git 协议（clone / ls-remote） |

`fetch_ipa.py` 已内置多通道：先官方直连，再按 `gh-proxy.com → ghproxy.net → ghfast.top → ghproxy.cc → github.moeyy.xyz` 逐条降级；每条通道还分别尝试「系统代理」与「强制直连」，避免沙箱代理造成的假失败。下载结果会校验 ZIP 头、完整性、`Payload/*.app/Info.plist` 与包内非 ASCII 路径，镜像返回 HTML 错误页会自动跳过。

```bat
一键取回IPA.bat --check          :: 只做网络通道体检，不改动任何系统配置
python fetch_ipa.py --self-test  :: 离线模拟「官方被墙 → 镜像接管」
python fetch_ipa.py --mirror https://你的镜像/  :: 优先使用指定镜像
python fetch_ipa.py --direct     :: 绕开代理全部直连
python fetch_ipa.py --no-mirror  :: 只用官方通道
```

手动兜底（浏览器直接打开 / clone，只读；**push 不能走镜像**）：

```
https://gh-proxy.com/https://github.com/用户名/仓库名/releases/download/v3.0.0/WenMaiZaiZi-unsigned.ipa
git clone https://ghproxy.net/https://github.com/用户名/仓库名.git
```

**关于 GitHub 加速器（hosts 方案）**：本机试跑过 `check` + 一次不落盘的 `apply` 预演——它只能修好 `gist.github.com`，`raw.githubusercontent.com` 的所有候选 IP 均不通，且会向系统 hosts 写入 30 多行解析；对 iOS 这条链路没有收益，因此**没有改动系统 hosts，也没有写入 git 全局配置**。若以后 `github.com` 网页本身打不开，再运行加速器的 `check` / `apply`（需管理员确认）刷新 IP 池即可，随时可 `rollback`。

两点边界：① 镜像只是下载中转，`git push` 必须直连 `github.com` 且需要你本人在浏览器完成一次 GitHub 授权，**不要在任何镜像站填写账号密码**；② 推送脚本已附带 Windows 证书吊销检查绕过与 HTTP/1.1 参数，缓解 `0x80092012` 与推送中断。

### 第 2 步：爱思助手签名并安装

1. 电脑安装爱思助手，iPhone 用数据线连接并点「信任此电脑」；
2. 打开「**工具箱 → IPA 文件签名**」；
3. 点「添加 IPA 文件」选刚下载的 `WenMaiZaiZi-unsigned.ipa`；
4. 选「**使用 Apple ID 签名 → 添加 Apple ID**」，填入账号密码与设备标识（连着设备时会自动读出），勾上 IPA 与账号，点「开始签名」；
5. 用爱思助手安装签名后的 IPA（注意：签名输出目录可能和原目录不同，点「签名文件保存到 → 打开」找）；
6. iPhone 首次打开前到「**设置 → 通用 → VPN 与设备管理 / 描述文件**」信任该应用。

**免费 Apple ID 签名有效期 7 天**；到期 App 打不开，**插线重签一次即可，书库数据不会丢**。若不想每周重签，可「添加证书」用自购 P12 + 描述文件签名，有效期 1 年。

> 不想处理签名？同级 `HistoryAndroid/` 是可直接安装到华为 / vivo / 小米的安卓版，云编译出 debug APK 即可，不需要 Apple ID、不需要 7 天重签。

### 第 3 步：必须避开的坑

- **用专用 Apple ID 小号**，不要把主力 iCloud 账号密码交给第三方工具。签名会模拟登录 Apple 服务器申请证书；开了双重认证的账号，iCloud 设备列表会多出一台「iMac 27" / macOS 10.15.6」，这是正常现象。
- 手机号作 Apple ID 时，输入格式要写成 `8613xxxxxxxxx`（前面加 86），否则报「账号信息有误」。
- 免费 Apple ID 仍受**最多 3 个侧载 App** 名额限制。
- **错误码 45**：IPA 内部文件或路径含中文字符等非法内容会签名失败。本工程的 `appName`、`appId`、`web/` 文件名全部为 ASCII，显示用的中文只写在 `Info.plist` 里；workflow 也会在打包前拦截非 ASCII 路径。若要改 `web/` 文件名，请保持纯英文。
- **错误码 44**：IPA 架构问题，通常是包被改动过，重新下载原始构建产物即可。
- 重签覆盖安装一般保留沙盒数据，但**书库务必定期导出快照**存到「文件」App，别把唯一副本押在签名上。

---

## 3. 三端书库互传

**推荐**：在「文脉在兹」电脑版 → 「③ 我的书库与设置」→ **导出手机书库快照**，得到 `文脉在兹_书库快照.json`。

**命令行批量导出**（本目录）：

```bat
python export_snapshot.py
```

快照含全部书籍、章节、锚点段落原文、2654 条简繁对照表与检索设置，格式为 `wenmaizaizi-snapshot`（仍兼容早期开发版 `myhistorylib-snapshot`）。用「文件」App / 隔空投送 / 微信 / 数据线传到 iPhone，在本 App「导入」页选择该文件即可。

**反向（手机 → 电脑 / 安卓 → iOS）**：本 App「书库 → 导出快照」把当前书库存成同一个 JSON，可随时备份、换设备或重签后一键恢复；把该文件传回 Windows，在电脑版「③ 我的书库与设置」→ **导入手机书库快照** 即可合回桌面书库。你在 iPhone 上自己粘贴的文本、本机导入的 EPUB / FB2，都会随这张快照完整回到电脑，锚点编号与原文逐字不变。iOS 与安卓共用同一份 `web/`，两端快照互相通用。

### 8 类电子书，手机端怎么拿到

| 格式 | 手机端本机直读 | 说明 |
| --- | --- | --- |
| **EPUB** | ✅ | 随包 `vendor/fflate.js` 离线解压，按 OPF spine 与 `<h1..6>` 分章，不联网 |
| **FB2** | ✅ | 本机正则解析 FictionBook XML，按 `<section>/<title>` 分章 |
| **TXT / MD / CSV / 粘贴文本** | ✅ | 每行一个锚点，空行不占号 |
| **书库快照 JSON** | ✅ | 电脑版切好锚点后的完整书库 |
| **PDF** | ❌ 走快照 | 需要 `pypdf` 文字层解析；扫描件须先 OCR |
| **MOBI / AZW / AZW3(KF8)** | ❌ 走快照 | 需要 PalmDB + PalmDOC LZ77 / HUFF-CDIC 解压；带 DRM 无法解开 |
| **KFX** | ❌ 走快照 | 私有格式，本机有 Calibre 时由电脑版自动转换一次 |

选中 PDF / MOBI / AZW / AZW3 / KFX 时，程序会明确提示「请在电脑版导入后导出快照」，不会假装成功。手机端只接收已切好锚点的纯 JSON，因此**永远不需要解压这些容器，也不需要网络**。

---

## 4. 功能与边界

**能做**：一句话需求解析（书名／章号／模式，可手改）、任一／全部／短语／正则检索、简↔繁双向命中、按书与章节过滤、零结果透明回退二字词干、锚点回查**完整段落原文＋前后段**、复制引用与系统分享、导出 Markdown 报告与全文、书库置顶／编辑／删除、快照导出与恢复、编辑简繁对照表、深色模式与安全区适配。

**边界**：

- 锚点是程序按段落切分的编号，**不是纸本页码**；引用前请核对纸书，程序不代为判定一手／二手属性。
- 只支持文字底本；扫描图片版 PDF / EPUB 无正文可提；带 DRM 的 Kindle 书无法解开。
- 数据存本机 IndexedDB（不可用时降级 localStorage）；iOS 可能清理长期未使用的网页存储，原生 App 形态更稳，**快照是最终保险**。
- 免费签名 7 天到期需重签一次；这不影响已经离线的检索，只是 App 图标暂时打不开。
- Swift 源码与 Xcode 工程**不在本版内**：Capacitor 工程由云构建自动生成，Windows 侧不需要 Xcode。
- 安卓版是 APK，可装在 HarmonyOS 4.x / EMUI 兼容层；**HarmonyOS NEXT 纯血鸿蒙不支持 APK**，详见安卓版 README。

---

## 5. 文件清单

| 文件 | 作用 |
| --- | --- |
| `web/index.html` `app.css` `app.js` | iOS 风格四页界面（安卓版逐字节同源） |
| `web/offline-engine.js` | 纯 JS 检索引擎（与电脑版 `engine.py` 语义一致） |
| `web/store.js` | IndexedDB / localStorage 书库存储与快照 |
| `web/importer.js` | EPUB / FB2 / TXT / MD / CSV / 快照 JSON / 粘贴文本导入 |
| `web/vendor/fflate.js` `LICENSE.fflate.txt` | 随包分发的离线 ZIP 解压库（MIT），用于 EPUB，**不联网取 CDN** |
| `web/variants.js` `variants.json` | 随程序分发的 2654 条简繁异体对照（纯数据） |
| `web/sw.js` `manifest.webmanifest` `icon-*.png` | PWA 离线壳与藏青行书「文」图标 |
| `web/selftest.html` | 浏览器内真实存储往返自检（`?run=1&storage=local`） |
| `export_snapshot.py` | 电脑版书库 → 手机快照 |
| `package.json` `capacitor.config.json` | Capacitor 原生壳配置（全 ASCII） |
| `.github/workflows/build-ios.yml` | 云端 macOS 编译未签名 IPA，并自动发布为可匿名下载的 Release 附件 |
| `一键推送到GitHub.bat` / `一键取回IPA.bat` | Windows 一键推送工程（含网络体检与证书兜底）/ 一键下载并校验云端 IPA（失败自动切镜像并出体检报告） |
| `fetch_ipa.py` / `接下来只做这3件事.txt` | 多通道匿名下载器（无需令牌，支持 `--check` / `--self-test` / `--mirror`）/ 极简安装清单 |
| `selftest.cjs` | Node 端引擎 / 导入 / 快照 / 离线约束 / 三端同源 / 云构建链路自检 |
| `升级和更新.txt` | 三端通用的升级指南：加书 / 换版本 / 7 天重签 / PWA 刷新、数据不丢的条件 |
| `assets/AppIcon-1024.png` | 原生 App 图标母版 |
| `preview_icons.png` | 电脑 / iPhone / 安卓三端图标对比图 |

电脑版在同级 `HistoryStandalone/`，安卓版在同级 `HistoryAndroid/`。当前图标的生成器是 `HistoryStandalone/make_icon_wen.py`，字形蒙版与原始墨迹留存在 `HistoryStandalone/icon_candidates/E_wen/`；旧的建筑候选与旧生成器已按要求全部清除。

**换图标**：当前图标想换藏青深浅，执行 `python ../HistoryStandalone/make_icon_wen.py --navy '#131F38' --apply`；只用 `python make_icon_wen.py --apply` 则把现有 `E_wen` 一键铺到**电脑版 / iOS / 安卓三端**（安卓启动图标与启动画面会一起按新底色重生成）。`python make_icon_wen.py` 可重新从原始墨迹提取字形并生成大图预览。选定后记得重打包桌面 exe 与三个交付 zip（exe 内嵌图标需重新构建）。

---

## 6. 自检

```bash
node selftest.cjs          # Node 端全量自检，应 0 FAIL
python fetch_ipa.py --self-test   # 离线验证「官方通道被墙 → 镜像接管」
python fetch_ipa.py --check       # 实测 GitHub 直连与各镜像通道
python export_snapshot.py  # 命令行快照导出（不需要 GUI）
```

解压包单独放在任意目录运行时，依赖同级电脑版 / 安卓版工程的跨端同源断言会显示为 `SKIP`，其余断言照常执行，仍应 0 FAIL；把包放回三端工程同级目录则可跑满全量。

自检含「三端互通」一组：验证桌面引擎同时具备快照导出 / 回灌、兼容新旧格式标记、书库页有导入入口、手机快照结构与桌面同构。桌面版 `selftest.py` 里还有一条真实跨语言链路（Node 手机存储层导出 → Python 桌面引擎导入 → 校验锚点与原文逐字不变）。

浏览器端另可打开 `web/selftest.html?run=1&storage=local`，在真实 WebView 存储环境里验证导入 → 检索 → 回查 → 快照恢复。

---

## 7. 升级与更新

完整步骤见同目录 **`升级和更新.txt`**（三端通用，含数据备份、版本号位置与常见坑）。这里只列要点：

- **加书 / 改变体表**：不用重装，直接导入；跨端用快照。
- **软件出新版**：把新版文件覆盖到本目录（**保留 `.git/` 与 `.github/`，不要重新建仓库**）→ 再双击一次 `一键推送到GitHub.bat`（直接回车）→ 等 3–8 分钟 → `一键取回IPA.bat` → 爱思助手用**同一个 Apple ID** 重签并覆盖安装。脚本会打印构建 SHA 与附件更新时间，可确认拿到的是新包。
- workflow 已改为**任何 push 都会重新编译**并加 `concurrency` 防止旧构建覆盖新包；Release 固定 tag `v3.0.0` 每次以 `--clobber` 覆盖，notes 写入本次 SHA 与运行号；`fetch_ipa.py` 带 `no-cache` 请求，另可用 `--tag` 取回指定版本。没改文件只想重编，去 Actions 页点 **Run workflow**。
- **7 天签名到期不是升级**：不用下载、不用重编，插线重签一次即可，书库不丢。
- **升级前先在 App 内导出一次快照**；`appId` 与 `web/` 文件名不要改，否则数据不继承或签名报错 45。
