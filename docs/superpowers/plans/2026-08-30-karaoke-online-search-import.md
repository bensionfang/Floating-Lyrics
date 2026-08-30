# Kanaric 線上歌曲搜尋、音訊匯入、伴奏準備與點歌實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 從合法線上來源或既有本機原曲取得可播放音訊，優先使用官方 instrumental，否則以本機離線人聲分離產生 instrumental，再沿用既有 SongLibrary／Queue／Session／Stage／MPV 完成字幕與獨立升降 Key 的點歌流程。

**Architecture:** Internet Archive catalog 只負責安全搜尋、下載、mpv probe 與 studio／官方 instrumental 匯入；新增的 stem separator 只接受 server 從 SongLibrary 解析出的可信 studio path，以獨立 Python worker 單工產生 vocals／instrumental，驗證後把 instrumental 登記成衍生 SongLibrary song。Stage 仍是唯一 player owner，Queue、字幕與 MPV Key 不變。

**Tech Stack:** Node.js CommonJS、Express、SQLite SongLibrary、mpv、Python 3、`audio-separator` 0.44.5、BS-RoFormer、FFmpeg、既有 EJS／原生瀏覽器 JS。

**Spec:** `C:\Users\USER\Desktop\project\Kanaric\docs\superpowers\specs\2026-08-30-karaoke-online-search-import-design.md`

## Global Constraints

- 實作位置固定為 `C:\Users\USER\Desktop\project\Kanaric-karaoke-system-gap-closure`、branch `codex/karaoke-system-gap-closure`；原始 checkout 只保存本計畫與 Spec。
- 以專用 worktree 現有 dirty state 為接續基線；不得 reset、clean、checkout、restore、stash、rebase、merge、cherry-pick 或刪除既有成果。
- 未經使用者明確授權不得 commit、push、PR、tag、Release 或上傳公開內容。
- 第一版線上 provider 只有 Internet Archive；不得加入 yt-dlp、任意 URL import、網易登入／下載、DRM 擷取或 provider framework。
- 官方 off-vocal／instrumental 優先；AI 分離結果必須標成 `AI 分離伴奏`，不得冒充官方伴奏。
- 不搬 amaoke 的 Tone.js、FastAPI、Docker、Mongo、Caddy 或 96 kbps Opus 轉碼；只採用兩軌離線分離與快取概念。
- 不改 Stage ownership、Queue schema、Remote protocol、字幕格式、歌詞查詢或 MPV Key 演算法。
- `audio-separator` 與模型只能在明確 runtime spike／setup gate 下載；正常播放不得臨時下載模型。
- FFmpeg 是 stem worker 的硬需求；只能使用 server 已解析並通過 `ffmpeg -version` 的固定 executable directory，不接受 client path，也不在播放時自動安裝。
- 測試不得連真實 Internet Archive 或下載真模型；unit／contract tests 使用 fake fetch、fake worker 與小型本機音訊 fixture。
- fixed-port tests 串行；DB、settings、DATA_DIR、artifactDir 使用隔離暫存路徑。
- Node／localhost／browser／Electron／Python worker／GPU／mpv decode／實體聲音證據分開記錄；不得互相代替。
- 現有 release disposition 保持 `NOT ACCEPTED`，除非原本全部 release gates 另有直接證據。

---

## 已確認現況

- 本機歌曲鏈已存在：scan/import → SongLibrary → Host／Remote search → Queue reserve → Session → MPV。
- SongLibrary 以穩定 `songId` 表示一個可播放 variant，現有 `variant` 與 `preferences` 足夠保存 studio／instrumental provenance，不需要 migration。
- `/karaoke?player=mpv` 已把 Queue `-6..+6` Key 送入 MPV pitch；不得改回速度與音高綁定。
- Stage 已按 title／artist 走既有 `/api/lyrics/fetch`；衍生 instrumental 沿用相同歌詞鍵。
- amaoke 已證明 `audio-separator`＋BS-RoFormer 兩軌流程可行，但其網易下載、Web server 與 Tone.js 架構不適合直接搬入 Kanaric。
- 最新 handoff 曾記錄 `46/46 Node tests passed`，實作開始時必須重跑，不能把舊輸出當目前證據。

## Task 0：接手、基線與停止閘門

**Files:**

