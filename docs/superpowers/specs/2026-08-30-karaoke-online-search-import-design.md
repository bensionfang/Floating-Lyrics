# Kanaric 線上歌曲搜尋、音訊匯入、伴奏準備與點歌設計

**日期：** 2026-08-30
**實作目標分支：** `codex/karaoke-system-gap-closure`
**實作 worktree：** `C:\Users\USER\Desktop\project\Kanaric-karaoke-system-gap-closure`

## 1. 目標

讓 Host 使用者可以搜尋線上歌曲，取得具有明確授權且可下載的完整音訊，匯入 Kanaric；若沒有官方伴奏，則以本機離線人聲分離產生 instrumental，再沿用既有點歌流程：

`線上搜尋／本機合法音訊 → 下載或匯入 → mpv 驗證 → 原曲 SongLibrary → 官方伴奏優先，否則離線分離 → instrumental SongLibrary → Queue reserve → Session PREPARING → MPV → 字幕／Key`

播放器仍由 Kanaric 的 MPV 擁有。伴奏生成只新增播放前的資產準備，不改 Session、Queue、Stage、字幕時間軸或 `-6..+6` Key 演算法。

## 2. 音源與伴奏優先順序

1. **使用者已有的官方 off-vocal／instrumental：** 直接匯入，品質最高，不再分離。
2. **可合法下載的完整 instrumental：** 經授權與 mpv probe 後直接匯入。
3. **使用者已有或可合法下載的完整原曲：** 保留 studio 原曲，再由本機 worker 離線分離出 instrumental。
4. **只有 Spotify／Apple Music／YouTube Music／YouTube 播放頁：** 只可用於發現歌曲或靜音 MV 背景，不擷取音訊、不進伴奏管線。

自動分離不是原始官方伴奏的等價替代。UI 必須標示 `官方伴奏`、`AI 分離伴奏` 或 `原曲`；分離失敗時保留可播放原曲，不把它冒充伴奏，也不自動排進 Queue。

## 3. 現實邊界

- 第一版不承諾找到所有流行或冷門日文歌曲。Internet Archive 只能建立合法自動下載鏈，覆蓋率不代表商業曲庫。
- 搜尋結果不等於可下載。只有來源明確提供完整檔、具有允許的授權欄位且通過本機解碼驗證的結果才可匯入。
- 網易雲自動下載只作為 amaoke 架構研究，不納入本版。開源程式授權不會同時授予歌曲或音樂服務的使用權。
- 人聲分離需要額外模型與運算資源，可能產生人聲殘留、混響、合聲或樂器損傷；不得宣稱 100% 還原。
- 沒有同步歌詞時仍可匯入及播放，但 UI 必須明示「播放時搜尋歌詞；可能找不到」，不可製造或假裝有同步字幕。
- 官方伴奏若已存在，禁止再浪費時間與品質做 AI 分離。

## 4. 第一版線上來源

第一版自動搜尋與下載只支援 **Internet Archive**，不建立多供應商 factory、provider 設定頁或登入系統。

只接受 `licenseurl` 指向 Creative Commons CC0、Public Domain Mark、CC BY 或 CC BY-SA 的 item。第一版排除 NC／ND；只有自由文字 `rights`、缺少 `licenseurl` 或授權 URL 不在 allowlist 的結果一律不可匯入。

不採用：

- **Jamendo：** 永久匯入與其 API 快取／離線限制有直接衝突。
- **Apple iTunes Search：** `previewUrl` 是宣傳短版，不能當完整 Karaoke 音訊。
- **Spotify／Apple Music／YouTube Music／YouTube：** 不擷取 DRM、受保護串流或影音音軌，不整合通用影音下載器。
- **網易雲：** amaoke 以登入帳號取得下載 URL 的流程不作為 Kanaric 正式來源；若未來要評估，必須另做服務條款、地區、帳號、付費內容與失效行為審查。

