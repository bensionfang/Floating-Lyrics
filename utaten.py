"""
utaten.com 的注音歌詞 client —— 讀音提示的第三個來源。

**為什麼是它**:那份 ふりがな 是人標的,而且伺服器端就渲染成
`<span class="ruby"><span class="rb">漢字</span><span class="rt">かな</span></span>`。
拿使用者手改的 `word_corrections` 當標準答案量過 (2026-08-04,5 首歌 16 個詞):

    fugashi 字典        9/16 (56%)
    ＋羅馬字 hint      10/16 (62%)
    ＋LLM hint         10/16 (62%)   ← 淨零
    utaten             15/16 (94%)   ← 唯一沒中的是「那個詞頁面上沒標注音」,不是標錯

`静寂=しじま`、`妄=みだり`、`外=はず`、`逸=はぐ` 這種字典與 LLM 全滅的特殊唸法它都對,
因為那是人標的不是猜的。**要提升注音準確度,槓桿在來源資料,不在模型** —— 這跟當初接上
QQ 的羅馬字軌修好 `私` 是同一件事。

輸出格式刻意與 `cn_music.fetch_hints` 完全相同 (`{normalize_line(行): 整行假名}`),
所以下游一行都不用改:直接餵 `furigana_inject.apply_hint()` 和它既有的四道 guard。
"""
import html
import re
import sys

import requests

from cn_music import normalize_line

BASE = 'https://utaten.com'
_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
       '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
_HEADERS = {'User-Agent': _UA}
TIMEOUT = 12

_RUBY = re.compile(
    r'<span class="ruby"><span class="rb">(.*?)</span><span class="rt">(.*?)</span></span>', re.S)
_TAG = re.compile(r'<[^>]+>')
_ROW = re.compile(
    r'<p class="searchResult__title">\s*<a href="(/lyric/[^"]+)">(.*?)</a>.*?'
    r'<td class="searchResult__artist">\s*<p>\s*<a[^>]*>(.*?)</a>', re.S)
_BODY = re.compile(r'class="hiragana"(.*?)</div>', re.S)
_KANJI = re.compile(r'[一-龯々]')
_TIME_TAG = re.compile(r'\[\d+:\d+(?:\.\d+)?\]')

# 歌手對不上時的退路:至少要有這麼多行對得上我們手上的歌詞,否則判定是同名的別首歌。
#
# **重疊率只是後備,不是主要判準。** 它分不出「不同首歌」與「同一首但斷句不同」——
# 實測 `サカナクション / アイデンティティ` 只有 8%、`Vaundy / 花占い` 28%,兩首都是對的歌,
# 差別只在 utaten 那份的斷句與標注範圍。所以歌手與歌名都對得上時直接採用,不看重疊率
# (utaten 的搜尋很鬆,查 `アイデンティティ` 會回 40 筆別人的歌,歌手比對才是真正的守門)。
MIN_OVERLAP = 0.30


def _text(fragment):
    return html.unescape(_TAG.sub('', fragment)).strip()


def _norm(s):
    """歌名/歌手比對用:去空白與符號,英文轉小寫 (同 cn_music._title_matches 的精神)"""
    return re.sub(r'[\s　・･\-–—_,，.。!！?？"\'“”「」『』()（）\[\]【】]', '', (s or '')).lower()


def _matches(a, b):
    a, b = _norm(a), _norm(b)
    return bool(a and b and (a in b or b in a))


def search(title, artist=''):
    """
    回候選 [(path, 歌名, 歌手)]。

    **只用歌名查,歌手當排序訊號不當條件** —— utaten 用日文歌手名 (`SPITZ` 在那邊叫
    `スピッツ`),把歌手塞進查詢字串會直接查不到。實測 `artist_name=SPITZ` 落空、
    `artist_name=スピッツ` 才中。
    """
    r = requests.get(f'{BASE}/search', params={'title': title}, headers=_HEADERS, timeout=TIMEOUT)
    if r.status_code != 200 or 'searchResult' not in r.text:
        return []          # 落空時回的是一頁推薦清單 (裡面照樣有幾十個 /lyric/ 連結),
                           # 所以**不能只看有沒有 /lyric/**,要看有沒有結果表
    rows = [(p, _text(t), _text(a)) for p, t, a in _ROW.findall(r.text)]
    # 歌手對得上的排前面,其次是歌名越接近越前面
    rows.sort(key=lambda x: (not _matches(artist, x[2]), abs(len(_norm(x[1])) - len(_norm(title)))))
    return rows


