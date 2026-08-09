"""把 web-app/public/vendor/ 底下的第三方字型/圖示/Chart.js 重抓一次。

自架的理由寫在 views/header.ejs:打包版是離線桌面 app,走 CDN 的話斷網時圖示全變空框。
平常不必跑;要升級 Font Awesome 或 Chart.js 版本、或新增字重時才跑。跑完記得把
header.ejs / stats.ejs 的 ?v= 往上加,不然瀏覽器會吃舊快取。

    venv\\Scripts\\python.exe scripts/fetch_vendor_assets.py
"""
import os
import re
import sys
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')   # cp950 的 console 印到日文/長音符會炸

VENDOR = os.path.join(os.path.dirname(__file__), '..', 'web-app', 'public', 'vendor')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

FA_VER = '6.4.0'
FA_BASE = f'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/{FA_VER}'
# 只抓實際用得到的:全站是 fa-solid,一個 fa-regular,brands 一個都沒有 (108KB,不抓)
FA_FONTS = ['fa-solid-900', 'fa-regular-400', 'fa-v4compatibility']

# 沒有斜體 (全站 font-style: italic 掛零),Poppins 的 devanagari 子集也砍掉
GOOGLE_FONTS = ('https://fonts.googleapis.com/css2'
                '?family=Outfit:wght@300;400;500;600;700;800'
                '&family=Poppins:wght@400;600;700;800&display=swap')
DROP_SUBSETS = {'devanagari'}

# 卡拉OK頁曾經自己抓日文字型 (丸ゴシック / UD 明朝),2026-08-09 移除 —— 見 CLAUDE.md。
# 那一頁現在跟主歌詞頁用同一套字,這裡不必再多一個家族。

CHART_JS = 'https://cdn.jsdelivr.net/npm/chart.js'


def get(url: str) -> bytes:
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60).read()


def save(rel: str, data: bytes) -> None:
    path = os.path.join(VENDOR, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)
    print(f'  {rel}  {len(data) // 1024} KB')


def main() -> None:
    print('Font Awesome', FA_VER)
    # CSS 放 fa/css/、字檔放 fa/webfonts/,原始的 ../webfonts/ 相對路徑就自然對得上,CSS 一個字都不用改
    save('fa/css/all.min.css', get(f'{FA_BASE}/css/all.min.css'))
    for name in FA_FONTS:
        save(f'fa/webfonts/{name}.woff2', get(f'{FA_BASE}/webfonts/{name}.woff2'))

    print('Google Fonts')
    css = get(GOOGLE_FONTS).decode('utf-8')   # 帶 Chrome UA 才會拿到 woff2 那份
    out = []
    for block, subset in re.findall(r'(/\* ([a-z-]+) \*/\n@font-face \{.*?\}\n)', css, re.S):
        if subset in DROP_SUBSETS:
            continue
        url = re.search(r'url\((https://[^)]+\.woff2)\)', block).group(1)
        fam = re.search(r"font-family: *'([^']+)'", block).group(1).lower()
        weight = re.search(r'font-weight: *(\d+)', block).group(1)
        name = f'{fam}-{weight}-{subset}.woff2'
        save(f'fonts/{name}', get(url))
        out.append(block.replace(url, f'/vendor/fonts/{name}'))
    save('fonts.css', ''.join(out).encode('utf-8'))

    print('Chart.js')
    save('chart.umd.js', get(CHART_JS))


if __name__ == '__main__':
    main()
