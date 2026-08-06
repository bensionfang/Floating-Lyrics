# Kanaric — 桌面浮動歌詞與聽歌統計

> by **Resuaumis**

自動偵測 Spotify / Apple Music 正在播放的歌曲，線上抓取同步歌詞（LRC），日文歌詞自動標註假名（振り仮名），並以「靈動島」桌面懸浮視窗 + 網頁儀表板兩種形式顯示。同時記錄你的聽歌歷史，提供排行榜、統計圖表與年度回顧。

> 完整功能僅支援 Windows（媒體偵測依賴 Windows Media API）。

---

## 功能與特色

- **自動偵測播放中的歌曲** — 不用手動搜尋，切歌即換詞。支援 Spotify、Apple Music 等任何會上報 Windows 媒體資訊的播放器。
- **多來源同步歌詞** — 網易雲、QQ 音樂、Kugou、Musixmatch、Lrclib 等，可設定偏好來源；找不到時自動走備援搜尋（含 iTunes 日文原名還原，解決 Spotify 自動翻譯日文歌名的問題）。
- **日文假名標註（Furigana）** — 以 fugashi/unidic 斷詞注音，再用 utaten 的**人工注音**修正讀音（`静寂 = しじま` 這種字典全滅的特殊唸法它都對）；仍不對的字**點一下就能改**，修正永久記住。
- **逐字卡拉OK填色** — 抓得到逐字時間的歌，唱到哪個字就填到哪個字，連上面的假名一起走；抓不到就整句一起亮。沒有開關，有資料就自動套用。
- **中文翻譯與羅馬拼音** — 日文歌詞下面可多標一行中文翻譯或羅馬拼音，網頁與靈動島同步生效。
- **靈動島懸浮歌詞** — 無邊框透明置頂視窗，顯示當前歌詞，可拖曳、吸附螢幕頂端，多螢幕各自記位置；滑鼠移上去展開播放控制與進度條。
- **聽歌統計** — 累積播放 30 秒才算一次有效聆聽（防切歌灌水），提供歷史記錄、歌手/歌曲排行榜、時段分析與聽歌熱力圖，可匯出 CSV。
- **猜歌小遊戲** — 邊聽邊猜，題目就是現在正在播的那首；指定一位歌手當題庫，四選一，算速度與連勝加分，答錯 −1、跳過 0。
- **歌詞編輯器** — 歌詞或時間軸不準時可手動修正，逐首儲存時間偏移。
- **備份與還原** — 手改過的假名、時間軸、歌手別名匯出成單一 `.db` 檔，換電腦或重灌時還原。
- **一鍵安裝** — 打包成單一 NSIS 安裝檔，對方電腦**不需要安裝 Python / Node.js / .NET**，首次啟動自動初始化。

---

## 安裝

需要 Windows 10 或 11。**不需要**自己裝 Python 或 Node.js，安裝檔裡都包好了。