- Read: `AGENTS.md`
- Read: `docs/CODEX_HANDOFF.md`
- Read: 本 Spec 與本 Plan

**Interfaces:**

- Consumes: 專用 worktree 的實際 branch、HEAD、dirty files 與目前測試輸出。
- Produces: 可重現的基線紀錄；不修改產品檔案。

- [ ] **Step 1: 讀取邊界文件與目前狀態**

```powershell
git status --short --branch
git log -1 --oneline
git diff --stat
git diff --check
```

- [ ] **Step 2: 跑目前完整 Node suite**

```powershell
cd web-app
npm.cmd test
```

- [ ] **Step 3: 判定 gate**

Branch 不是 `codex/karaoke-system-gap-closure`、handoff 與 dirty state 無法對上、`git diff --check` 失敗或既有 suite 非零退出時立即停止；不得先修、整理或重置基線。

**Task 0 stop:** 只確認接手條件，沒有新功能。

## Task 1：Internet Archive 搜尋與安全投影

**Files:**

- Create: `web-app/karaoke-online-catalog.js`
- Create: `tests/test_karaoke_online_catalog.js`
- Modify: `tests/run_all.js`

**Interfaces:**

- Produces: `createKaraokeOnlineCatalog({ library, storageDir, fetchImpl, validateAudio, now, idFactory })`。
- Produces: `search(query)`, `importResult(searchId, resultId)`, `dispose()`；Task 2 延伸 `importResult()`。

- [ ] **Step 1: 寫搜尋 RED tests**

固定測試：空 query；100 Unicode code points；Lucene escaping；最多 5 items／20 results；CC0／PDM／CC BY／CC BY-SA allowlist；拒絕 NC／ND／缺 licenseurl／未知 URL；只投影音訊檔；10 分鐘 TTL；projection 不含 identifier、filename、download URL 或 path。

- [ ] **Step 2: 確認 RED**

```powershell
node tests/test_karaoke_online_catalog.js
```

Expected: `MODULE_NOT_FOUND` 或 `createKaraokeOnlineCatalog is not a function`。

- [ ] **Step 3: 實作最小 catalog**

```js
const catalog = createKaraokeOnlineCatalog({
  library,
  storageDir,
  fetchImpl,
  validateAudio,
  now,
  idFactory,
});
```

只在單一模組內放 query normalize／escape、Internet Archive fetch、license／extension allowlist、server-only candidate Map 與安全 projection；不建立 provider base class。

- [ ] **Step 4: 跑 focused tests**

```powershell
node tests/test_karaoke_online_catalog.js
node --check web-app/karaoke-online-catalog.js
```

Expected: PASS／exit 0。

**Task 1 stop:** 尚未下載、寫檔、分離或改 routes。

## Task 2：安全下載、mpv probe 與原始 variant 匯入

**Files:**

- Modify: `web-app/karaoke-online-catalog.js`
- Modify: `tests/test_karaoke_online_catalog.js`

**Interfaces:**

- Consumes: Task 1 server-only `searchId/resultId` Map。
- Produces: `importResult()` 的 path-free `{ songId, title, artist, album, variant, lyricsStatus }`。
- Produces: studio `songId=internet-archive:${identifier}:${sha256(filename)}`；使用者明確標記 instrumental 時使用 `variant='instrumental'`。

- [ ] **Step 1: 寫下載與 trust-boundary RED tests**

覆蓋偽造 ID、canonical URL、HTTPS、最多 5 redirects、host allowlist、200 MiB、120 秒 timeout、錯誤 MIME、zero bytes、中斷、validator false、`.part` cleanup、原子 rename、concurrent import dedupe、stable songId、path-free response。

- [ ] **Step 2: 確認 RED**

```powershell
node tests/test_karaoke_online_catalog.js
```

Expected: 新 import cases FAIL；搜尋 cases 維持 PASS。

- [ ] **Step 3: 用 Node stdlib 實作最小下載器**

只使用 `fetch`、`AbortController`、`Readable.fromWeb`、`Transform`、`pipeline`、`fs.promises`、`crypto`、`child_process.spawn`。Client 不可提交 URL、identifier、filename、license 或 path。

- [ ] **Step 4: 以既有 `resolveMpvPath()` 做 decode probe**

