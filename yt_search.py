"""
YouTube 搜尋 client —— 卡拉OK模式的 MV 背景用。

**為什麼是抓搜尋頁而不是 Data API**:官方 API 要 key,而使用者得自己去 Google Cloud 申請,
app 又多一個密鑰要保管 (BYOK 那套 2026-08-04 已經整組拆掉,不想再長回來)。搜尋頁的
`ytInitialData` 是伺服器端就渲染好的 JSON,拿得到 videoId/標題/頻道/時長,夠用。
代價是 YouTube 改版時會壞 —— 所以**解析失敗一律回空 list,絕不拋例外**:那時卡拉OK頁
安靜地退回純黑底,而不是整頁掛掉。

網路擷取 (`fetch_html`) 與解析 (`parse_results`) 刻意分開,測試只打後者、不打真站
(同 `tests/test_utaten.py` 的做法)。
"""
import json
import re

import requests

SEARCH_URL = "https://www.youtube.com/results"
# sp=EgIQAQ%3D%3D = 「類型:影片」的篩選,把播放清單與頻道濾掉
VIDEO_FILTER = "EgIQAQ%3D%3D"
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"),
    "Accept-Language": "ja,en;q=0.8",
}
TIMEOUT = 10
MAX_RESULTS = 10
# 時長差在這個範圍內視為「就是這首歌」,排序時往前提
DURATION_TOLERANCE = 30


def fetch_html(query):
    """打搜尋頁,回 HTML 字串;失敗回空字串。"""
    try:
        r = requests.get(SEARCH_URL, params={"search_query": query, "sp": VIDEO_FILTER},
                         headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        return r.text
    except Exception:
        return ""


def extract_initial_data(html_text):
    """從搜尋頁 HTML 挖出 ytInitialData 那包 JSON;挖不到回 None。"""
    if not html_text:
        return None
    # 這個變數的寫法歷來有 `var ytInitialData =` 與 `window["ytInitialData"] =` 兩種
    m = re.search(r'(?:var\s+ytInitialData|window\["ytInitialData"\])\s*=\s*(\{.+?\});',
                  html_text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def _walk_video_renderers(node, out):
    """整包 JSON 的結構常改版,所以不寫死路徑,直接找出所有 videoRenderer。"""
    if isinstance(node, dict):
        vr = node.get("videoRenderer")
        if isinstance(vr, dict):
            out.append(vr)
        for v in node.values():
            _walk_video_renderers(v, out)
    elif isinstance(node, list):
        for v in node:
            _walk_video_renderers(v, out)


def _text_of(node):
    """YouTube 的文字欄位有 simpleText 與 runs 兩種寫法。"""
    if not isinstance(node, dict):
        return ""
    if isinstance(node.get("simpleText"), str):
        return node["simpleText"]
    runs = node.get("runs")
    if isinstance(runs, list):
        return "".join(r.get("text", "") for r in runs if isinstance(r, dict))
    return ""


def _duration_sec(vr):
    """`4:21` / `1:02:33` → 秒。拿不到回 0 (直播沒有時長)。"""
    raw = _text_of(vr.get("lengthText")) or ""
    parts = [p for p in raw.strip().split(":") if p.isdigit()]
    if not parts:
        return 0
    sec = 0
    for p in parts:
        sec = sec * 60 + int(p)
    return sec


def _thumb(vr):
    thumbs = (vr.get("thumbnail") or {}).get("thumbnails") or []
    return thumbs[-1].get("url", "") if thumbs else ""


def parse_results(data, duration=None, limit=MAX_RESULTS):
    """ytInitialData → [{videoId, title, channel, durationSec, thumb}]。

    排序只做兩件輕的,其餘照 YouTube 自己的順序:
      * `- Topic` 頻道往後排 —— 那是自動產生的音訊上傳,畫面是一張靜態封面,當 MV 沒有意義
      * 有歌曲時長時,差在 DURATION_TOLERANCE 內的往前排
    """
    renderers = []
    try:
        _walk_video_renderers(data, renderers)
    except Exception:
        return []

    seen = set()
    items = []
    for vr in renderers:
        try:
            vid = vr.get("videoId")
            if not vid or vid in seen:
                continue
            seen.add(vid)
            channel = _text_of((vr.get("ownerText") or vr.get("longBylineText") or {}))
            items.append({
                "videoId": vid,
                "title": _text_of(vr.get("title")),
                "channel": channel,
                "durationSec": _duration_sec(vr),
                "thumb": _thumb(vr),
            })
        except Exception:
            continue

    def rank(it):
        topic = 1 if it["channel"].strip().endswith("- Topic") else 0
        close = 0
        if duration and it["durationSec"]:
            close = 0 if abs(it["durationSec"] - duration) <= DURATION_TOLERANCE else 1
        return (topic, close)

    items.sort(key=rank)   # list.sort 是穩定的,同分維持 YouTube 的原順序
    return items[:limit]


def search(title, artist="", duration=None, limit=MAX_RESULTS):
    query = f"{artist} {title}".strip() if artist else (title or "").strip()
    if not query:
        return []
    return parse_results(extract_initial_data(fetch_html(query)), duration=duration, limit=limit)


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    t = sys.argv[1] if len(sys.argv) > 1 else "春泥棒"
    a = sys.argv[2] if len(sys.argv) > 2 else "ヨルシカ"
    for it in search(t, a):
        print(f"{it['videoId']}  {it['durationSec']:>5}s  {it['channel']}  |  {it['title']}")
