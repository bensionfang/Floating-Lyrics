"""
utaten 的候選挑選與注音解析。

  venv\\Scripts\\python.exe tests/test_utaten.py

**不打網路**:search / fetch_lines 換成假的。要驗真的站台就直接跑 `python utaten.py`
(那支是打真站的自我檢查)。

釘住的是兩件會**靜默**掉歌的事:
  1. 搜不到時 utaten 回一頁推薦清單,裡面照樣有幾十個 /lyric/ 連結 —— 認錯就會把覆蓋率
     量成 100%,而且每首都抓到別人的歌詞。
  2. 歌手與歌名都對得上時不可以再用「行重疊率」否決 —— 重疊率分不出「不同首歌」與
     「同一首但斷句不同」,實測 サカナクション/アイデンティティ 只有 8%、Vaundy/花占い 28%,
     兩首都是對的歌。這條擋掉的是「哪天有人把門檻改成無條件套用」。
"""
import os
import sys

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import utaten

failed = 0


def check(ok, label, detail=''):
    global failed
    if not ok:
        failed += 1
    print(f"{'PASS' if ok else 'FAIL'}  {label}{': ' + detail if detail else ''}")


# 1. 搜尋結果的判定:有結果表才算命中,推薦清單不算
class FakeResp:
    def __init__(self, text, status=200):
        self.text, self.status_code = text, status


HIT_HTML = '''<table class="searchResult artistLyricList">
 <tr><td><p class="searchResult__title"> <a href="/lyric/aa1/"> 花人局 </a> </p></td>
 <td class="searchResult__artist"> <p> <a href="/artist/1/"> ヨルシカ </a> </p></td></tr>
 <tr><td><p class="searchResult__title"> <a href="/lyric/bb2/"> 花人局(カバー) </a> </p></td>
 <td class="searchResult__artist"> <p> <a href="/artist/2/"> 誰か </a> </p></td></tr></table>'''
MISS_HTML = '<p class="noItem"> ごめんなさい。歌詞が見つかりませんでした。</p>' + \
            ''.join(f'<a href="/lyric/zz{i}/">人気曲{i}</a>' for i in range(40))

utaten.requests = type('R', (), {'get': staticmethod(lambda *a, **k: FakeResp(HIT_HTML)),
                                 'utils': utaten.requests.utils})()
rows = utaten.search('花人局', 'ヨルシカ')
check(len(rows) == 2, '結果表解析出兩筆候選', str(len(rows)))
check(rows[0][2] == 'ヨルシカ', '歌手對得上的排第一', rows[0][2])

utaten.requests = type('R', (), {'get': staticmethod(lambda *a, **k: FakeResp(MISS_HTML)),
                                 'utils': utaten.requests.utils})()
check(utaten.search('花人局', 'ヨルシカ') == [],
      '搜不到時回空 —— 推薦清單裡的 /lyric/ 連結不算命中')

# 2. 注音解析:行對照表 + 逐詞表,讀音不唯一的詞不進詞表
pairs = [('覚束ぬままに夜が明けて', 'おぼつかぬままによがあけて'),
         ('昨日の夜のことは', 'きのうのよるのことは'),
         ('英語 only line', '英語 only line')]
words = [('覚', 'おぼ'), ('束', 'つか'), ('夜', 'よ'), ('昨日', 'きのう'), ('夜', 'よる')]
h = utaten.build_hints(pairs, words)
check(len(h['lines']) == 2, '假名 = 原文的行不進行表 (沒注到音)', str(len(h['lines'])))
check(h['words'].get('覚') == 'おぼ' and h['words'].get('昨日') == 'きのう', '唯一讀音的詞進詞表')
check('夜' not in h['words'], '同一首歌有兩種讀音的詞不進詞表 (夜 = よ/よる)',
      str(h['words'].get('夜')))

# 3. 舊快取是攤平的行表,沒有 words 那半
old_lines, old_words = utaten.split_hints({'あるライン': 'あるらいん'})
check(old_lines == {'あるライン': 'あるらいん'} and old_words == {}, '舊格式的快取讀得回來')
check(utaten.split_hints({}) == ({}, {}), '空快取 (負快取) 不炸')

# 4. 歌名去噪只在原名查不到時才用,而且剝的是版本尾綴
check(utaten.clean_title('点描の唄 (feat. 井上苑子)') == '点描の唄', utaten.clean_title('点描の唄 (feat. 井上苑子)'))
check(utaten.clean_title('rose - feat. Vaundy') == 'rose', utaten.clean_title('rose - feat. Vaundy'))
check(utaten.clean_title('Pretender (LIVE at STADIUM 2025)') == 'Pretender',
      utaten.clean_title('Pretender (LIVE at STADIUM 2025)'))
check(utaten.clean_title('花人局') == '花人局', '沒有尾綴的歌名原樣不動')

# 5. **這條是核心**:歌手與歌名都對得上就採用,不再看行重疊率。
#    餵一份「一行都對不上」的注音,重疊率 0% —— 歌手對得上時仍然要收下。
LYRICS = '[00:01.00]我們手上的歌詞這行\n[00:02.00]另外一行'
utaten.search = lambda title, artist='': [('/lyric/aa1/', '花占い(ドラマ主題歌)', 'Vaundy')]
utaten.fetch_lines = lambda path: ([('utaten 的斷句完全不同', 'うたてんのだんくがちがう')],
                                   [('斬', 'ざん')])
got = utaten.fetch_hints('Vaundy', '花占い', LYRICS)
check(bool(got) and got['words'].get('斬') == 'ざん',
      '歌手+歌名都對 → 重疊率 0% 也採用 (斷句不同不代表不同首歌)')

# 歌手對不上時,重疊率仍然是唯一的守門
utaten.search = lambda title, artist='': [('/lyric/xx9/', '暴動', '感覚ピエロ')]
check(utaten.fetch_hints('shallm', '暴動', LYRICS) == {},
      '歌手對不上 + 重疊率 0% → 判定不是同一首')

print('\n全部通過' if failed == 0 else f'\n{failed} 項失敗')
sys.exit(0 if failed == 0 else 1)
