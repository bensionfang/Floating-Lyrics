"""
歌詞搜尋備用模組
當主要的 syncedlyrics 庫找不到合適結果，或需要取得其他來源的歌詞時，
此腳本作為 CLI 供其他語言(或需要獨立執行時)呼叫，主要封裝了 QQMusic 等搜尋邏輯。
"""
import sys
import re
import json
import logging
import syncedlyrics
import requests
from concurrent.futures import ThreadPoolExecutor

# 平假名/片假名 (日文獨有)。iTunes 日區還原只在結果含假名時才採用,
# 中文歌正確名沒假名,避免被日區隨便一個 hit 帶偏。
def _has_kana(s):
    return bool(re.search(r'[぀-ヿ]', s or ''))

# QQ 音樂歌詞由 cn_music.py 的 musicu.fcg 端點處理,這裡不再自行抓 QQ。

def fetch_single_provider(query, provider):
    """透過 syncedlyrics 套件向單一供應商請求歌詞"""
    try:
        return syncedlyrics.search(query, providers=[provider])
    except:
        return None


def gather_providers(providers, queries):
    """
    每一家 provider 問到第一個命中的 query 變體為止,回 {provider: 歌詞或 None}。

    **四家是並行的,不要改回依序 for。** 它們互不相依,而 `--all` 這條路要收集全部候選、
    沒有早退,依序就只是把延遲加起來 —— 實測整支備選歌詞搜尋 15.6 秒裡有 11 秒全在這裡
    (而且那一次四家一筆都沒回)。內層的 query 變體迴圈**維持依序**:那是有優先度的
    (原名 → 羅馬字 → …),第一個命中就該收。

    回傳是 dict 而不是 list,呼叫端一律照 `providers` 的順序重組 —— source 名稱會顯示在
    UI 的來源標示上,照完成先後收就是每次跑排出來不一樣 (同 server.js searchOptions 的桶子)。
    """
    def first_hit(p):
        for q_title, q_artist in queries:
            lyric = fetch_single_provider(f"{q_title} {q_artist}", p)
            if lyric:
                return lyric
        return None

    if not providers:
        return {}
    # fetch_single_provider 自己把例外吞掉了,所以 pool.map 不會炸出來
    with ThreadPoolExecutor(max_workers=len(providers)) as pool:
        return dict(zip(providers, pool.map(first_hit, providers)))

from utils import text_to_romaji_query, romaji_to_hiragana
from db import db

def generate_queries(t, a):
    # 先過濾別名
    a = db.get_artist_alias(a)
    
    queries = []
    seen = set()
    def add_q(qt, qa):
        if (qt, qa) not in seen and qt and qa:
            seen.add((qt, qa))
            queries.append((qt, qa))
    rt = text_to_romaji_query(t)
    ra = text_to_romaji_query(a)
    ht = romaji_to_hiragana(t)
    ha = romaji_to_hiragana(a)
    
    rt_valid = rt and rt.lower() != t.lower()
    ra_valid = ra and ra.lower() != a.lower()
    ht_valid = ht and ht != t
    ha_valid = ha and ha != a

    # 1. 優先：原始歌名 + 平假名歌手
    if ha_valid:
        add_q(t, ha)
        
    # 2. 原始歌名 + 原始歌手
    add_q(t, a)
    
    # 3. 平假名歌名 + 平假名歌手
    if ht_valid and ha_valid:
        add_q(ht, ha)
        
    # 4. 平假名歌名 + 原始歌手
    if ht_valid:
        add_q(ht, a)
        
    # 5. 羅馬音處理
    if rt_valid:
        add_q(rt, a)
        add_q(rt.replace(" ", ""), a)
    if ra_valid:
        add_q(t, ra)
    if rt_valid and ra_valid:
        add_q(rt, ra)
        add_q(rt.replace(" ", ""), ra)
    return queries

