# -*- coding: utf-8 -*-
"""把电脑版「文脉在兹」的书库导出成一份离线快照，供 iOS / 安卓离线版导入。

用法：
    python export_snapshot.py                       # 自动定位电脑版 data/，输出到当前目录
    python export_snapshot.py --out D:/xxx/snapshot.json
    python export_snapshot.py --data D:/xxx/HistoryStandalone/data

快照是纯 JSON，包含全部书籍、章节、锚点段落原文、简繁对照表与检索设置。
导出后可用「文件」App / 微信 / 隔空投送传到 iPhone，在离线 App 的「导入」页选择即可。
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_DATA = HERE.parent / "HistoryStandalone" / "data"
FORMAT = "wenmaizaizi-snapshot"


def read_json(path: Path, default):
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        pass
    return default


def load_variants(data: Path) -> dict:
    """合并电脑版手工变体与随程序分发的完整对照表。

    解压包单独使用时没有同级电脑版工程，此时必须回落到随包附带的
    web/variants.json，否则导出快照会丢掉整张简繁对照表。
    """
    base = read_json(data / "variants.json", {}) or {}
    equiv = dict(base.get("char_equiv", {}))
    words = dict(base.get("words", {}))
    sources = [
        data / "variants_full.json",
        HERE.parent / "HistoryStandalone" / "variants_full.json",
        HERE / "variants_full.json",
        HERE / "web" / "variants.json",
        HERE.parent / "HistoryStandalone" / "web" / "variants.json",
    ]
    for src in sources:
        full = read_json(src, {}) or {}
        for k, v in (full.get("char_equiv", {}) or {}).items():
            equiv[k] = "".join(dict.fromkeys(equiv.get(k, "") + str(v)))
        for k, v in (full.get("words", {}) or {}).items():
            words.setdefault(k, v)
    return {"char_equiv": equiv, "words": words}


def build_snapshot(data: Path) -> dict:
    cat = read_json(data / "catalog.json", {"books": []})
    books = []
    for meta in cat.get("books", []):
        bid = meta.get("id", "")
        secs = read_json(data / "books" / bid / "sections.json", {"sections": []})
        sections = []
        for i, s in enumerate(secs.get("sections", []), 1):
            sections.append({
                "no": s.get("no", i),
                "title": s.get("title", "正文"),
                "paras": [{"anchor": p.get("anchor", ""), "text": p.get("text", "")}
                          for p in s.get("paras", []) if p.get("text")],
            })
        books.append({
            "id": bid, "title": meta.get("title", "未命名"),
            "code": meta.get("code", "BK"), "author": meta.get("author", ""),
            "publisher": meta.get("publisher", ""), "year": meta.get("year", ""),
            "source": meta.get("source", ""), "note": meta.get("note", ""),
            "kind": meta.get("kind", ""), "pinned": bool(meta.get("pinned", False)),
            "created": meta.get("created", ""), "sections": sections,
        })
    settings = read_json(data / "settings.json", {"per_book": 20, "context": 240})
    return {
        "format": FORMAT, "version": 1,
        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "source": "文脉在兹 Desktop",
        "books": books,
        "variants": load_variants(data),
        "settings": {"per_book": settings.get("per_book", 20),
                     "context": settings.get("context", 240)},
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="导出电脑版书库为手机离线快照")
    ap.add_argument("--data", default=str(DEFAULT_DATA), help="电脑版 data/ 目录")
    ap.add_argument("--out", default=str(HERE / "文脉在兹_书库快照.json"), help="输出 JSON 路径")
    args = ap.parse_args()
    data, out = Path(args.data), Path(args.out)
    if not data.is_dir():
        print("提示：电脑版书库目录不存在（%s），将导出空书库快照。" % data)
    snap = build_snapshot(data)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snap, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n_para = sum(len(p["text"]) for b in snap["books"] for s in b["sections"] for p in s["paras"])
    print("已导出：%s" % out)
    print("  %d 部书 / %d 节 / %d 段 / %d 字 / %d 条简繁对照" % (
        len(snap["books"]), sum(len(b["sections"]) for b in snap["books"]),
        sum(len(s["paras"]) for b in snap["books"] for s in b["sections"]),
        n_para, len(snap["variants"]["char_equiv"])))
    print("把该文件传到 iOS / 安卓手机，在「文脉在兹」App「导入」页选择即可；整个过程不需要网络。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
