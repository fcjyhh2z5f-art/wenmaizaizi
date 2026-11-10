#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""取回云端编译的未签名 IPA，并校验包结构；内置 GitHub 镜像 / 直连双路自动兜底。

用法：
    python fetch_ipa.py                          # 自动读取 git remote origin
    python fetch_ipa.py yourname/repo           # 手动指定仓库
    python fetch_ipa.py --check                 # 只做网络通道体检
    python fetch_ipa.py --check yourname/repo   # 体检并顺带查一次 Release
    python fetch_ipa.py --self-test             # 离线自检：模拟官方通道被墙、自动降级
    python fetch_ipa.py --mirror https://xxx/   # 优先使用指定镜像
    python fetch_ipa.py --direct                # 绕开系统代理，全部直连
    python fetch_ipa.py --no-mirror             # 只用 GitHub 官方通道

本机实测（2026-11-11）：
    github.com / api.github.com / codeload.github.com 直连正常；
    raw.githubusercontent.com 在本机完全不通，hosts 也修不了，但本工程的
    云构建（actions/checkout、setup-node、gh release）都在 GitHub 机房内运行，
    不经过本机 raw，所以不影响 iOS 构建与取回。
    gh-proxy.com 可代理 github.com 网页 / Release 下载 / api；
    ghproxy.net  可代理 raw 文件与 git 协议（clone / ls-remote）。
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

TAG = "v3.0.0"
ASSET = "WenMaiZaiZi-unsigned.ipa"
USER_AGENT = "WenMaiZaiZi-fetch/3.0"

# 逐条实测择优：前两条为实测可用，后面是备用（网络相位变化时脚本会自动切换）。
MIRRORS = [
    ("gh-proxy.com", "https://gh-proxy.com/"),
    ("ghproxy.net", "https://ghproxy.net/"),
    ("ghfast.top", "https://ghfast.top/"),
    ("ghproxy.cc", "https://ghproxy.cc/"),
    ("github.moeyy.xyz", "https://github.moeyy.xyz/"),
]

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def short(exc: Exception) -> str:
    return f"{type(exc).__name__}: {str(exc)[:80]}"


def http_get(url: str, timeout: float = 20, direct: bool = False,
             headers: dict | None = None):
    """打开 URL。direct=True 时绕开系统/沙箱代理，强制直连。"""
    hs = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if headers:
        hs.update(headers)
    req = urllib.request.Request(url, headers=hs)
    handlers = [urllib.request.ProxyHandler({})] if direct else []
    return urllib.request.build_opener(*handlers).open(req, timeout=timeout)


def mirror_url(base: str, url: str) -> str:
    return base.rstrip("/") + "/" + url.lstrip("/")


def parse_repo(text: str) -> tuple[str, str] | None:
    text = text.strip().strip('"').rstrip("/")
    m = re.search(r"github\.com[:/]([^/]+)/([^/]+)$", text)
    if m:
        return m.group(1), m.group(2).removesuffix(".git")
    parts = [p for p in text.split("/") if p]
    if len(parts) == 2:
        return parts[0], parts[1].removesuffix(".git")
    return None


def repo_from_git() -> tuple[str, str] | None:
    try:
        url = subprocess.check_output(
            ["git", "remote", "get-url", "origin"],
            text=True, encoding="utf-8", stderr=subprocess.DEVNULL).strip()
        return parse_repo(url)
    except Exception:
        return None


def probe(url: str, timeout: float = 8, direct: bool = False):
    """返回 (是否可达, 状态码或错误, 耗时, 读取字节数)。有 HTTP 响应即算可达。"""
    t0 = time.time()
    try:
        with http_get(url, timeout, direct) as r:
            data = r.read(2048)
            return True, str(getattr(r, "status", 200)), time.time() - t0, len(data)
    except urllib.error.HTTPError as exc:
        return True, str(exc.code), time.time() - t0, 0
    except Exception as exc:
        return False, short(exc), time.time() - t0, 0