probe 必須無畫面、無聲、有限時間；只有 exit 0 才原子 rename 並呼叫：

```js
await library.importSong({
  songId,
  metadata: { title, artist, album, variant },
  audio: { path: finalPath, durationMs },
  preferences: { source },
});
```

- [ ] **Step 5: 驗證**

```powershell
node tests/test_karaoke_online_catalog.js
node tests/test_song_library.js
node tests/test_mpv_karaoke_player.js
node --check web-app/karaoke-online-catalog.js
```

Expected: PASS／exit 0。

**Task 2 stop:** 原曲／使用者確認的官方伴奏可匯入；尚未生成人工伴奏。

## Task 3：BS-RoFormer runtime spike，先證明再整合

**Files:**

- Create: `scripts/stem_separator.py`
- Create after spike passes: `requirements-stems.txt`
- Create: `tests/test_stem_separator_contract.py`
- Modify after spike passes: `docs/CODEX_HANDOFF.md`

**Interfaces:**

- Produces CLI shape: `stem_separator.py --input ABSOLUTE_INPUT_AUDIO --output-dir ABSOLUTE_JOB_DIR --model-dir ABSOLUTE_MODEL_DIR`；三個實際值全部由 Node server 傳入，不由 renderer 組合。
- Produces one JSON line on stdout: `{"ok":true,"instrumental":"instrumental.wav","vocals":"vocals.wav","modelId":"model_bs_roformer_ep_317_sdr_12.9755.ckpt"}`；errors go to stderr and exit non-zero。Python wrapper 必須把模型原始輸出重新命名成這兩個固定 basename。
- Model for first spike: `model_bs_roformer_ep_317_sdr_12.9755.ckpt`。

- [ ] **Step 1: 寫不需模型的 RED contract test**

測試 argument validation、output directory containment、JSON-only stdout、missing dependency 錯誤與 non-zero exit；以 injected fake separator module 產生兩個小 WAV，不下載模型。

- [ ] **Step 2: 確認 RED**

```powershell
venv\Scripts\python.exe tests\test_stem_separator_contract.py
```

Expected: script 尚不存在而 FAIL。

- [ ] **Step 3: 實作最小 Python CLI**

```python
separator = Separator(output_dir=str(output_dir), output_format='WAV', model_file_dir=str(model_dir))
separator.load_model(model_filename=MODEL_ID)
files = separator.separate(str(input_path))
```

只接受既有 regular file 與 server 建立的 output directory；回傳 basename，不在 JSON 暴露 canonical path；不啟動 HTTP listener。

- [ ] **Step 4: 跑 fake contract GREEN**

```powershell
venv\Scripts\python.exe tests\test_stem_separator_contract.py
```

Expected: PASS／exit 0。

- [ ] **Step 5: 經使用者批准後建立隔離 runtime**

```powershell
py -3.12 -m venv venv-stems
venv-stems\Scripts\python.exe -m pip install "audio-separator[gpu]==0.44.5"
```

第一個正式支援 spike 是 Windows＋NVIDIA。沒有可用 NVIDIA 時，另在乾淨 `venv-stems-cpu` 測 `audio-separator[cpu]==0.44.5`，只記錄處理時間，不在證據不足時宣稱 CPU 可用於日常點歌。

- [ ] **Step 6: 驗證固定 FFmpeg runtime**

由使用者提供或批准安裝 FFmpeg；解析成固定絕對 directory 後執行：

```powershell
& (Join-Path $stemFfmpegDir 'ffmpeg.exe') -version
```

`$stemFfmpegDir` 必須是本次 task 專用變數，且該目錄內存在 regular-file `ffmpeg.exe`。exit 非 0 就停止 Task 3；不得把 mpv.exe 冒充 FFmpeg，也不得在 app 正常播放時臨時從網路安裝。

- [ ] **Step 7: 下載固定模型並記錄 hash**

只由 `audio-separator` 官方模型機制下載 `model_bs_roformer_ep_317_sdr_12.9755.ckpt` 到隔離 modelDir。記錄套件版本、backend、GPU／CPU、模型 SHA-256、下載來源與授權 notice；正常播放不得觸發下載。

- [ ] **Step 8: 以一首使用者有權處理的音訊做 runtime spike**

