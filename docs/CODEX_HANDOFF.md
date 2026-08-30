# Kanaric YouTube Karaoke handoff

## 接手目標

請在另一台電腦從這個分支繼續實作已核准計畫；先收尾 Task 2 的獨立審查，再只執行 Task 3。不要擴張到 Task 4 以後。

## Git / 工作位置

- Repository: `https://github.com/bensionfang/Kanaric.git`
- Branch: `codex/youtube-karaoke-extension`
- Base: `origin/main@9bb97b6`
- Worktree: `C:\Users\USER\Desktop\project\Kanaric-youtube-karaoke-extension`
- 本次尚未 commit；請先確認 checkout 與 dirty state，再繼續。
- 原始 checkout `C:\Users\USER\Desktop\project\Kanaric` 與舊 gap-closure worktree 未修改，勿 reset/clean/stash/merge/rebase。

## 已完成

### Task 0

- 建立基線與本檔。
- 舊核心測試 `node tests/test_karaoke_mode.js` 通過。
- origin/search/Python 測試受新 worktree 缺少既有依賴或 venv 影響，不能當成產品通過。

### Task 1：協定、暫存 Queue、同源 WebSocket

- `web-app/youtube-karaoke-protocol.js`
- `web-app/public/js/youtube-karaoke-queue.js`
- `web-app/server.js`
- `tests/test_youtube_karaoke_protocol.js`
- `tests/test_youtube_karaoke_queue.js`
- `tests/test_youtube_karaoke_server.js`

目前正式契約：

```js
// App -> Extension
{ type: 'youtube_karaoke_command', commandId, action: 'load', videoId }
{ type: 'youtube_karaoke_command', commandId, action: 'play' }
{ type: 'youtube_karaoke_command', commandId, action: 'pause' }
{ type: 'youtube_karaoke_command', commandId, action: 'seek', positionMs }
{ type: 'youtube_karaoke_command', commandId, action: 'set_key', semitones }

// Extension -> page
{
  type: 'youtube_karaoke_state', revision, videoId, title, channel,
  state: 'idle'|'loading'|'playing'|'paused'|'buffering'|'ad'|'ended'|'error',
  positionMs, durationMs, keySemitones,
  error: null | { code, message }
}
```

- Queue 為純記憶體，`createYouTubeKaraokeQueue()` 支援 `add/remove/move/start/advance(expectedRevision)/clear/snapshot`。
- token 使用 data directory 的 `youtube-karaoke-token`；WebSocket 只接受精確 Chrome extension origin，extension socket 不進一般 global broadcast。
- Task 1 focused tests 通過；origin guard 的既有測試仍受新 worktree 缺 `web-app/node_modules/ws` 路徑影響。

### Task 2：MV3 YouTube source / tab / state projection

- `browser-extension/src/service-worker.js`
- `browser-extension/src/youtube-content.js`
- `browser-extension/src/popup.js`
- `browser-extension/src/manifest.json`
- `browser-extension/build.mjs`
- `browser-extension/tests/*.test.js`

已包含：

- 只允許 YouTube host 與 localhost backend，無 `<all_urls>`、遠端 JS 或 `eval`。
- YouTube tab 只使用 extension 自己建立並保存的 tab ID；load 位置以 `t=` 保留，tab 完成後重送 pending load。
- content projection 可辨識 loading、playing、paused、buffering、ad、ended、unavailable、age restriction、sign-in required。
- WebSocket lifecycle 會區分 connecting / connected / error / disconnected；popup 不在 socket 尚未 open 時謊報 connected。
- Task 2 extension tests：`11/11 passed`。
- `npm.cmd --prefix browser-extension run build`：exit 0。
- dist `service-worker.js` syntax check：exit 0。
- 連續重建後 dist 六個檔案 SHA256 一致；禁用項掃描無命中。

## 審查狀態

Task 2 第一輪獨立審查發現四個行為缺口，已完成修正；修正後補了 popup lifecycle 與 sign-in classifier 的 RED → GREEN 測試，目前仍需另一個 agent 做最後 scoped re-review。不要把「測試通過」寫成「審查已通過」。

## 硬邊界

- 現在只收尾 Task 2，再做 Task 3。
- Task 3 只做 tabCapture/offscreen/SoundTouchJS/manual Key。
- Key UI 只允許整數 `-6..6`，tempo 永遠 `1.0`；不得用 playbackRate 假裝升降 Key。
- 不做 automatic Key recommendation、range calibration、batch analysis、vocal separation、Spotify、scoring、raw audio/PCM/FFT storage、persistent playlist、mobile/multi-user Queue。
- 不可把瀏覽器擴充功能自動安裝到使用者瀏覽器，不載遠端 JS。

## 新電腦接手提示詞

```text
請接續 Kanaric YouTube Karaoke 分支，工作位置固定為 C:\Users\USER\Desktop\project\Kanaric-youtube-karaoke-extension，branch codex/youtube-karaoke-extension。

先讀 AGENTS.md、docs\superpowers\plans\2026-08-31-youtube-karaoke-extension-pitch-history.md、docs\CODEX_HANDOFF.md，確認 git status 與 HEAD。不要 reset/clean/stash/merge/rebase，也不要碰原始 checkout。先執行：

  npm.cmd test
  npm.cmd --prefix browser-extension run build
  node --check browser-extension/dist/service-worker.js

Task 2 的實作已完成但最後 scoped re-review 尚未完成。請先針對目前 Task 2 變更做一次獨立 review，範圍只看：popup lifecycle 測試是否真的涵蓋 connecting/connected/error/disconnected，以及 youtube-content 的 sign-in-required / age-restricted classifier 是否有明確測試；確認沒有新的 Critical/Important finding。若 review PASS，記錄到 .superpowers/sdd/2026-08-31-youtube-karaoke-extension-pitch-history/progress.md 與 task-2-report.md。

然後只執行完整計畫的 Task 3，不要執行 Task 4 以後：

1. 先寫 Key range、換歌歸零、offscreen acknowledgment、worklet failure/bypass、synthetic DSP 的 RED tests。
2. 建立 offscreen document、tabCapture user-gesture flow、SoundTouchJS AudioWorklet graph 與 set_key readback。
3. Key 只允許 -6..6 整數，tempo 永遠 1.0；不得用 playbackRate 假裝變調。
4. worklet 失敗時要明確回報 `pitch-processing-unavailable`，且未處理音訊必須 bypass，不可無聲。
5. 所有 processor/code 都本機打包；加入 MPL-2.0 授權與 THIRD_PARTY_NOTICES；不得載遠端 JS。
6. 以 synthetic 440 Hz 驗證內部 DSP +12 接近 880 Hz、-12 接近 220 Hz；產品 UI 仍只開 -6..6。
7. 跑完整 extension tests/build/license scan，記錄 command、exit code、測試總數與限制。

更新 docs\CODEX_HANDOFF.md，附上完整 Task 4 prompt；Task 3 完成後立即停止。除非另有明確授權，不要 commit/push/PR/release。
```

## Suggested skills

- `superpowers:verification-before-completion`：完成 Task 2 review 或 Task 3 前後做證據驗證。
- `superpowers:test-driven-development`：先 RED 再 GREEN 實作 DSP / offscreen 邊界。
- `superpowers:subagent-driven-development`：按計畫任務逐項交由 implementer/reviewer 收斂。
- `superpowers:executing-plans`：按完整計畫執行並保留每任務 checkpoint。
- `ponytail:ponytail`：維持最小實作，避免提前做 deferred features。
