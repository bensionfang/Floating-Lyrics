"""apply_hint 的最小自檢:python tests/test_furigana_hint.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # repo 根,才 import 得到受測模組

import furigana_inject
from furigana_inject import apply_hint

# process_lrc 會去問外部來源 (cn_music 的羅馬字、utaten 的注音)。這支是離線單元測試,
# hint 一律由各案例自己明確給,所以把整條抓取路徑短路掉 —— 不然跑測試會打網路,
# 而且結果會隨那兩家當下有沒有資料而飄。
furigana_inject.get_hints = lambda *a, **k: {}

def hira_of(words, orig):
    return next(w['hira'] for w in words if w['orig'] == orig)

# 1. 對齊歪掉時不能吃掉送り仮名 (花人局:hint 把 そんな 寫成 そんあ,整行偏移一格)
words = [
    {'orig': '美人局', 'hira': 'つつもたせ', 'is_space': False},
    {'orig': 'を', 'hira': 'を', 'is_space': False},
    {'orig': '疑う', 'hira': 'うたがう', 'is_space': False},
    {'orig': '、', 'hira': '、', 'is_space': False},
    {'orig': 'そんな', 'hira': 'そんな', 'is_space': False},
    {'orig': '気', 'hira': 'き', 'is_space': False},
]
apply_hint(words, 'つつもたせをうたがうそんあき')
assert hira_of(words, '疑う') == 'うたがう', hira_of(words, '疑う')  # 不是 うたが
assert hira_of(words, '気') == 'き'

# 2. hint 仍然要能修正 fugashi 挑錯的讀音 (君 くん → きみ)
words = [
    {'orig': '君', 'hira': 'くん', 'is_space': False},
    {'orig': 'の', 'hira': 'の', 'is_space': False},
    {'orig': '声', 'hira': 'こえ', 'is_space': False},
]
apply_hint(words, 'きみのこえ')
assert hira_of(words, '君') == 'きみ'

# 3. 帶送り仮名的詞,hint 對得上時照樣可以覆蓋
words = [
    {'orig': '行く', 'hira': 'ゆく', 'is_space': False},
]
apply_hint(words, 'いく')
assert hira_of(words, '行く') == 'いく'

print('OK')

# 4. 讀音 = 原文的詞 (unidic 查不到,中文歌整行如此) 不可以被吞掉
import re
from furigana_inject import build_ruby_html
plain = re.sub(r'<[^>]+>', '', build_ruby_html('我們的愛情斷了線', 'x', 'y'))
for ch in '我們的愛情斷了線':
    assert ch in plain, (ch, plain)

print('OK')

# 5. 整首沒假名 = 中文歌,原文照抄不注音;日文歌照常注音
from furigana_inject import process_lrc
zh = '[00:12.34]我們的愛情像風箏斷了線\n[00:15.00]別問我為什麼還愛妳'
assert process_lrc('x', 'y', zh) == zh
assert '<ruby' in process_lrc('x', 'y', '[00:12.34]君の声が聞こえる')

print('OK')

# 6. 片假名標平假名:預設不動,開啟時包 ruby 且原文保留、長音符 ー 不展開
assert '<ruby' not in build_ruby_html('サヨナラ', 'x', 'y')
kr = build_ruby_html('サヨナラ', 'x', 'y', kata_ruby=True)
assert 'サヨナラ' in kr and '<rt>さよなら</rt>' in kr, kr
assert '<rt>らーめん</rt>' in build_ruby_html('ラーメン', 'x', 'y', kata_ruby=True)
assert build_ruby_html('ー', 'x', 'y', kata_ruby=True) == 'ー'   # 轉了也一樣就不包

print('OK')

# 7. 歌詞是外部來源的字串,而前端是 innerHTML 畫的 —— 標籤一律逃逸,四條路徑都要。
#    (日文行走 build_ruby_html、中文歌走 process_lrc 的提早退出、#TITLE# 列、meta 標籤)
XSS = "<img src=x onerror=alert(1)>"
assert '<img' not in build_ruby_html(XSS + 'と歌う', 'x', 'y')
assert '&lt;img' in build_ruby_html(XSS + 'と歌う', 'x', 'y')
assert '<img' not in process_lrc('x', 'y', '[00:01.00]' + XSS + '我們的愛情')
assert '<img' not in process_lrc('x', 'y', '[00:01.00]#TITLE#作詞 : ' + XSS + '\n[00:02.00]君の声')
assert '<img' not in process_lrc('x', 'y', '[ar:' + XSS + ']\n[00:02.00]君の声')
# #TITLE# 標記本身不能被吃掉,不然前端認不出製作人員列
assert process_lrc('x', 'y', '[00:01.00]#TITLE#作詞 : n-buna\n[00:02.00]君の声'
                   ).splitlines()[0] == '[00:01.00]#TITLE#作詞 : n-buna'
# 逃逸後仍然照常注音 (實體字串對 fugashi 只是符號)
assert '<rt>うた</rt>' in build_ruby_html(XSS + 'と歌う', 'x', 'y')

print('OK')

# 8. unidic 把「名詞 + 君」黏成罕見詞條時,兩個字會同時標錯 (道君 ドウクン、中君 ナカノキミ)。
#    羅馬字來源也跟著錯,所以拆詞要在 apply_hint 之後才生效。
mq = build_ruby_html('新しい道君と進むだけ', 'muque', 'bestie',
                     ['あたらしいどうくんとすすむだけ'])
assert "data-orig='道' data-hira='みち'" in mq, mq
assert "data-orig='君' data-hira='きみ'" in mq, mq
ak = build_ruby_html('光の中君を愛すよ', 'AKASAKI', '夏実',
                     ['ひかりのちゅうくんをあいすよ'])
assert "data-orig='中' data-hira='なか'" in ak, ak
assert "data-orig='君' data-hira='きみ'" in ak, ak
# 通則會誤殺的真詞:詞性跟 道君/中君 完全一樣,所以 _SPLIT_WORD 只能是列表不能是規則
assert '<rt>しょくん</rt>' in build_ruby_html('諸君、聞いてくれ', 'x', 'y')
assert '<rt>ぼうくん</rt>' in build_ruby_html('暴君のように', 'x', 'y')

print('OK')

# 9. 兩邊來源一起錯的字:unidic 給 良い/好い/善い 一律 ヨイ,平台的機器羅馬字也給 yoi。
#    整詞比對,所以活用形與複合詞不受影響。
assert '<rt>い</rt>' in build_ruby_html('食み出せば好いさ', 'NOMELON NOLEMON', 'SUGAR')
# hint 說 よい 也要被壓過去 (_COMMON_READING 在 apply_hint 之上)
ant = build_ruby_html('良いから一緒に堕ちろよ', 'Chevon', 'antlion',
                      ['よいからいっしょにおちろよ'])
assert "data-orig='良' data-hira='い'" in ant, ant
# 誤殺守門:活用形與複合詞照舊 よ
assert "data-hira='よ'" in build_ruby_html('良くない', 'x', 'y')
assert '<rt>なかよ</rt>' in build_ruby_html('仲良くしよう', 'x', 'y')

print('OK')

# 9. hint 比預測「多字」時不可以硬切:その他 的 fugashi 預測是 そのた,hint 給 そのほか,
#    舊版會把 他 標成單一個「か」(長度相同、是假名、沒有送り仮名可比,三道關卡都攔不住)。
#    破綻在左邊的 その 這時對到「そのほ」—— 對不上自己就代表這一帶對歪了,整個跳過。
words = [{'orig': 'その', 'hira': 'その'}, {'orig': '他', 'hira': 'た'},
         {'orig': 'の', 'hira': 'の'}, {'orig': '日々', 'hira': 'ひび'}]
apply_hint(words, 'そのほかのひび')
assert hira_of(words, '他') == 'た', hira_of(words, '他')      # 不是 か
assert hira_of(words, '日々') == 'ひび'
# 對得上的鄰居不受影響:同一行結構、hint 長度一致時照樣要能修正
words = [{'orig': 'その', 'hira': 'その'}, {'orig': '他', 'hira': 'ほか'},
         {'orig': 'の', 'hira': 'の'}, {'orig': '君', 'hira': 'くん'}]
apply_hint(words, 'そのほかのきみ')
assert hira_of(words, '君') == 'きみ', hira_of(words, '君')

print('OK')

# 10. utaten 的人工注音**不設長度門檻**:它給的是完整假名,長度變化本身就是正解的一部分
#     (花人局 的 夜 = よる → よ 就是變短而且是對的)。這條擋的是「哪天有人想加一道
#     『候選必須與原讀音等長』的門檻」—— 加了就會把這類正確修正一起砍掉。
words = [{'orig': '夜', 'hira': 'よる', 'is_space': False},
         {'orig': 'が', 'hira': 'が', 'is_space': False}]
apply_hint(words, 'よが')
assert hira_of(words, '夜') == 'よ', hira_of(words, '夜')

print('OK')