```powershell
$stemSpikeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('kanaric-stem-spike-' + [guid]::NewGuid())
$stemOutputDir = Join-Path $stemSpikeRoot 'output'
$stemModelDir = Join-Path $stemSpikeRoot 'models'
$approvedStemAudio = Read-Host '輸入你有權處理的本機音訊絕對路徑'
New-Item -ItemType Directory -Path $stemOutputDir, $stemModelDir | Out-Null
$env:PATH = "$stemFfmpegDir;$env:PATH"
venv-stems\Scripts\python.exe scripts\stem_separator.py --input $approvedStemAudio --output-dir $stemOutputDir --model-dir $stemModelDir
```

驗證有兩個非零 WAV、mpv 可解碼、時長與原曲差不超過 3000 ms，並人工聽 instrumental。音訊絕對路徑只在執行時由使用者輸入，禁止計畫執行者自行挑取或下載歌曲。

- [ ] **Step 9: 通過後固定 dependency**

`requirements-stems.txt` 固定為：

```text
audio-separator[gpu]==0.44.5
```

若只有 CPU spike 通過，檔案固定為 `audio-separator[cpu]==0.44.5`，handoff 必須明寫處理時間與「CPU-only」；不得同時列兩個 extras。

**Task 3 stop:** 真 worker／模型／硬體任一 gate 失敗就停止伴奏整合；Tasks 1–2 的原曲匯入仍可獨立保留，不以 fake worker 冒充伴奏可用。

## Task 4：可信本機分離 service、快取與衍生 instrumental

**Files:**

- Create: `web-app/karaoke-stem-worker.js`
- Create: `web-app/karaoke-stem-separator.js`
- Create: `tests/test_karaoke_stem_worker.js`
- Create: `tests/test_karaoke_stem_separator.js`
- Modify: `tests/run_all.js`

**Interfaces:**

- Produces: `createKaraokeStemWorker({ pythonPath, scriptPath, modelDir, ffmpegDir, spawnImpl, timeoutMs })` with `run({ inputPath, outputDir })`。
- Produces: `createKaraokeStemSeparator({ library, artifactDir, worker, validateAudio, now, idFactory })` with `start(songId)`, `getJob(jobId)`, `retry(songId)`, `dispose()`。
- Produces derived ID: `` `${studioSongId}:instrumental` ``。

- [ ] **Step 1: 寫 worker RED tests**

覆蓋 argument array／`shell:false`、timeout、non-zero、invalid JSON、缺 stem、output path escape、零 bytes、cleanup 與不把 stderr/raw path 回給 client。

- [ ] **Step 2: 寫 separator RED tests**

覆蓋：只接受 `variant=studio` 且 ready audio；server 解析 path；相同 fingerprint＋model dedupe；全域 concurrency=1；job states；instrumental mpv probe；stable derived ID；manifest cache；failure 保留 studio；vocals 不進 SongLibrary；`dispose()` 不刪成品。

- [ ] **Step 3: 確認 RED**

```powershell
node tests/test_karaoke_stem_worker.js
node tests/test_karaoke_stem_separator.js
```

Expected: MODULE_NOT_FOUND／FAIL。

- [ ] **Step 4: 實作 worker bridge**

```js
const child = spawn(pythonPath, [
  scriptPath,
  '--input', inputPath,
  '--output-dir', outputDir,
  '--model-dir', modelDir,
], {
  shell: false,
  windowsHide: true,
  env: { ...process.env, PATH: `${ffmpegDir};${process.env.PATH || ''}` },
});
```

stdout 只解析最後一個完整 JSON line；stderr 只進 server log 的截斷訊息，不越過 API boundary。

- [ ] **Step 5: 實作單工 separator 與 manifest**

正式 artifact 位置固定為 `` path.join(DATA_DIR, 'karaoke-stems', sha256(studioSongId)) ``。每次 job 用其下隨機 temp directory；instrumental probe 成功後原子移入 `instrumental.wav`，vocals 移入 `vocals.wav`，最後原子寫 `manifest.json`。

- [ ] **Step 6: 匯入衍生 SongLibrary song**

```js
await library.importSong({
  songId: `${studio.songId}:instrumental`,
  metadata: { ...studio.metadata, variant: 'instrumental' },
  audio: { path: instrumentalPath, durationMs: studio.audio.durationMs },
  preferences: { derivedFromSongId: studio.songId, separation: provenance },
});
```