def network_check(pair: tuple[str, str] | None, mirrors: list) -> int:
    print("=== 文脉在兹 · GitHub 通道体检 ===")
    print()
    print("[1/3] GitHub 官方域名（本机直连）")
    direct_targets = [
        ("github.com              网页 / git push", "https://github.com"),
        ("api.github.com          查询 Release   ", "https://api.github.com/rate_limit"),
        ("codeload.github.com     源码打包       ", "https://codeload.github.com"),
        ("objects.githubusercontent.com 附件下载 ", "https://objects.githubusercontent.com"),
        ("raw.githubusercontent.com（本工程不需要）",
         "https://raw.githubusercontent.com/git/git/master/README.md"),
    ]
    results: dict[str, bool] = {}
    for label, url in direct_targets:
        ok, code, sec, _ = probe(url)
        key = url.split("/")[2]
        results[key] = ok
        print(f"  {'OK ' if ok else 'FAIL'}  {label:<42} {code:<10} {sec:.1f}s")
    print()
    print("[2/3] 镜像通道（每个镜像分别测「下载」与「raw」两种能力）")
    test_dl = "https://github.com/git/git/releases/latest"
    test_raw = "https://raw.githubusercontent.com/git/git/master/README.md"
    usable_dl: list[str] = []
    for name, base in mirrors:
        ok_dl, code_dl, _, _ = probe(mirror_url(base, test_dl), timeout=7)
        ok_raw, code_raw, _, _ = probe(mirror_url(base, test_raw), timeout=7)
        if ok_dl:
            usable_dl.append(name)
        print(f"  {name:<22} 下载 {'OK ' if ok_dl else 'FAIL'}({code_dl:<5})   "
              f"raw {'OK ' if ok_raw else 'FAIL'}({code_raw})")
    print()
    print("[3/3] 结论")
    print(f"  · 推送到 GitHub：{'可用' if results.get('github.com') else '不可用（先修复网络或稍后重试）'}")
    print(f"  · 查询 Release：{'可用' if results.get('api.github.com') else '不可用（脚本会直接拼下载地址兜底）'}")
    print(f"  · raw 通道：{'可用' if results.get('raw.githubusercontent.com') else '不通，不影响本工程；云构建在 GitHub 机房内完成'}")
    print(f"  · 可用于下载的镜像：{', '.join(usable_dl) if usable_dl else '无（将只走官方直连）'}")
    print("  · 注意：镜像只能帮忙「下载 / clone」，不能代替你登录授权；")
    print("    git push 必须走 github.com 直连，且需要你本人在浏览器点一次 Authorize。")
    if pair:
        owner, repo = pair
        url = f"https://api.github.com/repos/{owner}/{repo}/releases/tags/{TAG}"
        ok, code, _, _ = probe(url, timeout=10)
        print(f"  · 仓库 {owner}/{repo} 的 Release {TAG}：{code}"
              f"{'（可能已构建完成）' if ok and code == '200' else '（还没生成或构建中）'}")
    print()
    print("体检只做网络探测，不改动 hosts、不改动 git 配置、不上传任何数据。")
    return 0 if results.get("github.com") else 1


def api_channels(owner: str, repo: str, mirrors: list) -> list[tuple[str, str]]:
    base = f"https://api.github.com/repos/{owner}/{repo}/releases/tags/{TAG}"
    out = [("GitHub API 直连", base)]
    for name, m in mirrors[:2]:
        out.append((f"{name} 代理 API", mirror_url(m, base)))
    return out


def query_release(owner: str, repo: str, mirrors: list, direct_only: bool = False):
    """返回 (附件下载地址 或 None, 通道名, 错误列表)。查不到也能靠固定地址下载。"""
    errors: list[str] = []
    modes = [True] if direct_only else [False, True]
    for label, url in api_channels(owner, repo, mirrors):
        for is_direct in modes:
            tag = label + ("/直连" if is_direct else "")
            try:
                with http_get(url, 15, is_direct,
                              {"Accept": "application/vnd.github+json"}) as r:
                    data = json.loads(r.read().decode("utf-8"))
                asset = next((a.get("browser_download_url")
                              for a in data.get("assets", []) if a.get("name") == ASSET), None)
                print(f"  Release 查询成功：{tag}")
                return asset, tag, errors
            except Exception as exc:
                errors.append(f"{tag}: {short(exc)}")
    print("  Release API 暂时查不到，改用固定下载地址直接尝试（不影响下载）。")
    return None, "", errors


