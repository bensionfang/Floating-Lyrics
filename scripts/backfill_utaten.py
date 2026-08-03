"""
把 utaten 的注音補進 `utaten_hints`(平常是播到那首歌時順手抓一次,這支是一次性補全)。

  venv\\Scripts\\python.exe scripts/backfill_utaten.py            # 全部日文歌
  venv\\Scripts\\python.exe scripts/backfill_utaten.py --corrections   # 只補有手改讀音的歌
  venv\\Scripts\\python.exe scripts/backfill_utaten.py --limit 30 --force

已經查過的(含負快取的空 `{}`)預設跳過,所以中斷後直接重跑就會接著跑。
每首之間睡 1 秒 —— 這是別人家的網站,沒有理由跑滿。
"""
import os
import re
import sys
import time

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import utaten
from db import db

KANA = re.compile(r'[ぁ-ゟァ-ヿ]')
DELAY = 1.0


def main():
    args = sys.argv[1:]
    force = '--force' in args
    only_corr = '--corrections' in args
    limit = None
    if '--limit' in args:
        limit = int(args[args.index('--limit') + 1])

    cur = db.cursor
    if only_corr:
        rows = cur.execute('''SELECT c.artist, c.title, c.lyrics FROM cache c
                              WHERE EXISTS(SELECT 1 FROM word_corrections w
                                           WHERE w.artist=c.artist AND w.title=c.title)''').fetchall()
    else:
        rows = cur.execute('SELECT artist, title, lyrics FROM cache').fetchall()

    todo = [r for r in rows if r[2] and KANA.search(r[2])]
    if limit:
        todo = todo[:limit]

    found = empty = skipped = 0
    for i, (artist, title, lyrics) in enumerate(todo, 1):
        if not force and db.get_utaten_hints(artist, title) is not None:
            skipped += 1
            continue
        hints = utaten.fetch_hints(artist, title, lyrics)
        db.save_utaten_hints(artist, title, hints)
        if hints:
            found += 1
            lines, words = utaten.split_hints(hints)
            keys = set(utaten.lyric_keys(lyrics))
            cover = len(keys & set(lines)) / max(len(keys), 1)
            print(f'  [{i}/{len(todo)}] ✔ 行 {cover:>4.0%} / 詞 {len(words):>3}  {artist} / {title}')
        else:
            empty += 1
            print(f'  [{i}/{len(todo)}] ✘       {artist} / {title}')
        time.sleep(DELAY)

    print(f'\n查到 {found} 首 / 沒有 {empty} 首 / 之前查過跳過 {skipped} 首')
    if found + empty:
        print(f'涵蓋率 {found / (found + empty) * 100:.0f}%')


if __name__ == '__main__':
    main()
