"""
量測「中國三家 (網易/QQ/酷狗) 從這個 IP 打得通嗎」。

在家裡跑一次當基準,再到境外主機 (雲端方案的候選機器) 跑一次比對 ——
**這是決定要不要投入雲端方案的前置實測**,三家全掛的話雲端那台只剩 lrclib,等於白做。

用法 (只需要 requests + jaconv,不必裝 fugashi/unidic):
    venv/Scripts/python.exe scripts/check_cn_reachability.py      # 本機
    python3 scripts/check_cn_reachability.py                      # 境外主機

必須從 repo 根目錄跑 (要 import 同層的 cn_music / qrc_decrypt)。
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests

import cn_music

# 三首都是全庫實測過三家都有的日文歌,避免「這首本來就沒收錄」污染結果
SONGS = [
    ("サカナクション", "新宝島", 291),
    ("ヨルシカ", "春泥棒", 260),
    ("米津玄師", "Lemon", 256),
]


def where_am_i() -> str:
    try:
        d = requests.get("https://ipinfo.io/json", timeout=8).json()
        return f"{d.get('ip')} / {d.get('country')} / {d.get('org', '')[:40]}"
    except Exception as e:
        return f"(查不到出口 IP: {e})"


def main() -> int:
    # 繁中 Windows 預設 cp950,不轉的話印日文歌名直接 UnicodeEncodeError (同 pytools.main)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(f"出口: {where_am_i()}\n")
    totals = {name: 0 for name in cn_music._SOURCES}

    for artist, title, dur in SONGS:
        print(f"{artist} / {title}")
        for name, fn in cn_music._SOURCES.items():
            t0 = time.time()
            try:
                r = fn(artist, title, dur) or {}
                ms = int((time.time() - t0) * 1000)
                lines = len((r.get("lyrics") or "").strip().splitlines())
                if lines:
                    totals[name] += 1
                    print(f"  {name:9} OK    {lines:3} 行 / {len(r.get('translations') or {}):3} 譯文"
                          f" / {'有' if r.get('word_times') else '無'}逐字  {ms} ms")
                else:
                    print(f"  {name:9} 空    (連得上但沒歌詞 —— 可能是搜尋被擋或這首沒收錄)  {ms} ms")
            except Exception as e:
                print(f"  {name:9} FAIL  {type(e).__name__}: {str(e)[:80]}"
                      f"  {int((time.time() - t0) * 1000)} ms")
        print()

    print("結論:")
    for name, hit in totals.items():
        verdict = "可用" if hit else "**不可用**"
        print(f"  {name:9} {hit}/{len(SONGS)} 首  {verdict}")
    # 一家都不通 = 雲端那台拿不到中國平台的歌詞與羅馬字提示,方案不成立
    return 0 if any(totals.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