1. 到 [Releases](https://github.com/bensionfang/Kanaric/releases/latest) 下載 `Kanaric-Setup-x.y.z.exe`。
2. 點兩下執行。安裝檔沒有花錢買數位簽章，所以 Windows SmartScreen 會跳出藍色的「已保護您的電腦」——按 **「其他資訊」→「仍要執行」**。這是未簽章程式的正常待遇，不是防毒警報。
3. 裝完會自動開啟。放首歌（Spotify、YouTube Music、瀏覽器都可以），歌詞就會自己跟上。

關掉視窗就是結束整個程式。系統匣圖示留著給你顯示/隱藏靈動島與安裝更新用。資料（歌詞快取、聽歌記錄、設定）存在 `%APPDATA%\Kanaric\`，解除安裝不會刪掉。有新版時會自動下載並提示重新啟動安裝。

### 從原始碼執行（開發者）

想改程式碼或不想用安裝檔的話走這條。全程用「終端機」打指令，沒寫過程式也能照做——每一步的指令直接整段複製貼上，按 Enter 就好。

> **怎麼開終端機**：按 `Win + X`，選「終端機」或「Windows PowerShell」。跑到一半視窗看起來卡住不動是正常的，那是在下載東西，等它跑完再打下一步。

1. **裝三個工具。** Kanaric 用到 Git（下載原始碼）、Node.js（主程式與桌面殼）、Python（歌詞與假名處理）。Windows 10/11 內建 `winget`，一行就能裝完，過程中如果跳出使用者帳戶控制視窗，按「是」。

   ```bat
   winget install Git.Git OpenJS.NodeJS.LTS Python.Python.3.12
   ```

   Python 指定 3.12 不是隨便挑的：假名處理用到的 fugashi、unidic-lite 這兩個套件，在更新的 Python 版本上常常沒有現成的安裝包，會變成要你自己編譯，非常麻煩。

2. **關掉終端機，重新開一個。** 剛裝好的工具要等新視窗才認得。開好後打這行確認：

   ```bat
   node -v & python --version & git --version
   ```

   三行版本號都印出來就成功了。如果出現「不是內部或外部命令」，代表那個工具沒裝好，回第 1 步重裝。

3. **把原始碼抓下來。** 下面第一行會在你目前的位置建一個 `Kanaric` 資料夾（想放桌面的話，先打 `cd Desktop`），第二行是進到那個資料夾裡面。

   ```bat
   git clone https://github.com/bensionfang/Kanaric.git
   cd Kanaric
   ```

   **之後每一步都要在這個資料夾裡執行**，中途關掉終端機的話，記得重開後再 `cd` 回來。

4. **裝 Python 需要的套件。** 第一行建一個叫 `venv` 的獨立環境，讓這個專案的套件不會跟你電腦上其他 Python 程式打架；第二行進入它；第三行把 `requirements.txt` 列的套件一次裝好（會跑一兩分鐘）。

   ```bat
   python -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt
   ```

   venv 不是強制的，但強烈建議照做：程式只會自動去找專案資料夾裡的 `venv\`，建在別的地方就得自己處理 PATH。

5. **裝 Node.js 需要的套件。** 這行的意思是「進 web-app 資料夾、裝套件、再退回來」，一樣要跑個幾分鐘。

   ```bat
   cd web-app && npm install && cd ..
   ```

6. **啟動。** 在檔案總管裡對著專案資料夾的 `dev.bat` 點兩下，或在終端機打：

   ```bat
   dev.bat
   ```

   儀表板視窗會自己開起來，右下角系統匣出現圖示，螢幕上方出現靈動島。接著打開你的音樂播放器（Spotify、YouTube Music 等）放首歌，歌詞就會自己跟上。關掉視窗就是結束程式。

以上都做完後，之後每次要用，只要點 `dev.bat` 就好，前面五步不用再做一次。

### 其他啟動方式

以下指令要先 `cd web-app` 再執行：

```bash
npm start        # 只跑網頁後台 http://localhost:5720,不開桌面視窗與靈動島
npm run dev      # 同上,改動程式碼會自動重啟
npm run app      # 完整桌面版:後台 + 視窗 + 系統匣 + 靈動島(dev.bat 跑的就是這個)
npm run dist     # 打包成安裝檔,產出在 web-app/release/
```

從原始碼跑的時候，歌詞快取、聽歌記錄、設定都存在專案資料夾裡（`lyrics_data.db`、`settings.json`），跟安裝版的 `%APPDATA%/Kanaric/` 分開，兩邊資料不會互相影響。

---

## 使用說明

### 開始使用

1. 啟動 Kanaric（安裝版：桌面捷徑或開始選單；原始碼版：`dev.bat`）。
2. 用 Spotify 或 Apple Music 播放任何歌曲。
3. 儀表板自動顯示歌曲資訊與同步歌詞；日文歌自動標註假名。
4. 關閉視窗 = 結束整個程式。系統匣圖示：雙擊叫回視窗，右鍵可開啟儀表板、顯示/隱藏靈動島或結束。

### 主播放頁

- 歌詞隨播放進度自動捲動、高亮當前行；點任一行可跳播（seek）。有逐字時間的歌會逐字填色。
- 自動捲動分三段：歌詞落在畫面中間帶就逐句置中，往上下漂就只換高亮不搶你的畫面，捲出畫面才跳出「恢復同步」按鈕。
- 右下角工具列由左至右：備選歌詞、段落循環、編輯假名、重新載入、靈動島開關、放大模式；每顆都能在設定選單的「自訂快捷鍵」裡改鍵，或按眼睛圖示從工具列隱藏。
- 右下角的 `− 0 ms +` 是時間軸微調，每首歌獨立記憶，點中間的數字歸零。

### 修正假名讀音

1. 點播放列的**筆型按鈕**進入編輯模式。
2. 點任何一個注音字 → 直接輸入羅馬拼音（即時轉假名），Enter 儲存、Esc 取消。
3. 雙擊該字 = 還原成自動讀音。
4. 修正以「歌手 + 歌名 + 單字」為單位永久儲存，重播同曲自動套用，靈動島同步更新。

讀音的來源分四層，愈後面愈優先：字典（fugashi/unidic）→ utaten 的人工注音 → 內建的少數修正表 → **你自己改的**。日文歌約有 87% 能在 utaten 找到人工注音，剩下的多半是獨立樂團或官方歌名本來就是英文的歌。

### 快捷鍵（一律啟用，按鍵可在設定選單「自訂快捷鍵」改）

| 鍵 | 功能 |
|---|---|
| ← / → | 歌詞時間軸提前 / 延後 |
| ↑ / ↓ | 上一行 / 下一行純文字歌詞 |
| A | A-B 循環 |
| E | 假名編輯模式 |
| L | 歌詞選項 |
| R | 重新載入歌詞 |
| D | 靈動島開關 |
| F | 全螢幕 |

### 頁面

- **首頁** — 播放器與同步歌詞。
- **統計** — 聽歌時數、活躍時段、聽歌熱力圖等圖表。
- **排行榜** — 歌曲/歌手播放次數排名。
- **編輯器** — 手動貼上或修改歌詞、調整時間軸。
- **猜歌**（`/game`）— 邊聽邊猜，見上面「功能與特色」。

### 靈動島

- 拖曳移動；放開時靠近螢幕頂端會自動吸附。單擊切換吸附狀態，位置**每台螢幕各記一組**，接上或拔掉外接螢幕都不會跑掉。
- 滑鼠移上去展開：上一句歌詞、上一首/播放暫停/下一首、以及可點擊跳播的進度條。
- 第二行可設定顯示下一句歌詞、本句翻譯或本句羅馬拼音（設定選單的「靈動島」小節，連同行數、透明度、字體大小）。

### 設定（右上 ⋯ 選單）

字體大小、歌詞對齊、偏好歌詞來源、音訊來源（指定要跟哪個播放器，或交給自動判斷）、靈動島行數與透明度、自訂快捷鍵等。歌手名稱被平台翻譯錯誤時（如 サカナクション 顯示成「魚韻」），可設定歌手別名對應。另外幾個值得知道的：

- **顯示日文假名** — 關掉就只看漢字原文。
- **片假名標平假名** — 讀不了片假名的話打開它，`サヨナラ` 上方會多一行 `さよなら`，原文寫法保留。網頁與靈動島同步生效。
- **顯示中文翻譯 / 顯示羅馬拼音** — 各在歌詞下方多標一行，兩者可同時開。翻譯來自音樂平台自帶的譯文軌；羅馬拼音直接由注音結果轉換，不另外去要資料。
- **記錄聆聽紀錄** — 關掉就不寫入聽歌記錄，側欄的統計與排行榜也一併隱藏。同一區還有：資料庫用量、分項清除歌詞快取等可重建的資料（你手改過的假名、時間軸、歌手別名永遠不會被清）、備份成單一 `.db` 檔與從備份還原、匯出聽歌記錄 CSV。

### 行動版（iOS PWA，需自行部署）

`web-app/public/mobile/` 是一個獨立的手機版全螢幕歌詞頁：自己用 Spotify OAuth（PKCE）
讀播放狀態，顯示同步歌詞、注音、翻譯、羅馬拼音與逐字填色，可加到主畫面當 App 用。

它**不連你的電腦**，後端要另外部署到雲端（`Dockerfile` + `render.yaml` 已備好，
用 `CLOUD_MODE=1` 跑成唯讀模式：只服務手機頁與歌詞查詢，沒有任何寫入路由，
並用 `MOBILE_TOKEN` 環境變數擋住歌詞查詢）。部署後把兩個網址
（`http://127.0.0.1:5720/mobile/` 與你的雲端網址 `/mobile/`）都註冊成 Spotify 應用程式的 redirect URI。

---

## 專案結構

```
Kanaric/
├── web-app/                  # Node.js 後端 + 網頁前端 + Electron 桌面殼（一切從這裡啟動）
│   ├── server.js             # 核心後端:Express + WebSocket,歌詞抓取/快取、聽歌記錄、API
│   ├── electron.js           # Electron 殼:視窗、系統匣、啟動畫面、路徑注入、自動更新
│   ├── island.js             # 靈動島視窗:置頂透明窗、拖曳吸附、位置記憶（主進程）
│   ├── island-position.js    # 靈動島的多螢幕落位判定（純函式）
│   ├── preload-island.js     # 靈動島的 IPC 橋接
│   ├── s2t.js                # 簡轉繁 + 混進日文歌詞的簡體字逐字修正
│   ├── translations.js       # 中文譯文與歌詞行的比對合併
│   ├── romaji.js             # 由注音結果產生羅馬拼音行
│   ├── word-times.js         # 逐字卡拉OK:跨來源的字元流比對
│   ├── lyric-quality.js      # 擋掉「內嵌注音」那種沒救的歌詞版本
│   ├── title-lines.js        # 標記製作人員/版權/歌名列
│   ├── browser-query.js      # 瀏覽器(YouTube)標題去噪
│   ├── game.js               # 猜歌:干擾選項挑選、iTunes 曲目清洗
│   ├── package.json          # 指令與 electron-builder 打包設定
│   ├── views/                # EJS 頁面模板（首頁/統計/排行榜/編輯器/猜歌/靈動島）
│   └── public/               # 前端靜態資源
│       ├── js/app.js         # 主頁邏輯:歌詞同步捲動、假名編輯、快捷鍵、WebSocket 接收
│       ├── js/common.js      # 每頁共用:設定選單、快捷鍵設定、播放列
│       ├── js/karaoke.js     # 逐字填色（歌詞區/靈動島/行動版三端共用同一份）
│       ├── js/scroll-zone.js # 歌詞自動捲動的三段判定（純函式）
│       ├── js/lyrics-tools.js# 歌詞工具（選項彈窗等）
│       ├── mobile/           # 行動版 PWA（Spotify OAuth PKCE,見 docs/mobile/）
│       ├── vendor/           # 自架的字型/圖示/Chart.js（打包版離線也要能用,不走 CDN）
│       ├── css/island.css    # 靈動島樣式
│       └── css/style.css     # 全站樣式
├── pytools.py                # Python 工具統一入口,server.js 以子進程呼叫各子指令
├── media_monitor.py          # 常駐:輪詢 Windows Media API,回報播放狀態
├── furigana_inject.py        # 假名標註:斷詞注音 + utaten 人工注音 + 使用者修正覆蓋
├── utaten.py                 # 爬 utaten 的人工注音（目前唯一的外部讀音來源）
├── cn_music.py               # 網易雲 / QQ / Kugou 客戶端（歌詞 + 中文譯文 + 逐字時間）
├── qrc_decrypt.py            # QQ QRC 歌詞解密（特製 3DES,勿用標準函式庫取代）
├── search_fallback.py        # 備援歌詞搜尋（syncedlyrics 多來源 + iTunes 日文原名重試）
├── db.py / config.py         # Python 端 SQLite 存取與路徑設定
├── utils.py                  # 共用字串工具（羅馬拼音 ↔ 假名轉換等）
├── scripts/                  # 一次性維護腳本（歌名還原、注音補全、逐字時間補全…）
├── tests/                    # 零星的獨立測試檔,直接用直譯器跑,沒有 test runner
├── lyrics_data.db            # SQLite 資料庫（歌詞快取、聽歌歷史、假名修正…,不進版控）
├── settings.json             # 介面設定（開發模式用;打包版在 %APPDATA%）
└── requirements.txt          # Python 依賴
```

### 架構一句話

一個 Node.js 後端（`server.js`）持有全部業務邏輯；Python 腳本是它按需喚起的無狀態工人；網頁前端與靈動島都只是吃 WebSocket 推播的顯示端。

### 資料庫主要資料表

| 資料表 | 用途 |
|---|---|
| `cache` | 歌詞快取（歌手 + 歌名為鍵） |
| `listening_history` | 聽歌歷史（累積播放 30 秒才寫入） |
| `word_corrections` | 使用者的假名讀音修正 |
| `sync_offsets` | 逐首歌的時間軸偏移 |
| `artist_aliases` | 歌手別名對應（還原平台翻譯） |
| `search_overrides` | 逐首歌的自訂搜尋關鍵字 |
| `utaten_hints` | utaten 人工注音的快取 |
| `lyrics_translations` | 中文譯文快取 |
| `word_times` | 逐字卡拉OK的時間資料 |
| `game_history` | 猜歌的每題結果 |

`word_corrections`、`sync_offsets`、`artist_aliases`、`search_overrides` 這四張是你親手打的，
任何清除功能都碰不到，只有備份救得回來；其餘都是抓得回來的快取。

## 致謝

懸浮歌詞島的概念啟發自 [Lyricify](https://github.com/WXRIW/Lyricify-App) 的
**灵动词岛 / Dynamic Lyrics Island**（作者 WXRIW / XY Wang，採 CC BY-SA 4.0 授權）。
本專案的介面與程式碼皆為獨立實作。

`qrc_decrypt.py` 中的 QQ QRC 解密實作移植自 Lyricify 的 `DESHelper.cs`
（Copyright 2023 XY Wang, WXRIW，Apache License 2.0），已由 C# 改寫為 Python。
授權全文見 [`third_party/Lyricify-LICENSE-Apache-2.0.txt`](third_party/Lyricify-LICENSE-Apache-2.0.txt)。
Apache-2.0 相容於 GPLv3，所以那段程式碼可以合法收在本專案裡；該檔案的原始授權標頭請勿移除。

---

## 授權

Kanaric 採 [GNU General Public License v3.0 或更新版本](LICENSE)。

白話說：你可以自由使用、研究、修改、散布本程式。但只要你把改過的版本散布出去，
**那份改過的版本也必須以同樣的 GPL 授權開源**，並附上原始碼。想拿去做閉源商品的話，
這個授權不允許。

```
Copyright (C) 2026 Resuaumis

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.
```