def download_channels(page: str, asset_url: str | None,
                      mirrors: list) -> list[tuple[str, str]]:
    fixed = f"{page}/releases/download/{TAG}/{ASSET}"
    out: list[tuple[str, str]] = []
    if asset_url and asset_url != fixed:
        out.append(("Release 附件直连", asset_url))
    out.append(("Release 固定地址直连", fixed))
    for name, m in mirrors:
        out.append((f"{name} 代理下载", mirror_url(m, fixed)))
    return out


def inspect_ipa(p: Path, min_size: int = 1024 * 1024):
    """校验 ZIP 完整性与 App 包结构；返回 (是否合格, 说明, 统计)。"""
    info: dict = {}
    try:
        size = p.stat().st_size
        if size < min_size:
            return False, f"文件过小（{size} B），多半是错误页", info
        with p.open("rb") as f:
            head = f.read(4)
        if head != b"PK\x03\x04":
            return False, f"不是 IPA/ZIP（文件头 {head!r}），多半是镜像错误页", info
        with zipfile.ZipFile(p) as z:
            names = z.namelist()
            broken = z.testzip()
            has_app = any(n.startswith("Payload/") and n.endswith(".app/Info.plist")
                          for n in names)
            non_ascii = [n for n in names if any(ord(c) > 127 for c in n)]
        info = {"size": size, "entries": len(names), "has_app": has_app,
                "non_ascii": non_ascii, "broken": broken}
        if broken is not None:
            return False, f"ZIP 损坏：{broken}", info
        if not has_app:
            return False, "包内未找到 Payload/*.app/Info.plist", info
        return True, "OK", info
    except Exception as exc:
        return False, short(exc), info


def try_download(channels: list[tuple[str, str]], dest: Path,
                 direct_only: bool = False, get=None,
                 min_size: int = 1024 * 1024):
    """逐个通道尝试，每个通道还会分别试「系统代理」与「强制直连」两条路径。"""
    get = get or http_get
    tmp = dest.with_suffix(dest.suffix + ".part")
    errors: list[str] = []
    modes = [True] if direct_only else [False, True]
    for label, url in channels:
        for is_direct in modes:
            tag = label + ("/直连" if is_direct else "")
            print(f"  → {tag} ... ", end="", flush=True)
            try:
                with get(url, 120, is_direct,
                         {"Accept": "application/octet-stream"}) as r:
                    ctype = (r.headers.get("Content-Type") or "").lower()
                    with tmp.open("wb") as f:
                        while True:
                            chunk = r.read(1 << 18)
                            if not chunk:
                                break
                            f.write(chunk)
                if "text/html" in ctype:
                    print("返回网页，跳过")
                    errors.append(f"{tag}: 返回 HTML 错误页")
                    break
                ok, msg, info = inspect_ipa(tmp, min_size)
                if ok:
                    tmp.replace(dest)
                    print("OK")
                    return tag, info, errors
                print(msg)
                errors.append(f"{tag}: {msg}")
                break
            except Exception as exc:
                print(short(exc))
                errors.append(f"{tag}: {short(exc)}")
                continue
    try:
        tmp.unlink(missing_ok=True)
    except Exception:
        pass
    return None, None, errors