def main():
    """
    主程式入口，負責解析命令列參數並輸出 JSON 格式的結果
    支援 `--all` 參數來取得所有來源的備用選項
    """
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Missing title or artist"}))
        return
        
    title = sys.argv[1]
    artist = sys.argv[2]
    return_all = len(sys.argv) > 3 and sys.argv[3] == "--all"
    
    query = f"{title} {artist}"
    
    preferred_source = "NetEase"
    try:
        import os
        settings_path = os.environ.get('LYRICS_SETTINGS_PATH') or os.path.join(os.path.dirname(__file__), 'settings.json')
        if os.path.exists(settings_path):
            with open(settings_path, 'r', encoding='utf-8') as f:
                s = json.load(f)
                preferred_source = s.get("preferred_source", "NetEase")
    except:
        pass

    # syncedlyrics 只認得這幾家;Kugou / QQMusic 由我們自己的 client 處理,別塞進來白跑一輪
    supported = ["NetEase", "Lrclib", "Musixmatch", "Megalobiz"]
    providers = [preferred_source] if preferred_source in supported else []
    for p in supported:
        if p not in providers:
            providers.append(p)
    
    if return_all:
        # 獲取所有可能的備用歌詞列表 (四家並行,見 gather_providers)
        hits = gather_providers(providers, generate_queries(title, artist))
        results = [{"lyrics": hits[p], "source": p} for p in providers if hits[p]]

        if len(results) == 0:
            try:
                itunes_url = "https://itunes.apple.com/search"
                params = {"term": f"{title} {artist}", "entity": "song", "limit": 1, "country": "jp"}
                resp = requests.get(itunes_url, params=params, timeout=5)
                if resp.status_code == 200:
                    it_results = resp.json().get("results", [])
                    if it_results:
                        jp_title = it_results[0].get("trackName", title)
                        jp_artist = it_results[0].get("artistName", artist)
                        if (jp_title != title or jp_artist != artist) and (_has_kana(jp_title) or _has_kana(jp_artist)):
                            it_hits = gather_providers(providers, generate_queries(jp_title, jp_artist))
                            results = [{"lyrics": it_hits[p], "source": f"iTunes_Fallback({p})"}
                                       for p in providers if it_hits[p]]
            except:
                pass

        print(json.dumps({"success": True, "results": results}))
        return

    # 預設行為：透過 syncedlyrics 支援的平台搜尋 (QQ 由 cn_music.py 處理)
    try:
        lyric, source = None, None
        queries = generate_queries(title, artist)
        # 逐個 provider 問 (而不是把整串丟給 syncedlyrics),才知道歌詞真正來自哪一家 ——
        # 這個名字會原樣顯示在 UI 的來源標示上。順序沿用 providers (偏好來源排第一)。
        for q_title, q_artist in queries:
            query = f"{q_title} {q_artist}"
            for p in providers:
                lyric = fetch_single_provider(query, p)
                if lyric:
                    source = p
                    break
            if lyric:
                break
        if not lyric:
            try:
                itunes_url = "https://itunes.apple.com/search"
                params = {"term": f"{title} {artist}", "entity": "song", "limit": 1, "country": "jp"}
                resp = requests.get(itunes_url, params=params, timeout=5)
                if resp.status_code == 200:
                    results = resp.json().get("results", [])
                    if results:
                        jp_title = results[0].get("trackName", title)
                        jp_artist = results[0].get("artistName", artist)
                        if (jp_title != title or jp_artist != artist) and (_has_kana(jp_title) or _has_kana(jp_artist)):
                            # 逐家問而不是把整串丟給 syncedlyrics,理由同上面主迴圈:
                            # 來源標示要說得出是哪一家給的 (iTunes_Fallback(NetEase))。
                            # 請求數不變 —— syncedlyrics 拿到 providers 串也是照順序一家家試。
                            query = f"{jp_title} {jp_artist}"
                            for p in providers:
                                lyric = fetch_single_provider(query, p)
                                if lyric:
                                    source = f"iTunes_Fallback({p})"
                                    break
            except:
                pass
            
        if lyric:
            print(json.dumps({"success": True, "lyrics": lyric, "source": source}))
        else:
            print(json.dumps({"success": False, "error": "Not found"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    main()
