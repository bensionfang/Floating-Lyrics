"""
量讀音提示每一層的實際貢獻。

  venv\\Scripts\\python.exe scripts/measure_hints.py
  venv\\Scripts\\python.exe scripts/measure_hints.py --diff   # 只列手改與自動不一致的

標準答案 = 使用者手改的 `word_corrections`(它是修正鏈的最上層,所以量的時候要繞過它,
否則每一層都會 100% 命中)。每一層各跑一次完整的 `process_lrc`,再從輸出的
`data-orig` / `data-hira` 把每個詞的讀音撈回來比對:

  L0  只有 fugashi 字典
  L1  ＋utaten 的注音 (人標的)

(2026-08-05 之前中間還有一層「中國平台的逐音節羅馬字」,量出來 2:1 淨負,已移除。)

**只讀快取,不打網路**:hint 從 DB 撈。utaten 那張表要先有資料 ——
沒有的歌會被列進「跳過」,正常播一遍或跑 scripts/backfill_utaten.py 補。

`--diff` 把同一份資料反過來讀:不是「管線命中幾個」,而是「哪幾筆手改與 utaten／自動不一致」。
**兩邊都可能是對的那一方**,所以這支只讀不寫、也不建議刪 —— `我愛你` 的 `我 うお` 是華語音譯,
沒有任何日文注音來源會有它。列出來讓人自己判斷。
"""
import html
import json
import os
import re
import sqlite3
import sys

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import furigana_inject

DB = os.environ.get('DB_PATH') or os.path.join(ROOT, 'lyrics_data.db')
RUBY = re.compile(r"data-orig='([^']*)' data-hira='([^']*)'")

# 標準答案是最上層的修正,量的時候一定要繞過,不然每一層都是滿分
furigana_inject.db.get_word_correction = lambda *a, **k: None


def readings(lyrics, artist, title, uta):
    """
    回 {詞: 這首歌裡出現過的所有讀音}。

    **一定要收成集合,不能用 `{詞: 讀音}` 平表。** 同一個詞在不同句可以是不同讀音,而那正是
    行對齊在做對的事 (花人局 的 `夜が明けて` 是 よ、`昨日の夜` 是 よる,管線兩個都標對了);
    平表會讓後面的出現覆蓋前面的,把「全對」誤判成「錯」—— 第一版就是這樣把 夜 算成 miss。
    比對的是 `word_corrections`,它的鍵也只到 (歌手, 歌名, 詞),本來就表達不了第幾次出現,
    所以「任一次對得上」就是這裡能做到的最準判準。
    """
    furigana_inject.get_hints = lambda *a, **k: uta
    out = furigana_inject.process_lrc(artist, title, lyrics)
    got = {}
    for o, h in RUBY.findall(out):
        got.setdefault(html.unescape(o), set()).add(html.unescape(h))
    return got


def main():
    diff_only = '--diff' in sys.argv
    con = sqlite3.connect(DB)
    songs = con.execute(
        'SELECT DISTINCT artist, title FROM word_corrections ORDER BY artist, title').fetchall()

    LAYERS = ['L0 字典', 'L1 ＋utaten']
    hit = {n: 0 for n in LAYERS}
    total = 0
    skipped = []
    detail = []
    stale = []

    def load(table, artist, title):
        row = con.execute(f'SELECT data FROM {table} WHERE artist=? AND title=?',
                          (artist, title)).fetchone()
        try:
            return json.loads(row[0]) if row and row[0] else {}
        except ValueError:
            return {}

    for artist, title in songs:
        row = con.execute('SELECT lyrics FROM cache WHERE artist=? AND title=?',
                          (artist, title)).fetchone()
        corr = con.execute('SELECT word, hira FROM word_corrections WHERE artist=? AND title=?',
                           (artist, title)).fetchall()
        if not row or not row[0]:
            skipped.append((artist, title, '沒有快取歌詞'))
            continue
        uta = load('utaten_hints', artist, title)
        if not uta:
            skipped.append((artist, title, '沒有 utaten 注音'))
            continue
        got = {
            'L0 字典':     readings(row[0], artist, title, {}),
            'L1 ＋utaten': readings(row[0], artist, title, uta),
        }

        for word, want in corr:
            if word not in got['L0 字典']:
                stale.append((f'{artist} / {title}', word, want))
                continue
            total += 1
            per = {n: got[n].get(word, set()) for n in LAYERS}
            detail.append((f'{artist} / {title}', word, want, per))
            for n in LAYERS:
                if want in per[n]:
                    hit[n] += 1

    print(f'資料庫: {DB}')
    print(f'標準答案 {total} 個詞 (另有 {len(stale)} 個詞已不在現在的歌詞裡,不計)')
    print(f'可量的歌: {len(songs) - len(skipped)} / {len(songs)}\n')

    if diff_only:
        bad = [d for d in detail if d[2] not in d[3]['L1 ＋utaten']]
        print(f'手改與自動不一致 {len(bad)} / {total} 筆。**兩邊都可能是對的**,自己判斷,不要自動刪:\n')
        print(f'  {"詞":<8}{"手改的":<10}{"utaten／自動":<16}歌')
        for song, word, want, per in bad:
            auto = '/'.join(sorted(per['L1 ＋utaten'])) or '—'
            print(f'  {word:<8}{want:<10}{auto:<16}{song}')
        if stale:
            print(f'\n詞已不在現在的歌詞裡 {len(stale)} 筆 (歌詞換過版本,這幾筆是死資料):')
            for song, word, want in stale:
                print(f'  {word:<8}{want:<10}{"":<16}{song}')
        if skipped:
            print(f'\n跳過 {len(skipped)} 首 (沒有快取歌詞或沒有 utaten 注音,判斷不了)')
        return

    for n in LAYERS:
        pct = f'{hit[n] / total * 100:.0f}%' if total else '—'
        print(f'  {n:<16} {hit[n]:>3} / {total}   {pct}')

    print('\n逐詞 (✔ = 跟手改的一致):')
    print(f'  {"詞":<8}{"正解":<10}' + ''.join(f'{n.split()[0]:<14}' for n in LAYERS))
    for song, word, want, per in detail:
        cells = ''.join(f'{("✔ " if want in per[n] else "  ") + ("/".join(sorted(per[n])) or "—"):<14}'
                        for n in LAYERS)
        print(f'  {word:<8}{want:<10}{cells}  {song}')

    if skipped:
        by_reason = {}
        for a, t, why in skipped:
            by_reason.setdefault(why, []).append(f'{a} / {t}')
        print()
        for why, items in by_reason.items():
            print(f'跳過 ({why}) {len(items)} 首:')
            for i in items:
                print(f'  {i}')


if __name__ == '__main__':
    main()