## 5. 使用者流程

線上匯入與伴奏準備只放在 localhost Host；手機 Remote 只能搜尋已匯入且 `audio.status=ready` 的 SongLibrary。

1. Host 在本機曲庫旁切到「線上歌曲」，輸入歌名或歌手。
2. Server 查 Internet Archive，Host 顯示歌曲、歌手、來源頁、授權、格式、長度與候選類型，不顯示下載 URL或本機路徑。
3. 使用者按「匯入並準備伴奏」。Server 回 `jobId`，Host 輪詢真實狀態：`下載中 → 驗證中 → 原曲已匯入 → 分離伴奏中 → 伴奏驗證中 → 可點歌`。
4. 若使用者確認候選本身是 instrumental，略過人聲分離，直接匯入 `variant=instrumental`。
5. 若候選為完整原曲，先匯入 `variant=studio`，再排入單工本機分離 worker。
6. 分離成功後，將 instrumental 以穩定衍生 `songId` 匯入 SongLibrary；vocals 僅保存為 server-owned artifact，第一版不出現在搜尋結果與 Queue。
7. Host 預設以 instrumental `songId` 呼叫既有 `karaoke_queue_reserve`。使用者明確選擇「唱原曲」時才 reserve studio。
8. 分離失敗或 worker 不可用時顯示「原曲已匯入，伴奏未完成」及可重試狀態；不得靜默把 studio 當 instrumental。
9. Stage 使用既有 `/api/lyrics/fetch` 與 MPV；字幕、Seek、Restart、Ended、Next 和 Key 不建立第二條路。

既有本機 studio song 也可由 Host 按「產生伴奏」，只提交 `songId`。Client 不可提交本機 path、worker command、model path 或輸出 path。

## 6. 元件與責任

### 6.1 `karaoke-online-catalog.js`

只負責 Internet Archive 搜尋、安全下載、mpv probe 與 studio／官方 instrumental 匯入：

```js
createKaraokeOnlineCatalog({
  library,
  storageDir,
  fetchImpl,
  validateAudio,
  now,
  idFactory,
})
```

```js
onlineCatalog.search(query)
onlineCatalog.importResult(searchId, resultId)
onlineCatalog.dispose()
```

`importResult()` 對 caller 只回 path-free `{songId, title, artist, album, variant, lyricsStatus}`。Client 不得取得 identifier、filename、下載 URL 或本機 path。

### 6.2 `karaoke-stem-separator.js`

只負責可信 SongLibrary studio song 的分離工作、快取與衍生 instrumental 匯入：

```js
createKaraokeStemSeparator({
  library,
  artifactDir,
  worker,
  validateAudio,
  now,
})
```

```js
stemSeparator.start(songId)       // => { jobId, status }
stemSeparator.getJob(jobId)       // => safe progress projection
stemSeparator.retry(songId)       // => { jobId, status }
stemSeparator.dispose()
```

`start()` 只能以 `SongLibrary.loadSong(songId)` 解析 ready studio audio。只有 server 取得的 canonical path 可交給 worker。相同 `sourceFingerprint + modelId` 的同時請求共用一個 Promise；worker 全域一次只跑一首，避免 GPU／RAM 爭用。

### 6.3 分離 worker

