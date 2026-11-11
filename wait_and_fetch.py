#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""等云端 iOS 编译完成 → 自动取回 IPA 并校验 → 写「可以关机了」标记。

与之前被取消的临时监视脚本不同：本脚本是常驻文件，可重复运行；
状态查询走 gh-proxy 镜像（不受本机匿名 API 限额影响），产物探测用
固定 Release 地址（完全不消耗 API）。若遇到「排队被取消」会自动
重新触发云编译，最多 3 次；真编译报错则不再盲目重试。
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

REPO = "fcjyhh2z5f-art/wenmaizaizi"
# 优先用本机实际解压目录；换电脑 / 换位置时自动回落到脚本所在目录
DEFAULT_DIR = Path(r"D:/download/文脉在兹_iOS离线版")
DIR = DEFAULT_DIR if DEFAULT_DIR.is_dir() else Path(__file__).resolve().parent
DEST = DIR / "WenMaiZaiZi-unsigned.ipa"
FLAG = DIR / "可以关机了.txt"
FAIL = DIR / "构建未完成.txt"
ASSET_URL = (f"https://github.com/{REPO}/releases/download/"
             "v3.0.0/WenMaiZaiZi-unsigned.ipa")
MIRROR_API = "https://gh-proxy.com/https://api.github.com/repos/" + REPO
UA = {"User-Agent": "WenMaiZaiZi-watch"}
MAX_MINUTES = 90
INTERVAL = 30
MAX_RETRY = 3

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def http(url: str, timeout: float = 20, headers: dict | None = None):
    hs = dict(UA)
    hs.update(headers or {})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return opener.open(urllib.request.Request(url, headers=hs), timeout=timeout)


def release_ready() -> bool:
    """只读 4 字节判断 Release 附件是否已生成，不消耗 API 限额。"""
    try:
        with http(ASSET_URL, 25, {"Range": "bytes=0-3"}) as r:
            return r.status in (200, 206) and r.read(4)[:2] == b"PK"
    except Exception:
        return False


def valid_ipa(p: Path) -> bool:
    try:
        if not p.is_file() or p.stat().st_size < 1024 * 1024:
            return False
        with zipfile.ZipFile(p) as z:
            names = z.namelist()
            if z.testzip() is not None:
                return False
            return any(n.startswith("Payload/") and n.endswith(".app/Info.plist")
                       for n in names)
    except Exception:
        return False


def latest_runs() -> list:
    url = f"{MIRROR_API}/actions/runs?per_page=1&_={int(time.time())}"
    try:
        with http(url) as r:
            return json.load(r).get("workflow_runs", [])[:1]
    except Exception:
        return []


def job_steps(run_id: int) -> list:
    try:
        with http(f"{MIRROR_API}/actions/runs/{run_id}/jobs") as r:
            jobs = json.load(r).get("jobs", [])
        return jobs[0].get("steps", []) if jobs else []
    except Exception:
        return []


def retrigger(n: int) -> bool:
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    c = subprocess.run(["git", "commit", "--allow-empty", "-m",
                        f"Retry iOS cloud build #{n}"],
                       cwd=DIR, env=env, capture_output=True, text=True, timeout=60)
    if c.returncode:
        log("自动重试：commit 失败 " + c.stderr.strip()[:120])
        return False
    p = subprocess.run(["git", "-c", "http.schannelCheckRevoke=false",
                        "-c", "http.version=HTTP/1.1", "push", "origin", "main"],
                       cwd=DIR, env=env, capture_output=True, text=True, timeout=150)
    ok = p.returncode == 0
    log("自动重试：已推送，等待新任务" if ok else
        "自动重试：push 失败 " + p.stderr.strip()[:160])
    return ok