不要複製歌詞進新表；title／artist 相同即可沿用 Stage 的現有歌詞查詢。

- [ ] **Step 7: 驗證**

```powershell
node tests/test_karaoke_stem_worker.js
node tests/test_karaoke_stem_separator.js
node tests/test_song_library.js
node tests/test_mpv_karaoke_player.js
node --check web-app/karaoke-stem-worker.js
node --check web-app/karaoke-stem-separator.js
```

Expected: PASS／exit 0。

**Task 4 stop:** service 可由測試呼叫；尚未暴露 HTTP 或修改 Host。

## Task 5：localhost Admin API 與 Remote 隔離

**Files:**

- Modify: `web-app/server.js`
- Modify: `web-app/package.json`（只加入新 runtime JS／Python script 的打包路徑；不得把模型塞進 installer）
- Modify: `tests/test_karaoke_catalog.js`
- Modify: `tests/test_karaoke_remote.js`
- Modify: `tests/test_origin_guard.js`

**Interfaces:**

- Produces Admin routes: online search/import；`POST /api/karaoke/stems`；`GET /api/karaoke/stems/:jobId`；`POST /api/karaoke/stems/:songId/retry`。
- Remote listener must return 404 for every new route。

- [ ] **Step 1: 寫 API／隔離 RED tests**

測 path-free response、只收 `{resultId}`／`{songId}`、固定 error codes、raw exception 不洩漏、Remote 404、cross-site browser blocked、同源 Host allowed。

- [ ] **Step 2: 確認 RED**

```powershell
node tests/test_karaoke_catalog.js
node tests/test_karaoke_remote.js
node tests/test_origin_guard.js
```

- [ ] **Step 3: 接入 server**

Catalog storage 固定 `DATA_DIR\karaoke-online\internet-archive`；stem artifacts 固定 `DATA_DIR\karaoke-stems`；Python runtime 優先解析未打包的 `venv-stems\Scripts\python.exe`，找不到就回 `karaoke-stem-worker-unavailable`。FFmpeg directory 只從 server-side runtime 設定解析並先跑 `ffmpeg -version`，失敗回 `karaoke-stem-ffmpeg-unavailable`；兩者都不可由 client 指定或 fallback 到任意 PATH executable。

- [ ] **Step 4: shutdown cleanup**

Server shutdown 呼叫兩個 `dispose()`；只取消／清記憶體 job，不刪 studio、instrumental、vocals 或 manifest。

- [ ] **Step 5: 驗證**

```powershell
node tests/test_karaoke_catalog.js
node tests/test_karaoke_stem_separator.js
node tests/test_karaoke_remote.js
node tests/test_origin_guard.js
node --check web-app/server.js
```

Expected: PASS／exit 0。

**Task 5 stop:** API 完成，Host 尚未改。

## Task 6：Host 匯入、伴奏進度、原曲降級與點歌

**Files:**

- Modify: `web-app/views/host.ejs`
- Modify: `web-app/public/js/karaoke-host.js`
- Modify only if existing classes cannot express states: `web-app/public/css/style.css`
- Modify: `tests/test_karaoke_host.js`
- Modify only if projection regression requires it: `tests/test_karaoke_queue.js`

**Interfaces:**

- Consumes: Tasks 2／5 Admin APIs and existing `reserveSong(songId)`。
- Produces: explicit original／official instrumental／AI instrumental choice and true job state UI。

- [ ] **Step 1: 寫 Host RED tests**

固定測試：本機／線上分區；textContent rendering；安全來源連結；「當原曲匯入並分離」與「當官方伴奏匯入」由使用者明確選擇；busy disabled；job polling；`progress=null` 不顯示假百分比；成功預設 reserve instrumental；失敗保留「唱原曲／重試伴奏」；既有 local studio row 有「產生伴奏」；stale revision 不重下載或重分離。

- [ ] **Step 2: 確認 RED**

```powershell
node tests/test_karaoke_host.js
```

- [ ] **Step 3: 實作最小 UI state**

不增加前端 state manager。只保存當前 `searchId`、results、每個 result 的 import state 與每個 stem `jobId`。輪詢間隔 1000 ms；頁面卸載停止 timer，不取消 server worker。

- [ ] **Step 4: 接回既有 Queue**

