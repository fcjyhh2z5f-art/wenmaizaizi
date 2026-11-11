#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用户明确授权：IPA 下载并校验完成后自动关机。

只在 watch_ipa.py 写出「可以关机了.txt」且本机 IPA 复验合格时触发关机；
编译失败 / 排队超时（「构建未完成.txt」）一律不关机，留着电脑便于排查。
关机用 120 秒倒计时，期间可在任意命令行执行 `shutdown /a` 取消，
或双击同目录 `取消自动关机.bat`。
"""
from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import time
import zipfile
from datetime import datetime
from pathlib import Path

DIR = Path(r"D:/download/文脉在兹_iOS离线版")
IPA = DIR / "WenMaiZaiZi-unsigned.ipa"
FLAG = DIR / "可以关机了.txt"
FAIL = DIR / "构建未完成.txt"
RECORD = DIR / "自动关机记录.txt"
SHUTDOWN = Path(os.environ.get("WINDIR", r"C:\Windows")) / "System32" / "shutdown.exe"
COUNTDOWN = 120          # 秒；留时间给人工取消
MAX_MINUTES = 105        # 比 watch_ipa.py 的 90 分钟多 15 分钟
INTERVAL = 20

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def valid_ipa() -> bool:
    try:
        if not IPA.is_file() or IPA.stat().st_size < 1024 * 1024:
            return False
        with zipfile.ZipFile(IPA) as z:
            names = z.namelist()
            if z.testzip() is not None:
                return False
            return any(n.startswith("Payload/") and n.endswith(".app/Info.plist")
                       for n in names)
    except Exception:
        return False


def verify_flag_matches() -> bool:
    """标记文件里记录的 SHA256 必须与当前 IPA 一致，防止误认旧文件。"""
    try:
        text = FLAG.read_text(encoding="utf-8")
        sha = hashlib.sha256(IPA.read_bytes()).hexdigest()
        return sha in text
    except Exception:
        return False


def do_shutdown() -> int:
    sha = hashlib.sha256(IPA.read_bytes()).hexdigest()
    size = IPA.stat().st_size
    note = (
        "\n────────────────────────────────\n"
        "已按你的授权启用自动关机：\n"
        f"  {COUNTDOWN} 秒倒计时后关机（有 2 分钟缓冲）。\n"
        "  反悔的话，在命令行执行 shutdown /a，或双击本目录\n"
        "  「取消自动关机.bat」，即可取消，文件不受影响。\n"
        "  安装包已落盘，关机 / 断网 / 放几天都不会损坏或过期。\n"
    )
    try:
        with FLAG.open("a", encoding="utf-8") as f:
            f.write(note)
            f.flush()
            os.fsync(f.fileno())
    except Exception as exc:
        log("追加说明到标记文件失败（不影响关机）：" + repr(exc))

    RECORD.write_text(
        "文脉在兹 · 自动关机记录\n"
        "========================================\n"
        f"触发时间：{datetime.now():%Y-%m-%d %H:%M:%S}\n"
        f"安装包：{IPA}\n"
        f"大小：{size / 1048576:.2f} MB\n"
        f"SHA256：{sha}\n"
        "校验：ZIP 完整 + Payload/*.app/Info.plist 存在 + 与标记文件 SHA 一致\n"
        f"关机命令：{SHUTDOWN} /s /f /t {COUNTDOWN}\n"
        "取消方法：shutdown /a 或双击 取消自动关机.bat\n"
        "说明：仅在下载并校验成功后关机；编译失败或超时不关机。\n",
        encoding="utf-8")
    try:
        with RECORD.open("rb") as f:
            os.fsync(f.fileno())
    except Exception:
        pass

    cmd = [str(SHUTDOWN), "/s", "/f", "/t", str(COUNTDOWN),
           "/c", "WenMaiZaiZi IPA ready - auto shutdown authorized by user"]
    log("执行关机：" + " ".join(cmd))
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        ok = r.returncode == 0
        detail = (r.stdout or "").strip() + " " + (r.stderr or "").strip()
    except Exception as exc:
        ok, detail = False, repr(exc)

    with RECORD.open("a", encoding="utf-8") as f:
        f.write(f"\n关机命令返回码：{'0（已安排关机）' if ok else '非 0（未能安排）'}\n")
        f.write(("输出：" + detail[:400] + "\n") if detail else "输出：（无）\n")
        if not ok:
            f.write("\n自动关机未成功，请手动关机；安装包已经安全保存在本机。\n")
        f.flush()
        os.fsync(f.fileno())
    log("已安排关机，倒计时 " + str(COUNTDOWN) + " 秒" if ok else
        "关机命令失败，已写入记录，保持开机")
    return 0 if ok else 1


def main() -> int:
    log("自动关机守护启动（仅在 IPA 下载并校验成功后触发）")
    log(f"等待标记：{FLAG}")
    start = time.monotonic()

    while (time.monotonic() - start) / 60 < MAX_MINUTES:
        if FAIL.exists() and not FLAG.exists():
            log("检测到「构建未完成.txt」：编译未成功，按约定不关机，保持开机便于排查")
            print("DONE NO-SHUTDOWN", flush=True)
            return 0
        if FLAG.exists() and valid_ipa() and verify_flag_matches():
            log("标记存在且 IPA 复验通过，准备关机")
            rc = do_shutdown()
            print("DONE SHUTDOWN rc=" + str(rc), flush=True)
            return rc
        if FLAG.exists() and not (valid_ipa() and verify_flag_matches()):
            log("标记已出现但 IPA 复验未通过，继续等待（不关机）")
        time.sleep(INTERVAL)

    log("守护超时，未检测到合格安装包，不关机")
    print("DONE TIMEOUT NO-SHUTDOWN", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
