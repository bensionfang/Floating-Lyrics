"""
`scripts/recover_jp_titles.py` 的候選挑選。

  venv\\Scripts\\python.exe tests/test_recover_titles.py

**不打網路**:只測兩支純函式。釘住的是三件會**靜默**降低還原率的事:

  1. **不可以排除「我們庫裡已經有的歌名」** —— 加過那條,剛好擋掉最該修的情況
     (`go!go!vanillas` 的 `HEIAN` 與 `平安` 兩列同時存在,正是要合併的分裂)。
     守門是行重疊率,不是候選過濾。
  2. **歌詞最後一個時間戳是曲長的下界** —— 比它短的曲子不可能是同一首,要淘汰;
     反過來長很多的(接了尾奏)仍然合法,只是排後面。
  3. **排序要照長度接近程度** —— 每首歌只試前 `MAX_TRIES` 個候選,排錯了等於沒試到。
"""
import os
import sys

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

from recover_jp_titles import candidates, last_timestamp

failed = 0


def check(ok, label, detail=''):
    global failed
    if not ok:
        failed += 1
    print(f"{'PASS' if ok else 'FAIL'}  {label}{': ' + detail if detail else ''}")


# 1. last_timestamp:取最大值,不是最後一行 —— 製作人員列常常掛在 [00:00.000]
LRC = ('[00:00.000]#TITLE#作詞 : 某某\n'
       '[00:16.943]一行歌詞\n'
       '[03:14.500]最後一句\n'
       '[00:02.000]時間倒退的一行\n')
check(abs(last_timestamp(LRC) - 194.5) < 0.01, 'last_timestamp 取最大值', str(last_timestamp(LRC)))
check(last_timestamp('') == 0.0, '沒有時間戳回 0')
check(last_timestamp('沒有任何時間戳的純文字') == 0.0, '純文字歌詞回 0')

# 2. 曲長比「最後一個時間戳」短的要淘汰(留 5 秒給誤差),長的留著
TRACKS = [
    ('短曲', 100.0),      # 194.5 - 100 遠超過誤差 → 淘汰
    ('剛好', 192.0),      # 192 + 5 >= 194.5 → 留著(時間戳誤差)
    ('正好', 196.0),      # 最接近 → 應該排第一
    ('長曲', 260.0),      # 接了尾奏,合法但排後面
]
c = candidates(TRACKS, LRC)
check('短曲' not in c, '曲長短於歌詞末端的淘汰')
check(c == ['正好', '剛好', '長曲'], '照長度接近程度排序', str(c))

# 3. **不排除「庫裡已經有的歌名」** —— 這條是回歸測試的重點,見檔頭第 1 點。
#    candidates() 只吃 (tracks, lrc) 兩個參數,沒有 known 這個概念。
check(candidates.__code__.co_argcount == 2,
      'candidates 不接受「已知歌名」參數(加回去會擋掉真正的分裂)')

# 4. 沒有日文字的歌名不是候選(還原的目標就是日文原名),重複的只留一個
c2 = candidates([('English Only', 196.0), ('日本語', 196.0), ('日本語', 197.0)], LRC)
check(c2 == ['日本語'], '純英數歌名排除、重複去掉', str(c2))

# 5. 歌詞沒有時間戳時不能整批淘汰 —— 那時沒有長度證據,全部都是候選
c3 = candidates(TRACKS, '沒有時間戳')
check(len(c3) == 4, '沒有時間戳時所有日文歌名都是候選', str(c3))

print('\n全部通過' if failed == 0 else f'\n{failed} 項失敗')
sys.exit(0 if failed == 0 else 1)