instrumental ready 時只呼叫既有 `reserveSong(instrumentalSongId)`；使用者按「唱原曲」才 reserve studio。不得新增 Queue endpoint、直接改 Session 或在 Queue item 塞 path。

- [ ] **Step 5: 驗證**

```powershell
node tests/test_karaoke_host.js
node tests/test_karaoke_queue.js
node tests/test_karaoke_remote.js
node --check web-app/public/js/karaoke-host.js
```

Expected: PASS／exit 0。

**Task 6 stop:** Host 已能從音訊匯入走到伴奏／原曲點歌；尚未宣稱真模型品質或 installer 支援。

## Task 7：端到端契約、真模型品質與完整回歸

**Files:**

- Modify: `tests/run_all.js`
- Modify: `docs/CODEX_HANDOFF.md`
- Modify only if tests expose a shared-layer defect: responsible implementation file;不得順手重構。

**Interfaces:**

- Consumes: Tasks 1–6 complete pipeline。
- Produces: automated E2E evidence、real-worker evidence、quality table、packaging disposition and exact next prompt。

- [ ] **Step 1: 自動化 E2E contract**

以 fake Internet Archive response、small decodable studio fixture、fake stem worker 完成：

`search → trusted download → mpv validator stub → studio import → stem job → instrumental probe → derived SongLibrary import → Host reserve → Queue projection → Session PREPARING`

斷言 WebSocket／Remote 無 path、instrumental title／artist 沿用歌詞查詢、Queue Key 不重設、worker failure 只留下 studio、重試不重下載。

- [ ] **Step 2: 完整自動化 gate**

```powershell
node tests/test_karaoke_online_catalog.js
node tests/test_karaoke_stem_worker.js
node tests/test_karaoke_stem_separator.js
node tests/test_karaoke_catalog.js
node tests/test_karaoke_host.js
node tests/test_karaoke_queue.js
node tests/test_karaoke_session.js
node tests/test_karaoke_stage_mpv.js
node tests/test_karaoke_player_service.js
node tests/test_mpv_karaoke_player.js
node tests/test_karaoke_remote.js
node tests/test_origin_guard.js
venv\Scripts\python.exe tests\test_stem_separator_contract.py
cd web-app
npm.cmd test
cd ..
git diff --check
git status --short --branch
```

記錄 literal output 與 exit code；suite 數量以更新後 `tests/run_all.js` 實際輸出為準。

- [ ] **Step 3: 經使用者允許網路後做一筆真實合法 online runtime**

搜尋一筆允許授權的完整音訊，完成下載、studio import、path-free projection。Internet Archive 找不到適合日文歌曲不等於分離失敗；來源覆蓋率要單獨記錄。

- [ ] **Step 4: 真模型五類 A/B gate**

使用者提供有權處理的五類音訊：乾淨主唱、合唱、強混響、重型編曲、live。每首記錄：長度、backend、處理秒數、峰值 RAM／VRAM（可取得時）、vocal bleed、樂器損傷、可唱性 `可用／勉強／不可用`。不得以平均值隱藏單首失敗。

- [ ] **Step 5: 實際 Karaoke flow**

以 `/karaoke?player=mpv` 驗 original／instrumental、play、pause、seek、restart、Key -2／0／+2、字幕同步、ended／next。自動化、mpv decode 與實體喇叭人耳確認分列。

- [ ] **Step 6: installer disposition**

第一版不得自動把模型、stem Python runtime 或 FFmpeg 放進主 installer。只在以下全部有證據時另提 bundled-worker 計畫：套件／模型／FFmpeg 授權 notice 完整、安裝尺寸可接受、乾淨 Windows 可啟動、GPU／CPU fallback 行為清楚、更新與移除不刪使用者 stems。否則標示「開發／自架 worker 可用，安裝版未包含」。

- [ ] **Step 7: 更新 handoff**

記錄變更檔、保留 dirty files、套件／模型版本與 hash、所有命令／exit code、來源授權邊界、Remote／origin/path 證據、五首品質表、runtime 未驗證項與 release disposition。附完整下一階段提示詞後停止。

## 完成定義

只有下列全部成立才可說「線上音訊匯入、伴奏準備與點歌流程完成」：

