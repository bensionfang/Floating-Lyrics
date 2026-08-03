"""
search_fallback.gather_providers 的回歸測試。

  venv\\Scripts\\python.exe tests/test_fallback_parallel.py

釘住兩件事:
  1. **四家真的並行** —— 依序的話備選歌詞搜尋 15.6 秒裡有 11 秒是白等的。
  2. **結果照 providers 的順序,不照完成先後** —— source 名稱會顯示在 UI 的來源標示上,
     照完成先後收就是每次跑排出來不一樣 (慢的那家先回時最明顯)。

不打真的網路:把 fetch_single_provider 換成會睡覺的假貨。
"""
import os
import sys
import time

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')   # 繁中 Windows 預設 cp950,中文訊息會變亂碼

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import search_fallback

failed = 0


def check(ok, label, detail=""):
    global failed
    if not ok:
        failed += 1
    print(f"{'PASS' if ok else 'FAIL'}  {label}{': ' + detail if detail else ''}")


PROVIDERS = ["NetEase", "Lrclib", "Musixmatch", "Megalobiz"]
QUERIES = [("歌名", "歌手"), ("romaji", "artist")]

# 每家的 (延遲秒數, 哪一個 query 變體才命中 / None = 這家沒有)
PLAN = {
    "NetEase":   (0.6, None),   # 最慢又沒東西 —— 依序的話它會擋住後面三家
    "Lrclib":    (0.2, 0),
    "Musixmatch": (0.2, 1),     # 第一個變體沒中,第二個才中
    "Megalobiz": (0.1, None),
}

calls = []


def fake_fetch(query, provider):
    delay, hit_idx = PLAN[provider]
    time.sleep(delay)
    calls.append((provider, query))
    if hit_idx is None:
        return None
    return f"[{provider}] lyrics" if query == f"{QUERIES[hit_idx][0]} {QUERIES[hit_idx][1]}" else None


search_fallback.fetch_single_provider = fake_fetch

t0 = time.monotonic()
hits = search_fallback.gather_providers(PROVIDERS, QUERIES)
elapsed = time.monotonic() - t0

# 一家自己要花的時間:命中前的每個變體都要問一次,沒命中的得把變體走完
cost = {p: PLAN[p][0] * (len(QUERIES) if PLAN[p][1] is None else PLAN[p][1] + 1)
        for p in PROVIDERS}
sequential = sum(cost.values())   # 依序 = 相加
slowest = max(cost.values())      # 並行 = 最慢那家

# 門檻取兩者的中間值:比對「相加」而不是比對某個寫死的秒數,CI 機器慢也不會偽陽性。
# (直接寫 slowest * 1.05 會在忙碌的機器上抖成紅色 —— 這支測的是「有沒有並行」,不是效能基準)
check(elapsed < (slowest + sequential) / 2, "四家並行 (時間接近最慢那家,不是四家相加)",
      f"{elapsed:.2f}s (最慢一家 {slowest:.2f}s / 依序要 {sequential:.2f}s)")

check(hits["Lrclib"] == "[Lrclib] lyrics" and hits["Musixmatch"] == "[Musixmatch] lyrics",
      "有歌詞的兩家都收得到")
check(hits["NetEase"] is None and hits["Megalobiz"] is None,
      "沒歌詞的回 None (呼叫端才好過濾掉)")

# 呼叫端就是這樣重組的 (search_fallback.main 的 return_all 分支)
order = [p for p in PROVIDERS if hits[p]]
check(order == ["Lrclib", "Musixmatch"], "順序照 providers 而不是完成先後",
      " / ".join(order))

# 內層的 query 變體要維持依序 + 第一個命中就停:Lrclib 第一個就中,不該再問第二個
lrclib_calls = [q for p, q in calls if p == "Lrclib"]
check(len(lrclib_calls) == 1, "命中就不再問下一個 query 變體", f"{len(lrclib_calls)} 次")
mm_calls = [q for p, q in calls if p == "Musixmatch"]
check(mm_calls == ["歌名 歌手", "romaji artist"], "沒命中才往下一個變體,而且照原順序",
      " → ".join(mm_calls))

check(search_fallback.gather_providers([], QUERIES) == {},
      "providers 空清單不炸 (ThreadPoolExecutor 的 max_workers 不能是 0)")

print("\n全部通過" if failed == 0 else f"\n{failed} 項失敗")
sys.exit(0 if failed == 0 else 1)
