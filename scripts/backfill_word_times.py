"""
把逐字時間補進 `word_times`(平常只有播到那首歌、而且走 `source:'all'` 那條路時才會存,
所以舊庫幾乎是空的 —— 實測 429 首日文歌只有 29 首有,不是抓不到,是根本沒查過)。

  venv\\Scripts\\python.exe scripts/backfill_word_times.py
  venv\\Scripts\\python.exe scripts/backfill_word_times.py --limit 30 --force

已經查過的(含負快取的空 `{}`)預設跳過,中斷後直接重跑就會接著跑。

**只問 QQ。** 三家裡只有它的 QRC 帶逐字標記:網易的 yrc 公開 API 拿不到(要 eapi 加密)、
Lrclib 從來沒有。酷狗的 krc 雖然行內有 `<offset,length,0>`,但實測 18 首抽樣兩家各 78%、
**聯集只多一首而且那首只有 1 行**(湊不成整首,會被「全有或全無」擋掉),多接一家等於白做。

抓回來的逐字時間**不必跟 cache 裡那份歌詞同源** —— `web-app/word-times.js` 是把整首歌串成
一條字元流再單調前進比對的,跨來源本來就是常態(中位數 98%)。對不上的歌那邊會整份丟掉,
所以就算 QQ 配到別首歌,結果也只是「沒有逐字」而不是亂填。
"""
import os
import re
import sys
import time

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import cn_music
from db import db

KANA = re.compile(r'[ぁ-ゟァ-ヿ]')
DELAY = 2.0
# QQ 的搜尋端點限流很兇,被擋時是「靜默回空結果」而不是報錯。連續這麼多首都配不到歌
# 就當作被限流了 —— 再跑下去只是白打請求(而且分不出是限流還是真的沒有)。
GIVE_UP_AFTER = 8


def main():
    args = sys.argv[1:]
    force = '--force' in args
    limit = int(args[args.index('--limit') + 1]) if '--limit' in args else None

    rows = db.cursor.execute('SELECT artist, title, lyrics FROM cache').fetchall()
    todo = [r for r in rows if r[2] and KANA.search(r[2])]
    if limit:
        todo = todo[:limit]

    found = empty = miss = skipped = 0
    dry = 0   # 連續配不到歌的次數
    for i, (artist, title, _) in enumerate(todo, 1):
        if not force and db.get_word_times(artist, title) is not None:
            skipped += 1
            continue

        # 時長只是 _pick_song 的加分證據,拿不到就算了(它仍然要求歌名對得上)
        row = db.cursor.execute(
            'SELECT AVG(duration) FROM listening_history WHERE artist=? AND title=?',
            (artist, title)).fetchone()
        duration = row[0] if row and row[0] else None

        try:
            r = cn_music._fetch_qqmusic(artist, title, duration) or {}
        except Exception as e:
            print(f'  [{i}/{len(todo)}] ! {str(e)[:40]}  {artist} / {title}')
            r = {}

        if r.get('word_times'):
            db.save_word_times(artist, title, r['word_times'])
            found += 1
            dry = 0
            n = len(r['word_times'].get('ms') or [])
            print(f'  [{i}/{len(todo)}] ✔ {n:>4} 字  {artist} / {title}')
        elif r.get('lyrics'):
            # QQ 真的回答了、那份就是沒有 QRC —— 這才配寫負快取
            db.save_word_times(artist, title, {})
            empty += 1
            dry = 0
            print(f'  [{i}/{len(todo)}] ✘ 沒有逐字  {artist} / {title}')
        else:
            # 配不到歌:可能是 QQ 沒收錄,也可能是被限流。**兩者分不出來,所以不寫負快取**
            miss += 1
            dry += 1
            print(f'  [{i}/{len(todo)}] ？ 配不到歌  {artist} / {title}')
            if dry >= GIVE_UP_AFTER:
                print(f'\n連續 {dry} 首配不到歌,當作被 QQ 限流,先停。等一陣子再重跑就接得下去。')
                break
        time.sleep(DELAY)

    print(f'\n有逐字 {found} 首 / 沒逐字 {empty} 首 / 配不到 {miss} 首 / 之前查過跳過 {skipped} 首')
    if found + empty:
        print(f'涵蓋率 {found / (found + empty) * 100:.0f}% (以「QQ 有這首歌」為分母)')


if __name__ == '__main__':
    main()