def write_success() -> None:
    data = DEST.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    FLAG.write_text(
        "文脉在兹 · 安装包已下载并校验完成\n"
        "========================================\n"
        f"时间：{datetime.now():%Y-%m-%d %H:%M:%S}\n"
        f"文件：{DEST}\n"
        f"大小：{len(data) / 1048576:.2f} MB\n"
        f"SHA256：{sha}\n"
        "校验：ZIP 完整、包内含 Payload/*.app/Info.plist\n\n"
        "现在可以关机了。安装包是本地文件，关机、断网都不会损坏或过期。\n"
        "7 天有效期从你用爱思助手签名那天才开始算，没签名放多久都没事。\n\n"
        "下次开机后只剩一步：爱思助手 → IPA 签名（同一个 Apple ID）\n"
        "→ 数据线装进 iPhone → 设置里信任描述文件。\n"
        "装好后用电脑版导出的 JSON 快照把书库导进去。\n",
        encoding="utf-8")
    FAIL.unlink(missing_ok=True)


def write_pending(reason: str) -> None:
    FLAG.unlink(missing_ok=True)
    FAIL.write_text(
        "文脉在兹 · 云端编译尚未拿到安装包\n"
        "========================================\n"
        f"时间：{datetime.now():%Y-%m-%d %H:%M:%S}\n"
        f"情况：{reason}\n\n"
        "安装包不会丢：编译成功后会一直存放在 GitHub Release v3.0.0 附件里。\n"
        "开机后双击同目录 一键取回IPA.bat 即可下载（内置镜像兜底，无需登录）。\n"
        "查看进度：https://github.com/" + REPO + "/actions\n",
        encoding="utf-8")


def main() -> int:
    log("开始等待云端编译（最多 90 分钟，每 30 秒检查一次）")
    log(f"目标文件：{DEST}")
    start = time.time()
    retries = 0
    last_key = None
    tick = 0

    if valid_ipa(DEST):
        log("本机已存在校验合格的安装包，直接完成")
        write_success()
        print("DONE OK", flush=True)
        return 0

    while (time.time() - start) / 60 < MAX_MINUTES:
        if valid_ipa(DEST):
            break
        if release_ready():
            log("Release 已生成，开始下载并校验（最多重试 3 次）")
            for i in range(3):
                try:
                    rc = subprocess.run([sys.executable, "fetch_ipa.py"],
                                        cwd=DIR, timeout=300).returncode
                except Exception as exc:
                    rc = -1
                    log(f"下载脚本异常：{type(exc).__name__}: {exc}")
                log(f"  第 {i + 1} 次取回，退出码 {rc}")
                if valid_ipa(DEST):
                    break
                time.sleep(30)
            if valid_ipa(DEST):
                break
            log("附件可访问但本机校验未通过，继续观察")
        if tick % 3 == 0:
            rl = latest_runs()
            if rl:
                r = rl[0]
                key = (r.get("id"), r.get("status"), r.get("conclusion"))
                if key != last_key:
                    log(f"run #{r.get('run_number')}：{r.get('status')}/"
                        f"{r.get('conclusion')}")
                    last_key = key
                if r.get("status") == "completed" and r.get("conclusion") != "success":
                    steps = job_steps(r["id"])
                    if not steps and retries < MAX_RETRY:
                        retries += 1
                        log(f"排队被取消（一个步骤都没跑），第 {retries}/{MAX_RETRY} 次自动重试")
                        if retrigger(retries):
                            time.sleep(60)
                    elif steps:
                        log("构建失败且已执行过步骤，属真实编译错误，停止自动重试")
                        write_pending("云端编译报错，需要查看 Actions 日志修复")
                        print("DONE FAILED", flush=True)
                        return 2
        tick += 1
        time.sleep(INTERVAL)

    if valid_ipa(DEST):
        write_success()
        log("安装包已就位并写好「可以关机了.txt」，任务完成")
        print("DONE OK", flush=True)
        return 0

    write_pending("等待 90 分钟仍未生成附件（GitHub 云端 Mac 排队或故障）")
    log("超时结束，已写「构建未完成.txt」，下次开机可手动取回")
    print("DONE TIMEOUT", flush=True)
    return 3


if __name__ == "__main__":
    sys.exit(main())
