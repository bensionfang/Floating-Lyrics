# yt_search.parse_results 的回歸測試 (不打網路):venv\Scripts\python.exe tests/test_yt_search.py
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from yt_search import extract_initial_data, parse_results


def vr(vid, title, channel, length):
    """搜尋頁 JSON 裡一筆影片的最小形狀 (欄位名照真實回應)。"""
    return {"videoRenderer": {
        "videoId": vid,
        "title": {"runs": [{"text": title}]},
        "ownerText": {"runs": [{"text": channel}]},
        "lengthText": {"simpleText": length},
        "thumbnail": {"thumbnails": [{"url": "small.jpg"}, {"url": "big.jpg"}]},
    }}


# videoRenderer 埋在很深的巢狀結構裡,而且路徑會隨改版變 —— 解析是整包走訪出來的
DATA = {"contents": {"twoColumnSearchResultsRenderer": {"primaryContents": {
    "sectionListRenderer": {"contents": [{"itemSectionRenderer": {"contents": [
        vr("aaa", "官方 MV", "SomeLabel", "4:21"),
        {"adSlotRenderer": {"note": "廣告之類的雜物,不該被當成影片"}},
        vr("bbb", "音源", "Artist - Topic", "4:20"),
        vr("ccc", "現場版", "SomeChannel", "9:99"),
    ]}}]}}}}}

items = parse_results(DATA)
assert [i["videoId"] for i in items][:1] == ["aaa"], "第一筆是官方 MV"
assert items[0]["title"] == "官方 MV"
assert items[0]["channel"] == "SomeLabel"
assert items[0]["durationSec"] == 4 * 60 + 21, "mm:ss 換算成秒"
assert items[0]["thumb"] == "big.jpg", "縮圖取最大那張"
assert len(items) == 3, "非影片的節點不算進來"

# `- Topic` 是自動產生的音訊上傳 (畫面是一張靜態封面),當 MV 沒有意義 → 往後排
assert items[-1]["videoId"] == "bbb", "- Topic 排到最後"

# 有歌曲時長時,差 30 秒內的往前排;差太多的往後 (現場版/合輯)
close = parse_results(DATA, duration=261)
assert [i["videoId"] for i in close] == ["aaa", "ccc", "bbb"], "時長吻合的往前,但 Topic 仍最後"
far = parse_results(DATA, duration=600)
assert far[0]["videoId"] == "aaa", "都不吻合時維持 YouTube 的原順序"

# 時長換算:hh:mm:ss 與「拿不到」
one_hour = {"contents": [vr("ddd", "長片", "Ch", "1:02:33"), vr("eee", "直播中", "Ch", "")]}
r = parse_results(one_hour)
assert r[0]["durationSec"] == 3753, "hh:mm:ss"
assert r[1]["durationSec"] == 0, "沒有時長 (直播) 回 0 而不是炸掉"

# limit
assert len(parse_results(DATA, limit=2)) == 2

# 壞掉的輸入一律回空 list,不拋例外 —— YouTube 改版時該安靜退回純黑底
assert parse_results(None) == []
assert parse_results({}) == []
assert parse_results({"contents": "不是預期的形狀"}) == []
assert parse_results([{"videoRenderer": {"title": {"runs": [{"text": "沒有 videoId"}]}}}]) == []

# HTML 挖 JSON 的兩種寫法都要認得
assert extract_initial_data('<script>var ytInitialData = {"a": 1};</script>') == {"a": 1}
assert extract_initial_data('window["ytInitialData"] = {"a": 2};') == {"a": 2}
assert extract_initial_data("") is None
assert extract_initial_data("<html>沒有那個變數</html>") is None
assert extract_initial_data("var ytInitialData = {壞掉的 JSON};") is None

print("test_yt_search: OK")