def self_test() -> int:
    """不联网：模拟官方通道被阻断 / 镜像返回 HTML，验证自动降级与结构校验。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("Payload/App.app/Info.plist", b"<plist/>")
    good = buf.getvalue()
    fixed = "https://github.com/o/r/releases/download/v3.0.0/" + ASSET
    channels = [("官方", fixed), ("镜像", mirror_url(MIRRORS[0][1], fixed))]
    calls: list[str] = []

    def fake(url, timeout=0, direct=False, headers=None):
        calls.append(url)
        if url.startswith("https://github.com/"):
            raise OSError("模拟：官方通道被阻断")

        class R:
            headers = {"Content-Type": "application/octet-stream"}
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, n=-1):
                if not getattr(self, "_sent", False):
                    self._sent = True
                    return b"<html>blocked</html>" if "ghproxy" in url else good
                return b""

        return R()

    dest = Path(tempfile.gettempdir()) / "wenmai_channel_selftest.ipa"
    label, info, errors = try_download(channels, dest, True, fake, 0)
    ok = bool(label and label.startswith("镜像") and info and info["has_app"]
              and errors and dest.exists())
    try:
        dest.unlink(missing_ok=True)
    except Exception:
        pass
    print(f"  通道尝试次数：{len(calls)}（官方失败 → 镜像成功）")
    print(f"  降级结果：{label}，App 包：{bool(info and info['has_app'])}")
    print("  离线通道自检：" + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


def print_next_steps(dest: Path, info: dict) -> None:
    print()
    print(f"已下载：{dest.name}  ({info['size'] / 1048576:.1f} MB，{info['entries']} 个条目)")
    print("ZIP 完整性：OK    含 App 包：OK")
    print(f"内部非 ASCII 路径：{len(info['non_ascii'])} 个（爱思助手错误码 45 与此有关）")
    if info["non_ascii"]:
        print("警告：包内出现中文路径，爱思助手签名可能报错误码 45。")
        for n in info["non_ascii"][:5]:
            print("  ", n)
    print()
    print("下一步（需要你本人操作，我无法代填 Apple ID 密码）：")
    print("  1. Windows 安装爱思助手，iPhone 数据线连接并点「信任此电脑」")
    print("  2. 工具箱 → IPA 文件签名 → 添加 IPA → 使用 Apple ID 签名 → 开始签名")
    print("  3. 用爱思助手安装签名后的 IPA，iPhone 设置 → 通用 →")
    print("     VPN 与设备管理 → 信任该开发者")
    print("  4. 打开 App；免费签名 7 天有效，到期插线重签即可，书库数据不丢")
    print()
    print("装好书库：电脑版「导出手机书库快照」→ 传 JSON 到手机 → App「导入」页选中。")
    print(f"IPA 位置：{dest}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="取回云端编译的未签名 IPA（内置 GitHub 镜像自动兜底）")
    ap.add_argument("repo", nargs="?", default="", help="owner/repo 或 GitHub 仓库地址")
    ap.add_argument("--check", action="store_true", help="只做网络通道体检，不下载")
    ap.add_argument("--self-test", action="store_true", help="离线自检通道降级逻辑")
    ap.add_argument("--mirror", default=os.environ.get("WENMAI_GITHUB_MIRROR", ""),
                    help="优先使用的镜像前缀，例如 https://gh-proxy.com/")
    ap.add_argument("--direct", action="store_true", help="绕开系统代理，强制直连")
    ap.add_argument("--no-mirror", action="store_true", help="只用 GitHub 官方通道")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()

    pair = parse_repo(args.repo) if args.repo else repo_from_git()
    mirrors: list[tuple[str, str]] = [] if args.no_mirror else list(MIRRORS)
    if args.mirror:
        m = args.mirror.strip()
        if not m.startswith(("http://", "https://")):
            print("镜像地址必须以 https:// 开头")
            return 2
        mirrors.insert(0, ("自定义镜像", m.rstrip("/") + "/"))

    if args.check:
        return network_check(pair, mirrors)

    if not pair:
        print("未检测到仓库地址。请这样运行：")
        print("  python fetch_ipa.py yourname/wenmaizaizi-ios")
        print("  python fetch_ipa.py --check          （先看网络通道体检）")
        return 2

    owner, repo = pair
    page = f"https://github.com/{owner}/{repo}"
    print(f"仓库：{owner}/{repo}")
    print(f"镜像通道：{', '.join(n for n, _ in mirrors) if mirrors else '未启用（--no-mirror）'}")
    print("正在查询云构建产物 ...")
    asset_url, _, _ = query_release(owner, repo, mirrors, args.direct)

    dest = Path(__file__).resolve().parent / ASSET
    channels = download_channels(page, asset_url, mirrors)
    print(f"开始下载（共 {len(channels)} 条通道，失败自动切换）...")
    label, info, errors = try_download(channels, dest, args.direct)
    if not info:
        print()
        print("所有通道都未能取回可用 IPA。常见原因：")
        print("  1) 云构建还没跑完（约 3-8 分钟）——等几分钟再双击一次")
        print("  2) 构建失败 / 仓库是私有的 / Release 没发布")
        print(f"  3) 网络受限——运行 python fetch_ipa.py --check 看通道体检")
        print(f"  打开查看：{page}/actions")
        print(f"  手动下载：{page}/releases/tag/{TAG}")
        if errors:
            print("  各通道错误：")
            for e in errors[:8]:
                print("   -", e)
        return 4

    print(f"成功通道：{label}")
    print_next_steps(dest, info)
    return 0


if __name__ == "__main__":
    sys.exit(main())