def fetch_lines(path):
    """回 ([(原文行, 整行假名)], [(詞, 讀音)])。沒有注音區塊就回兩個空 list。"""
    r = requests.get(BASE + path, headers=_HEADERS, timeout=TIMEOUT)
    m = _BODY.search(r.text)
    if not m:
        return [], []
    body = m.group(1)
    words = [(_text(rb), _text(rt)) for rb, rt in _RUBY.findall(body)]
    out = []
    for raw in re.split(r'<br\s*/?>', body):
        plain = _text(_RUBY.sub(lambda x: x.group(1), raw))
        kana = _text(_RUBY.sub(lambda x: x.group(2), raw))
        if plain:
            out.append((plain, kana))
    return out, words


def lyric_keys(lrc_text):
    """我們手上這份歌詞的比對鍵 (去時間標籤、跳過製作人員列與 meta,只留含漢字的行)"""
    keys = []
    for raw in (lrc_text or '').split('\n'):
        t = _TIME_TAG.sub('', raw).strip()
        if not t or t.startswith('#TITLE#') or t.startswith('[source:'):
            continue
        if re.match(r'^\[[a-zA-Z]+:.*\]$', t):
            continue
        if _KANJI.search(t):
            k = normalize_line(t)
            if k:
                keys.append(k)
    return keys


def build_hints(pairs, word_pairs=()):
    """
    → `{'lines': {正規化行: 整行假名}, 'words': {詞: 讀音}}`

    **兩份都要留。** 行的那份給 `apply_hint` 做位置對齊 (同一個字在不同句可能不同讀音);
    詞的那份是 utaten 原生的 `<rb>漢字</rb><rt>かな</rt>`,拿來補行對齊救不回來的情況 ——
    `apply_hint` 是按「fugashi 預測的讀音長度」去切 hint 字串的,兩邊長度差太多時
    (静寂:せいじゃく 5 字 vs しじま 3 字) 它的守門會整個放棄,而那正是最需要修的那種詞。

    `words` **只收整首歌讀音唯一的詞**:同一個漢字在不同句唸法不同時 (花人局 的 夜 = よ/よる)
    沒有前後文可判斷,硬套會把對的那句改錯,那種留給行對齊處理。
    """
    lines = {}
    for plain, kana in pairs:
        k = normalize_line(plain)
        if k and kana and kana != plain:
            lines[k] = kana

    seen = {}
    for rb, rt in word_pairs:
        if rb and rt:
            seen.setdefault(rb, set()).add(rt)
    words = {w: next(iter(rs)) for w, rs in seen.items() if len(rs) == 1}
    return {'lines': lines, 'words': words}


def split_hints(data):
    """讀快取用。舊資料是攤平的行對照表,沒有 words 那半。"""
    if not data:
        return {}, {}
    if 'lines' in data or 'words' in data:
        return data.get('lines') or {}, data.get('words') or {}
    return data, {}


_SUFFIX = re.compile(r'\s*[-–—]?\s*\(?\s*feat\.?\s.*$', re.I)
_PARENS = re.compile(r'\s*[(（【\[].*$')
# 破折號後面整段是版本資訊:` - Live`、` - replica -`、` - ALBUM ver.`、
# ` - 本格中華喫茶・愛のペガサス ~羅武の香辛龍~ 2024 / LIVE`。**兩邊都要有空白** ——
# 沒空白的連字號多半是歌名本身的一部分 (`go!go!vanillas`、`n-buna`)
_DASH_TAIL = re.compile(r'\s+[-–—]\s+.*$')
_DASH_HEAD = re.compile(r'^(.*?)\s+[-–—]\s+(.+)$')