- 參考 amaoke 的 `audio-separator`＋BS-RoFormer 兩軌做法，但自行實作本機 CLI bridge，不搬 FastAPI、Docker、Mongo、Caddy 或瀏覽器 Tone.js。
- 第一個 runtime spike 固定測試 `model_bs_roformer_ep_317_sdr_12.9755.ckpt`；通過後把實際 `audio-separator` 版本、模型檔名與 SHA-256 寫進 handoff／manifest。
- 正常播放期間不得自動下載模型。安裝 dependency／模型屬明確的 setup gate，需使用者批准網路下載。
- `audio-separator` 需要 FFmpeg。worker 只能使用 server 已解析並驗證的 FFmpeg directory；找不到 `ffmpeg.exe` 或 `ffmpeg -version` 失敗時回報 unavailable，不在播放期間自行安裝。
- worker 以 argument array 啟動，不使用 shell；輸入、輸出、模型與 temporary directory 都由 server 決定。
- 第一版保存 worker 原生 WAV 輸出，不轉成 amaoke 的 96 kbps Opus，避免額外 ffmpeg dependency 與再次有損壓縮。
- 每個 job 使用獨立 temporary directory；完成後先對 instrumental 做 mpv probe，再原子移入正式 artifact directory。
- worker timeout、exit non-zero、缺輸出、零 bytes、輸出越界或 probe 失敗都視為伴奏失敗；studio 原曲不得刪除或降級。
- `vocals.wav` 保留在 server-owned artifact directory，第一版不建立雙播放器混音或導唱滑桿。

### 6.4 SongLibrary 表示

- studio：沿用 `internet-archive:${identifier}:${sha256(filename)}` 或既有 local songId。
- instrumental：`${studioSongId}:instrumental`，metadata title／artist／album 與 studio 相同，`variant='instrumental'`。
- vocals 不建立 SongLibrary song，避免它出現在一般搜尋與 Queue。
- instrumental 的 `preferences` 只保存不含 path 的 provenance：

```js
{
  derivedFromSongId,
  separation: {
    engine: 'audio-separator',
    modelId,
    modelSha256,
    sourceFingerprint,
    createdAt,
  },
}
```

不新增資料庫 table 或 migration。重跑同一來源與同一模型要命中 artifact manifest，不重算；模型變更只能由使用者明確要求重新產生。

### 6.5 背景狀態

job 僅存在 process memory，不建立 persistent queue。安全投影固定為：

```js
{
  jobId,
  sourceSongId,
  instrumentalSongId,
  state,       // queued|separating|validating|ready|partial|failed
  progress,    // null 或 0..1；worker 無真實進度時必須為 null
  errorCode,
}
```

App 重啟後 job 狀態可遺失，但已完成的 studio、instrumental 與 manifest 必須可重新辨識；殘留 temporary directory 在下次啟動安全清理。不得捏造百分比。

## 7. 搜尋、下載與驗證

- query 最長 100 Unicode code points；Advanced Search 最多 5 items，Metadata 展開後最多 20 results。
- 只支援 `.mp3`、`.m4a`、`.aac`、`.ogg`、`.opus`、`.flac`、`.wav`；不把影片當音訊。
- 搜尋結果在 server Map 保存 10 分鐘，Client 只拿隨機 `searchId/resultId`。
- Client 不可指定 URL。下載只允許 HTTPS，redirect 最多 5 次且只接受 Internet Archive 官方 host。
- timeout 120 秒、上限 200 MiB；無 Content-Length 仍逐 byte 計數。
- 暫存檔使用隨機 `.part`；失敗在 `finally` 清理，mpv probe 成功才原子 rename。
- 同一 source song 的 concurrent import 只下載一次。
- mpv probe 成功只證明可解碼，不代表實體喇叭已聽到。

## 8. Admin API

只在 loopback Admin Express app 增加：

- `GET /api/karaoke/online/search?q=query`
- `POST /api/karaoke/online/search/:searchId/import`，body `{ "resultId": "..." }`
- `POST /api/karaoke/stems`，body `{ "songId": "..." }`
- `GET /api/karaoke/stems/:jobId`
- `POST /api/karaoke/stems/:songId/retry`

Remote listener 對所有 online／stems routes 均為 404。Origin／Sec-Fetch-Site 守門照舊；response 不得包含本機 path、download URL、worker command、model path 或 raw exception。

新增錯誤碼：

- `karaoke-stem-worker-unavailable`
- `karaoke-stem-ffmpeg-unavailable`
- `karaoke-stem-source-invalid`
- `karaoke-stem-separation-failed`
- `karaoke-stem-output-invalid`
- `karaoke-stem-timeout`
- `karaoke-stem-job-not-found`