- Internet Archive 搜尋／授權篩選／安全下載／mpv probe／studio import 全部通過。
- worker runtime 在目標 Windows 上以固定 `audio-separator`、FFmpeg 與模型完成真實兩軌輸出。
- instrumental 經 probe 後以穩定衍生 ID 匯入；vocals 不出現在一般 SongLibrary search／Queue。
- Host 清楚區分官方伴奏、AI 分離伴奏與原曲；失敗不冒充成功。
- 點歌只走既有 Queue，Stage／字幕／MPV Key 無第二套實作。
- Remote 對 online／stems routes 404；client／WebSocket／Remote 無 path 或 worker internals。
- 五類實際音訊有逐首品質與時間紀錄；不能只以 unit tests 宣稱伴奏品質。
- 最新 `npm.cmd test`、focused Node／Python tests 與 `git diff --check` 通過。
- handoff 清楚標示 installer 是否包含 worker；本功能完成仍不自動等於 Karaoke 1.0 release accepted。

## 停止條件

- Internet Archive API／metadata 與 Spec 不符，停止來源工作，不改成通用下載器。
- client 必須提交 URL／path／command／model path 才能完成，停止並重設 trust boundary。
- `audio-separator` 0.44.5 或固定模型在目標硬體無法穩定輸出，停止伴奏整合；保留 studio import，不以其他未驗模型臨時替換。
- 分離需要改 Queue schema、Stage ownership、字幕核心或 MPV Key，停止；這代表責任邊界設計錯誤。
- 需要把模型或 GPU runtime 直接塞進 installer 才能繼續，停止在自架 worker，另請使用者批准 packaging 計畫。
- 基線 suite 失敗或既有 dirty work 被破壞，立即停止，不自行 reset 或整理。

## 下一對話可直接貼上的執行提示詞

```text
請只在 C:\Users\USER\Desktop\project\Kanaric-karaoke-system-gap-closure、branch codex/karaoke-system-gap-closure 上，依照 C:\Users\USER\Desktop\project\Kanaric\docs\superpowers\specs\2026-08-30-karaoke-online-search-import-design.md 與 C:\Users\USER\Desktop\project\Kanaric\docs\superpowers\plans\2026-08-30-karaoke-online-search-import.md，執行「線上歌曲搜尋、合法音訊匯入、離線伴奏準備與既有 Queue 點歌」計畫。

先讀 AGENTS.md、兩份文件與專用 worktree docs\CODEX_HANDOFF.md；跑 git status --short --branch、git log -1 --oneline、git diff --stat、git diff --check 與目前 npm.cmd test。保留所有 tracked/untracked 變更。若 branch、HEAD、dirty state 或基線測試不符，立即停止。

依 Task 0–7 逐段執行，每段先寫最小 RED test，再做最小 GREEN。線上 provider 只用 Internet Archive；client 不得提交 URL、identifier、filename、path、worker command 或 model path。先安全下載並以 mpv probe 匯入 studio；官方 instrumental 直接匯入。若是 studio，使用獨立本機 Python worker、audio-separator 0.44.5 與 model_bs_roformer_ep_317_sdr_12.9755.ckpt 單工分離，instrumental probe 成功後以 studioSongId 加上固定字尾 :instrumental 匯入，vocals 只保存為 server-owned artifact。Host 預設 reserve instrumental；失敗時明示原曲已匯入但伴奏未完成。字幕與 Key 沿用既有 /api/lyrics/fetch、Queue 與 MPV pitch。

Task 3 安裝 dependency／下載模型／使用真實歌曲前必須取得我的明確批准；unit tests 一律用 fake worker。禁止 yt-dlp、網易下載、DRM、任意 URL import、provider framework、Tone.js、FastAPI、Docker、Mongo、雙播放器導唱、Queue schema、Player ownership、Remote Admin route，以及未經授權的 commit/push/PR/tag/Release。

完成時跑全部 focused tests、最新 npm.cmd test 與 git diff --check，更新 docs\CODEX_HANDOFF.md，分開記錄 Node、Python worker、模型、GPU/CPU、browser、Electron、mpv decode、實體喇叭和五類音訊品質證據。模型未打包前必須寫「自架 worker 可用，安裝版未包含」；本功能完成不得自動把 release disposition 從 NOT ACCEPTED 改成 ACCEPTED。
```