def _strip_artist_prefix(title, artist):
    """
    `くるり - 琥珀色の街、上海蟹の朝`、`ヨルシカ - 春泥棒`:播放器把歌手名黏進歌名開頭。
    **一定要排在 `_DASH_TAIL` 前面** —— 這種形狀剝尾巴只會剩下歌手名。

    判準同 `cleanBrowserQuery` 的「開頭確實等於歌手」:正規化後互相包含才剝,
    對不上就原樣留著。歌手欄本身可能是 `ヨルシカ / n-buna / ヨルシカ` 這種複合寫法,所以逐段比。
    """
    m = _DASH_HEAD.match(title)
    if not m:
        return title
    head, rest = m.group(1), m.group(2)
    return rest if any(_matches(head, n) for n in re.split(r'[/／]', artist or '')) else title


def clean_title(title, artist=''):
    """
    去掉查不到東西的尾綴。utaten 收的是原曲名,而播放器給的常常帶著版本資訊
    (`Pretender (… LIVE at STADIUM 2025)`、`点描の唄 (feat. 井上苑子)`、`rose - feat. Vaundy`),
    整串丟進去就是 0 筆。**只在原名查不到時才用**,不然歌名本身帶括號的歌會被剝壞。

    Live/replica 版剝成原曲名是**刻意的**:那是同一份歌詞,注音本來就該一樣。
    剝過頭的代價只是多打一次搜尋 —— 採用與否仍然要過 `fetch_hints` 的驗證
    (歌手＋歌名對得上,或行重疊 ≥ `MIN_OVERLAP`)。
    """
    t = _strip_artist_prefix(title or '', artist)
    t = _SUFFIX.sub('', t)
    t = _PARENS.sub('', t)
    t = _DASH_TAIL.sub('', t)
    return t.strip()


def fetch_hints(artist, title, lrc_text):
    """
    整首歌的讀音提示。找不到、對不上、或搜到的其實是同名別首歌,一律回 {}。

    **驗證靠「跟我們手上的歌詞對得上幾行」而不是歌手名** —— 歌手名在兩邊寫法常常不同
    (SPITZ / スピッツ),而行重疊率是直接證據,而且那張表本來就要算,等於免費。
    """
    keys = set(lyric_keys(lrc_text))
    if not keys:
        return {}

    # 原名先查;查不到才用去噪後的歌名重試一次 (成功路徑零額外請求,同 fetchCnLyricsS2 的做法)
    queries = [title]
    cleaned = clean_title(title, artist)
    if cleaned and cleaned != title:
        queries.append(cleaned)

    try:
        for q in queries:
            for path, cand_title, cand_artist in search(q, artist)[:3]:
                # 歌手與歌名都對得上 = 就是這首,不必再看重疊率 (見 MIN_OVERLAP 的註解)
                sure = _matches(artist, cand_artist) and _matches(q, cand_title)
                hints = build_hints(*fetch_lines(path))
                if not hints['lines']:
                    continue
                overlap = len(keys & set(hints['lines'])) / len(keys)
                if sure or overlap >= MIN_OVERLAP:
                    return hints
                print(f'[utaten] 歌手對不上且重疊率只有 {overlap:.0%},判定不是同一首:'
                      f'{cand_artist} / {cand_title}', file=sys.stderr)
    except Exception as e:
        print(f'[utaten] fetch failed: {e}', file=sys.stderr)
    return {}


if __name__ == '__main__':
    # 自我檢查:一首確定有的歌,注音要對得上幾個已知答案
    pairs, words = fetch_lines(search('花人局', 'ヨルシカ')[0][0])
    hints = build_hints(pairs, words)
    assert len(hints['lines']) > 20, f"只解析到 {len(hints['lines'])} 行"
    assert hints['words'].get('覚') == 'おぼ', hints['words'].get('覚')
    assert hints['words'].get('束') == 'つか', hints['words'].get('束')
    # 同一首歌裡讀音不唯一的字不進 words (夜 在這首同時有 よ 與 よる)
    assert '夜' not in hints['words'], hints['words'].get('夜')
    print(f"OK  {len(pairs)} 行 / {len(hints['lines'])} 行有注音 / {len(hints['words'])} 個唯一讀音的詞")
