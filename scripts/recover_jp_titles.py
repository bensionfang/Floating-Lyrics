"""
把「歌名被意譯成英文/中文、utaten 因此查不到」的歌，用 **utaten 自己的行重疊率**當證據還原成日文原名。

    venv\\Scripts\\python.exe scripts/recover_jp_titles.py            # dry-run
    venv\\Scripts\\python.exe scripts/recover_jp_titles.py --apply    # 備份後寫入
    venv\\Scripts\\python.exe scripts/recover_jp_titles.py --artist Penthouse --limit 5

**跟 `restore_jp_titles.py` 是兩件事，不要合併。** 那支只認「時長 ±3 秒吻合」，而卡住它那 28 首
的原因正是**沒有時長**（那批是孤兒列，不會再進 `listening_history`）。這支換一種證據：

  拿候選日文歌名去 utaten 抓一次注音，**跟我們手上的歌詞對得上幾行**就是證據。

實測（Penthouse 五首意譯歌名）：`Shooting Star` → `流星群` 100%、`Signpost` → `恋標` 97%、
`Sparklers` → `閃光花` 86%、`永保青春 - 第6屆…` → `青く在れ` 85%、`Single focus` → `単焦点` 78%；
猜錯的 `Undertaker` → `アイデンティファイ` 是 **0%**，當場擋掉。訊號分得非常開。

**限制：行重疊分不出原曲／Live 版／翻唱**（歌詞一樣，`りぶcover` 就是這樣騙過去的）。
所以它**補時長的不足，不取代時長** —— 時長證明「同一個錄音」，行重疊證明「同一首歌的內容」。
這支因此**只改歌名不改歌手**：候選一律取自「這位歌手自己的 iTunes JP 曲目列」，
翻唱（別人唱的）從一開始就不在候選裡。

為什麼 `restore_jp_titles.py` 撈不到這批：
  - `永保青春 - 第6屆…` 不是純英數，被它的 `LATIN_TITLE` 候選條件濾掉；
  - 其餘拿英文名去 iTunes JP storefront 搜，**那邊只登記日文名**，搜不到。
所以這支不用歌名去搜，改成**抓整個歌手的曲目列**再逐個比對。

打別人網站的量：每位歌手 1 次 iTunes（存 `.itunes_tracks.json`，重跑不再打），
每首歌最多 `MAX_TRIES` 次 utaten。候選先用**歌詞最後一個時間戳 vs iTunes 曲目長度**排序，
所以多半第一、二個就中。
"""
import json
import os
import re
import shutil
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import utaten
from restore_jp_titles import UA, REQUEST_GAP, existing_tables, merge_one

DB = os.environ.get('DB_PATH') or os.path.join(ROOT, 'lyrics_data.db')
TRACKS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.itunes_tracks.json')

KANA = re.compile(r'[ぁ-ゟァ-ヿ]')
CJK = re.compile(r'[ぁ-ゟァ-ヿ一-鿿]')
LATIN_TITLE = re.compile(r'^[\x20-\x7E]+$')
TS = re.compile(r'\[(\d+):(\d+(?:\.\d+)?)\]')
# 翻唱／伴奏版：歌名一樣但不是本人唱的。同 game.js 的 filterArtistTracks
JUNK = re.compile(r'カラオケ|karaoke|instrumental|オルゴール', re.I)

MIN_COVER = 0.60   # 實測對的 78~100%、錯的 0%,中間空得很開。抓緊一點,誤判是不可逆的改名
MAX_TRIES = 5      # 每首歌最多打 utaten 幾次。候選已經照長度排序,多半第一二個就中
# 同 backfill_utaten.py 的 1 秒不夠:這支對同一位歌手連打好幾次,實測會踩到 read timeout,
# 而 `fetch_hints` 把逾時吞掉回 {},跟「utaten 真的沒這首」分不出來 —— 看起來就是判斷錯。
# 慢一點跑得完比快而漏判好;真的漏了重跑就是(這支冪等,已還原的不再是目標)。
UTATEN_GAP = 2.0


def norm(s):
    return re.sub(r'[^0-9a-z぀-ヿ一-鿿]', '', (s or '').lower())


def last_timestamp(lrc):
    """歌詞最後一個時間戳（秒）。它是曲長的下界 —— 尾奏之後不會再有歌詞。"""
    best = 0.0
    for m, s in TS.findall(lrc or ''):
        best = max(best, int(m) * 60 + float(s))
    return best


def load_tracks():
    try:
        with open(TRACKS_FILE, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def itunes_tracks(artist, cache):
    """
    這位歌手在 iTunes **JP storefront** 的曲目列 [(歌名, 秒數)]。

    `country=JP` 不能改 —— 別的 storefront 會把日文歌名換成羅馬字/英譯，
    那正是這支要還原的東西（同 `/api/game/artist` 那條的理由）。
    """
    if artist in cache:
        return cache[artist]
    term = urllib.parse.quote(artist)
    url = (f'https://itunes.apple.com/search?term={term}'
           '&country=JP&entity=song&limit=200')
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode('utf-8'))
    except Exception as e:
        print(f'    iTunes 查詢失敗（{e}），跳過（**不記快取**，重跑會再試）')
        return None
    want = norm(artist)
    out = []
    for h in data.get('results') or []:
        if want and want not in norm(h.get('artistName')):
            continue
        name = h.get('trackName') or ''
        if not name or JUNK.search(name):
            continue
        out.append([name, (h.get('trackTimeMillis') or 0) / 1000.0])
    cache[artist] = out
    with open(TRACKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)
    time.sleep(REQUEST_GAP)
    return out