既有 online search／download 錯誤碼保持不變。

## 9. 不做事項

- 不做 Spotify／Apple Music／YouTube Music／YouTube 音訊擷取。
- 不做任意 URL 匯入、yt-dlp 或「貼網址下載」。
- 不做網易帳號登入／下載、不做多 provider framework。
- 不做 Remote 觸發線上搜尋、下載或分離。
- 不做即時人聲消除、系統音訊擷取、雙播放器導唱混音或人聲音量滑桿。
- 不做自動判定「這首一定是官方伴奏」；不確定時標成原曲。
- 不把 GPU 模型、Python stem runtime 或 FFmpeg 塞進主安裝包，直到 runtime／授權／大小 gate 有直接證據。
- 不變更 Stage ownership、Queue schema、Remote protocol、字幕格式或 Key 演算法。

## 10. 驗收標準

1. Host 只看到符合授權與格式規則的線上結果；不洩漏 URL／path。
2. 安全下載、redirect、大小、timeout、partial cleanup 與 mpv probe 都有 focused tests。
3. 原曲匯入成功後即使分離失敗仍可播放，且 UI 明確顯示伴奏未完成。
4. worker 只接受 server-resolved studio song；同來源／同模型不重算，單工執行。
5. instrumental 通過 mpv probe 後才以穩定衍生 songId／`variant=instrumental` 匯入。
6. Host 預設 reserve instrumental；studio 只有在使用者明確選擇時才 reserve。
7. Stage 字幕與 Queue／MPV Key 沿用既有路徑；instrumental 不建立第二套 lyric cache。
8. Remote port 不暴露 online／stems routes；cross-site browser request 被 origin guard 擋下。
9. 至少以五類合法測試音訊人工 A/B：乾淨主唱、合唱、強混響、重型編曲、live；逐首記錄 vocal bleed、樂器損傷、處理時間與可唱性，不以一首成功概括全部。
10. 實體 MPV 播放驗證 original／instrumental 切換、Key -2／0／+2、字幕同步；自動測試、GPU runtime、Electron、實體聲音證據分開。
11. 新 focused tests 與最新完整 `npm.cmd test` 通過；此功能不自動把 release disposition 改成 `ACCEPTED`。

## 11. amaoke 參考邊界

- 可取：兩軌離線分離、原曲與 stems 快取、歌詞與音訊並行準備、下一首預處理的產品概念。
- 不取：Tone.js `playbackRate` 造成速度與音高綁定、96 kbps Opus 二次壓縮、網易音源下載、伺服器 Docker／Mongo 架構。
- 若直接複製 amaoke 的實質程式碼，必須保留其 MIT copyright／license notice；本計畫預設只採用概念並依 Kanaric 邊界自行實作。

## 12. 官方與研究依據

- Internet Archive Advanced Search：<https://archive.org/advancedsearch.php>
- Internet Archive Item Metadata API：<https://archive.org/developers/md-read.html>
- Internet Archive item 與 archival download URL：<https://archive.org/developers/items.html>
- Internet Archive metadata schema：<https://archive.org/developers/metadata-schema/index.html>
- amaoke：<https://github.com/MaigoLabs/amaoke.app>
- amaoke 音訊分離 worker：<https://github.com/MaigoLabs/amaoke.app/blob/abc02e6dc13e1b32863f023d848e7037313cfa90/scripts/server.py>
- amaoke MIT License：<https://github.com/MaigoLabs/amaoke.app/blob/abc02e6dc13e1b32863f023d848e7037313cfa90/LICENSE>
- audio-separator：<https://github.com/nomadkaraoke/python-audio-separator>
- audio-separator FFmpeg requirement：<https://github.com/nomadkaraoke/python-audio-separator#-ffmpeg-dependency>