def candidates(tracks, lrc):
    """
    照「iTunes 曲長 vs 歌詞最後一個時間戳」的接近程度排序的候選日文歌名。

    最後一個時間戳是曲長的**下界**，所以曲長比它短的直接淘汰（留 5 秒給時間戳誤差）。

    **不要排除「我們庫裡已經有的歌名」** —— 曾經加過那條，結果剛好擋掉最該修的情況：
    `go!go!vanillas` 的 `HEIAN` 與 `平安` 兩列同時存在（就是要合併的分裂），而 `平安`
    因為「已知」被踢出候選。守門本來就是行重疊率：候選若是另一首已知的歌，
    utaten 回的是那首的歌詞，跟我們手上這份重疊率接近 0，自然被擋掉。
    """
    last = last_timestamp(lrc)
    seen, out = set(), []
    for name, dur in tracks:
        n = norm(name)
        if not n or n in seen or not CJK.search(name):
            continue
        seen.add(n)
        if last and dur:
            if dur + 5 < last:
                continue
            out.append((dur - last, name))
        else:
            out.append((9999, name))
    out.sort(key=lambda x: x[0])
    return [name for _, name in out]


def verify(artist, title, lrc):
    """utaten 抓一次，回傳跟我們手上的歌詞的行重疊率。抓不到回 0。"""
    try:
        hints = utaten.fetch_hints(artist, title, lrc)
    except Exception:
        return 0.0
    finally:
        time.sleep(UTATEN_GAP)
    if not hints:
        return 0.0
    lines, _ = utaten.split_hints(hints)
    keys = set(utaten.lyric_keys(lrc))
    return len(keys & set(lines)) / max(len(keys), 1)


def main():
    args = sys.argv[1:]
    apply = '--apply' in args
    only_artist = args[args.index('--artist') + 1] if '--artist' in args else None
    limit = int(args[args.index('--limit') + 1]) if '--limit' in args else None

    if apply:
        shutil.copy(DB, DB + '.bak')
        print(f'已備份 → {DB}.bak\n')
    else:
        print('*** dry-run，不會寫入。確認無誤後加 --apply ***\n')

    conn = sqlite3.connect(DB)
    conn.isolation_level = None
    tables = existing_tables(conn)

    # 目標:日文歌詞、歌名卻是純英數、而且 utaten 查過是空的(負快取)
    rows = conn.execute('''SELECT c.artist, c.title, c.lyrics FROM cache c
                           JOIN utaten_hints u ON u.artist=c.artist AND u.title=c.title
                           WHERE trim(u.data) IN ('', '{}')''').fetchall()
    todo = [r for r in rows
            if r[2] and KANA.search(r[2]) and LATIN_TITLE.match(r[1])
            and (not only_artist or r[0] == only_artist)]
    todo.sort()
    if limit:
        todo = todo[:limit]

    tcache = load_tracks()
    found, tried = [], 0
    print(f'目標 {len(todo)} 首（歌詞是日文、歌名是英文、utaten 查不到）\n')

    conn.execute('BEGIN')
    try:
        for artist, title, lrc in todo:
            tracks = itunes_tracks(artist, tcache)
            if not tracks:
                print(f'  ✘ {artist} / {title}   [iTunes 沒有這位歌手的曲目]')
                continue
            # **iTunes JP 自己就登記這個英文歌名 = 那本來就是原名,沒東西可還原。**
            # 實測 30 個目標裡有 ~20 個是這種 (`水中スピカ / Oshiroi`、`muque / TIME`、
            # `NOMELON NOLEMON / SUGAR`),不先擋掉就是白打 5 次 utaten 再回報「對不上」,
            # 而且看起來像判斷失敗。
            if norm(title) in {norm(n) for n, _ in tracks}:
                print(f'  – {artist} / {title}   [iTunes JP 也是這個歌名，本來就是原名]')
                continue

            cands = candidates(tracks, lrc)[:MAX_TRIES]
            if not cands:
                print(f'  ✘ {artist} / {title}   [沒有長度對得上的日文歌名候選]')
                continue
            hit = None
            for name in cands:
                tried += 1
                cover = verify(artist, name, lrc)
                if cover >= MIN_COVER:
                    hit = (name, cover)
                    break
            if not hit:
                print(f'  ✘ {artist} / {title}   [試了 {len(cands)} 個候選都對不上]')
                continue
            name, cover = hit
            print(f'  ✔ {artist} / {title}\n      → {name}   [行重疊 {cover:.0%}]')
            u, d = merge_one(conn, (artist, title), (artist, name), tables, apply)
            print(f'      改名 {u} 列，合併刪除 {d} 列')
            found.append((artist, title, name, cover))
        conn.execute('COMMIT' if apply else 'ROLLBACK')
    except Exception:
        conn.execute('ROLLBACK')
        raise

    print(f'\n還原 {len(found)} / {len(todo)} 首（共打了 {tried} 次 utaten）')
    print('（`–` 那幾行不是失敗：那些歌的官方名字本來就是英文，utaten 沒收是因為它只收日文歌名）')
    if not apply and found:
        print('確認無誤後加 --apply 實際寫入。')
    if found and apply:
        print('接著跑 scripts/backfill_utaten.py 把新歌名的注音抓回來。')
    conn.close()


if __name__ == '__main__':
    main()
