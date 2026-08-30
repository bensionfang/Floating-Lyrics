# Kanaric Karaoke — Current Handoff

Updated: 2026-08-30 (Task 7 of seven-gap closure)

This is the current source of truth for continuing work in the dedicated Karaoke worktree. Historical phase-by-phase narratives, completed approval prompts, repeated test logs, and superseded PLAN ONLY / NOT STARTED statements were removed on 2026-08-29.

The pre-cleanup 177,449-byte version is recoverable from:

C:\Users\USER\AppData\Local\Temp\Kanaric-CODEX_HANDOFF-before-cleanup-20260829.md

That temporary copy is an archive only. Do not use its old next prompts as current authorization.

## 1. Start here

- Worktree: C:\Users\USER\Desktop\project\Kanaric-karaoke-system-gap-closure
- Branch: codex/karaoke-system-gap-closure
- Current HEAD: 77f2f86 feat(karaoke): add local karaoke gap closure
- Branch remote: origin/codex/karaoke-system-gap-closure at the same commit
- Baseline: origin/main at 9bb97b61919572677f06ce8d9c5088515376cbde
- Original checkout: C:\Users\USER\Desktop\project\Kanaric
- The original checkout is read-only for this work. Do not modify, sync, merge, cherry-pick, or copy changes into it unless the user explicitly authorizes that separate action.
- Release disposition: NOT ACCEPTED
- No later Karaoke Search and Song Request task is currently defined or approved.

Task 0 fresh evidence for the seven-gap closure:

- `git status --short --branch`: exit 0; branch and all 12 tracked / 4 untracked protected files remain present.
- `git log -1 --oneline`: exit 0; `77f2f86 feat(karaoke): add local karaoke gap closure`.
- `git diff --stat`: exit 0; 12 tracked files, 556 insertions, 12 deletions; untracked files are not included.
- `git diff --check`: exit 0; only the known Git config permission and LF/CRLF warnings were emitted.
- `git rev-list --left-right --count HEAD...origin/main`: exit 0; `1 0`.
- `Test-Path` for `ws`, `sqlite3`, Electron package, `web-app/node_modules/electron/dist/electron.exe`, and the designated venv: all `True`, exit 0.
- Fixed ports 5790–5793 were all free, exit 0. Isolated evidence directory: `C:\Users\USER\AppData\Local\Temp\kanaric-seven-gap-closure-20260829`.
- The prior Electron-missing-binary note below is historical; this fresh check found the executable. It does not yet prove Electron startup or packaging.

Task 1 fresh evidence for the bundled mpv runtime:

- RED: `node tests/test_mpv_karaoke_player.js` exited 1 before the runtime manifest/diagnostic implementation; the expected missing `third_party/mpv/manifest.json` assertion failed.
- GREEN: `node tests/test_mpv_karaoke_player.js`: exit 0; focused mpv transport, key/output readback, EOF, process-error, manifest, and missing-runtime diagnostics passed.
- `node --check web-app/mpv-karaoke-player.js`: exit 0.
- `third_party/mpv/mpv.exe --version`: exit 0; `mpv v0.41.0-1012-ge8673660a`, general x86_64 Windows build.
- Real mpv IPC start/get-version/quit: exit 0; `mpv IPC start/quit: OK`; no mpv process remained afterward (process probe exit 1, no match).
- Runtime source is the pinned shinchiro x86_64 asset `mpv-x86_64-20260829-git-e8673660ab.7z`; downloaded archive SHA-256 matched `ca9b1a017105f02d66c1ddf7f43738b46df465015bbe060835d5a47964613fda`.
- Manifest records asset/version/architecture/release tag/upstream commit/source URL/archive SHA-256/license/runtime files. Task 1 is PASS for bundled runtime/path/diagnostic evidence; it is not playback, device, packaging, or release proof.

Task 2 fresh evidence for the single server-side Player Service:

- RED: `node tests/test_karaoke_player_service.js` exited 1 with `MODULE_NOT_FOUND` before `web-app/karaoke-player-service.js` existed.
- GREEN: `node tests/test_karaoke_player_service.js`: exit 0; fake-player contract passed song re-read/playability validation, one player instance, key, play/pause/seek, authoritative ended event propagation, stale-session rejection, invalid-key rejection, and dispose.
- `node --check web-app/karaoke-player-service.js`: exit 0.
- `node tests/test_mpv_karaoke_player.js`: exit 0 after the service addition; the focused mpv contract remains green.
- Task 2 is PASS for the isolated service contract only. Server/session/queue/Stage integration and real imported-song playback remain Task 3 evidence.

Task 3 fresh evidence for the Stage-only central mpv lifecycle:

- RED: the new Stage/service lifecycle test was initially unavailable before the controller and test were added; the focused implementation then passed.
- GREEN: `node tests/test_karaoke_stage_mpv.js`: exit 0; Queue current item enters PREPARING/INTRO, Stage loads by songId and key, play reaches PLAYING, one EOF skips to the next item, the final EOF reaches IDLE, and stale-session commands are rejected.
- GREEN: `node tests/test_karaoke_queue.js`: exit 0; `node tests/test_karaoke_remote.js`: exit 0 (`unit ok`, `live boundary OK`) after server reconciliation was gated to an actually connected `?player=mpv` Stage.
- GREEN: `node tests/test_karaoke_server_mpv_contract.js`: exit 0; `/karaoke?player=mpv`, Stage-only player command routing, service/controller wiring, and no `remote_admin` route are asserted.
- Fixed-port server smoke on isolated DB/settings paths: exit 0 through server startup; `http://localhost:5790` and Remote listener `0.0.0.0:5791` reported listening. The known Windows media-monitor WinError was emitted separately; the owned smoke processes were then stopped and no target node/mpv process remained.
- GREEN: `npm.cmd test` from `web-app`: exit 0; `[summary] 46/46 Node tests passed`. This includes the new service, lifecycle, and server-contract checks. It does not prove real imported-song playback, browser, Electron, or device output.
- Task 3 is PASS for the tested Stage/service/session/queue contract and localhost smoke only; central playback from a real imported file remains a separate runtime gate.

Task 4 fresh evidence for output selection and fallback:

- RED: `node tests/test_karaoke_player_service.js`: exit 1 before the output state merge; service snapshot remained `auto` after a selected-device readback.
- RED: `node tests/test_mpv_karaoke_player.js`: exit 1 before fallback; the selected-device removal assertion found no `set_property audio-device auto` request.
- RED: `node tests/test_karaoke_server_mpv_contract.js`: exit 1 before output routing/UI assertions were implemented.
- GREEN: `node tests/test_mpv_karaoke_player.js`: exit 0; mpv observes `current-ao`, reports requested/active/verified/degraded output state, uses `audio-fallback-to-null=yes`, and requests `audio-device=auto` when the selected route reports `null`.
- GREEN: `node tests/test_karaoke_player_service.js`: exit 0; device list, selected readback, degraded output event, key command, stale session, and disposal pass.
- GREEN: `node tests/test_karaoke_server_mpv_contract.js`: exit 0; Host-only output request/result routing, output device UI, `current-ao`, and no Remote Admin route are asserted.
- GREEN: `node tests/test_karaoke_diagnostics.js`: exit 0; existing diagnostic severity contract remains green.
- `node --check web-app/server.js; node --check web-app/karaoke-player-service.js; node --check web-app/karaoke-stage-controller.js`: exit 0.
- Task 4 is PASS for focused code/contract evidence only. No physical default output, second output, unplug, human-audible fallback, or two-device readback evidence exists yet.

Task 5 fresh evidence for the real imported-song and browser/LAN path:

- RED: `node tests/test_song_library.js`: exit 1; Host search rows had no `lyricsStatus` field (`undefined` instead of `ready`).
- GREEN: `node tests/test_song_library.js`: exit 0 after the shared SongLibrary search projection added `lyricsStatus`; `node tests/test_karaoke_catalog.js`: exit 0 after the Catalog search projection preserved it; both syntax checks exited 0.
- `node tests/test_karaoke_real_sequence.js`: exit 0 with isolated DB and public MP3/M4A fixtures; actual imported MP3 and M4A loaded in the central Stage mpv player, reached PLAYING, paused after 30 seconds, resumed, sought to 4097ms, restarted, natural EOF advanced to the next Queue item, and stop plus next reached final IDLE. The JSON evidence reported `sequence: PASS`.
- Fixed-port live HTTP/Remote checks: exit 0; Admin Host was available on `127.0.0.1:5790`, Remote page was available on LAN `172.20.10.13:5791`, Remote WebSocket accepted the existing allowlisted commands, and catalog/settings/restore/db-clear Admin routes returned 404 on the Remote port.
- Browser DOM evidence: central `http://localhost:5790/karaoke?player=mpv`, Host `/host`, and LAN Remote `/mobile/karaoke/` loaded. Host search for `Task 5` rendered both imported fixtures with `歌詞：有同步歌詞`; when Stage was stopped, Host output refresh truthfully rendered `無法讀取：stage-mpv-required`.
- Task 5 is PASS for isolated real imported central playback, Queue/Host projection, and desktop-browser/LAN HTTP/WebSocket evidence. It is not physical-phone, human-audible output, unplug fallback, packaged Electron, or deployment proof. The test fixtures remain outside the repository in the isolated evidence directory; their public sample sources were [Sample MP3](https://samplelib.com/sample-mp3.html) and [Sample M4A](https://samplefile.com/samples/audio/m4a/).

Task 6 fresh evidence for the v1.1.0 Electron package:

- RED: `node tests/test_karaoke_packaging.js`: exit 1 while package version was `1.0.0`; subsequent RED runs caught omitted `media-timing.js`, `karaoke-library-scan.js`, `karaoke-catalog.js`, and the missing `npmRebuild: false` packaging setting.
- GREEN: `node tests/test_karaoke_packaging.js`: exit 0; package/lock version is `1.1.0`, Player Service/Stage Controller and all server-local modules are listed, `../third_party` is an extra resource, native rebuild is disabled because the existing sqlite3 N-API binary passed packaged smoke, GitHub publish metadata is present, and signing remains disabled.
- `npm.cmd run dist`: initial exit 1 because the dedicated worktree did not have the old `..\\venv` relative path. The minimum package-script fallback now uses a worktree-local venv when present, otherwise the designated `C:\Users\USER\Desktop\project\Kanaric\\venv`.
- After the fallback, `npm.cmd run build:py`: exit 1 under the default sandbox because PyInstaller could not create `build-py`; the escalated `npm.cmd run dist`: exit 1 at electron-builder's sqlite3 native rebuild with `EPERM` unlink. No user data was discarded.
- `npx.cmd electron-builder --config.npmRebuild=false --publish never`: exit 0; generated the first local 1.1.0 artifact. Its packaged smoke exposed omitted local server modules, which were added by the RED/GREEN packaging contract.
- Final candidate build `npm.cmd run dist -- --publish never --config.directories.output=release-final-3`: exit 0 with the package's `npmRebuild: false` setting. `release-final-3` contains `Kanaric-Setup-1.1.0.exe`, blockmap, `latest.yml`, unpacked app, all required asar modules, and the complete bundled mpv runtime. `node tests/test_karaoke_release_artifact.js` with `KANARIC_RELEASE_DIR=release-final-3`: exit 0; latest.yml version, filename, size, SHA-512, asar contents, and mpv resources match.
- Isolated packaged smoke of `release-final-3\\win-unpacked\\Kanaric.exe`: exit 0; packaged Host returned HTTP 200 on port 5792 and `/api/update-check` returned current `1.1.0` with `autoUpdate: true`. Updater stderr reported `No published versions on GitHub`, because no public Release has been created.
- Task 6 is PARTIAL: local artifact and unpacked startup are proven, but a clean installer install/uninstall, imported playback inside the installed app, and updater download/install remain unverified. The earlier `release`, `release-final`, and `release-final-2` generated evidence directories were preserved; the latest candidate is `release-final-3`.

Task 7 fresh final verification:

- `npm.cmd test`: first final run exit 1 at the existing Remote live-boundary exact-object assertion after `lyricsStatus` was correctly added; the minimum expected projection was updated, `node tests/test_karaoke_remote.js` then exited 0, and the rerun `npm.cmd test` exited 0 with `[summary] 46/46 Node tests passed`.
- Python tests were run serially with isolated writable `LYRICS_DB_PATH` and `LYRICS_SETTINGS_PATH`; `test_fallback_parallel.py`, `test_furigana_hint.py`, `test_pick_session.py`, `test_pick_song.py`, `test_recover_titles.py`, `test_utaten.py`, and `test_yt_search.py` each exited 0.
- Final focused serial run exited 0 for `test_mpv_karaoke_player.js`, `test_karaoke_player_service.js`, `test_karaoke_stage_mpv.js`, `test_karaoke_server_mpv_contract.js`, `test_karaoke_diagnostics.js`, `test_song_library.js`, `test_karaoke_catalog.js`, `test_karaoke_remote.js`, `test_karaoke_packaging.js`, and `test_karaoke_release_artifact.js`.
- `node tests/test_karaoke_real_sequence.js`: exit 0 on the second isolated server run; JSON again reported `sequence: PASS` for real imported MP3/M4A load, play, 30-second pause/resume, 4097ms seek, restart, EOF→next, stop→IDLE.
- Final syntax command covering server, Electron, mpv, Player Service, Stage Controller, SongLibrary, Catalog, Host JS, and all new focused tests: exit 0. `node tests/test_origin_guard.js`: exit 0 with all origin/WebSocket cases passing.
- Final `git diff --check`: exit 0 with only known Git config permission and LF/CRLF warning output. Final branch/status checks exited 0; ports 5790–5793 were free after verification and no packaged Kanaric process remained.
- Task 7 is BLOCKED for direct seven-gate completion by unavailable physical phone/two-output hardware, no clean installer test environment, and the explicit prohibition on the agent creating a public GitHub Release. Release disposition remains NOT ACCEPTED.

Read these before future implementation:

1. C:\Users\USER\Desktop\project\Kanaric\AGENTS.md
2. C:\Users\USER\Desktop\project\Kanaric\docs\superpowers\plans\2026-08-26-karaoke-system-gap-closure.md
3. C:\Users\USER\Desktop\project\Kanaric\docs\superpowers\plans\2026-08-28-karaoke-system-gap-closure-runtime-release-closure.md
4. C:\Users\USER\Desktop\project\Kanaric-karaoke-system-gap-closure\docs\superpowers\plans\2026-08-29-karaoke-search-song-request.md
5. This file.

The plans define intended scope. This handoff records actual current implementation and evidence. Neither document alone proves runtime or release acceptance.

## 2. Current repository state

Latest read-only inspection:

- git status --short --branch: exit 0
- git log -3 --oneline --decorate: exit 0
- git rev-parse origin/main: exit 0
- git diff --stat: exit 0
- Tracked diff summary: 19 files changed, 967 insertions, 31 deletions
- Untracked files are not included in that diff stat.
- docs/CODEX_HANDOFF.md is ignored by .gitignore and is not tracked.

Tracked modified files:

- tests/run_all.js
- tests/test_karaoke_host.js
- tests/test_karaoke_queue.js
- tests/test_karaoke_remote.js
- tests/test_karaoke_session.js
- tests/test_mpv_karaoke_player.js
- tests/test_song_library.js
- web-app/electron.js
- web-app/karaoke-queue.js
- web-app/mpv-karaoke-player.js
- web-app/package-lock.json
- web-app/package.json
- web-app/public/css/style.css
- web-app/public/js/karaoke-host.js
- web-app/public/js/karaoke-mode.js
- web-app/remote-mobile.html
- web-app/server.js
- web-app/song-library.js
- web-app/views/host.ejs

Untracked files:

- tests/test_karaoke_catalog.js
- tests/test_karaoke_library_scan.js
- tests/test_karaoke_packaging.js
- tests/test_karaoke_player_service.js
- tests/test_karaoke_real_sequence.js
- tests/test_karaoke_release_artifact.js
- tests/test_karaoke_server_mpv_contract.js
- tests/test_karaoke_stage_mpv.js
- third_party/mpv/
- web-app/karaoke-catalog.js
- web-app/karaoke-library-scan.js
- web-app/karaoke-player-service.js
- web-app/karaoke-stage-controller.js
- web-app/release-final/
- web-app/release-final-2/
- web-app/release-final-3/

Preserve every listed file. The changes belong to completed Tasks 1–7 available evidence and include pre-existing work in files that were extended by later tasks.

Expected Git warnings:

- unable to access C:\Users\USER\.config\git\ignore: Permission denied
- LF will be replaced by CRLF the next time Git touches some modified files

These warnings have not caused a diff-check failure. If Git reports dubious ownership, use only a single-command -c safe.directory form. Never change global Git configuration.

## 3. Completed implementation

### Committed Karaoke gap-closure base

Commit 77f2f86 contains the earlier local Karaoke gap-closure implementation. The detailed P0/P1/P2 design and runtime closure criteria remain in the two dated plans listed above.

Important retained architecture:

- Stage is the sole player owner.
- KaraokeSession is the canonical lifecycle and transport projection.
- KaraokeQueue is the canonical revisioned reservation queue.
- SongLibrary is the canonical local-song metadata and asset store.
- Host and Remote project the same Session and Queue state.
- Remote uses its dedicated authenticated listener and does not expose Admin routes.
- Music Mode, Dynamic Island, existing lyric APIs, external-player behavior, microphone, Pitch, and scoring remain separate boundaries.

### Karaoke Search and Song Request Tasks 1–6

All six tasks in 2026-08-29-karaoke-search-song-request.md are complete.

| Task | Current result | Main files |
| --- | --- | --- |
| 1. Folder scanner | Recursively groups same-folder, same-basename supported Karaoke assets; skips symlinks; reports conflicts and incomplete metadata without mutating source files. | web-app/karaoke-library-scan.js, tests/test_karaoke_library_scan.js, tests/run_all.js |
| 2. Catalog service | Adds in-memory scan TTL, stored-candidate-only import, SongLibrary delegation, path-free search projection, and three localhost Admin routes. | web-app/karaoke-catalog.js, tests/test_karaoke_catalog.js, web-app/server.js, tests/run_all.js |
| 3. Electron chooser | Adds only global.selectKaraokeLibraryFolder(), backed by the native openDirectory dialog with cancel and shutdown guards. Plain Node remains unavailable. | web-app/electron.js, tests/test_karaoke_catalog.js |
| 4. Queue labels | Projects title, artist, and lyricsStatus through the existing SongLibrary resolver without schema duplication. | web-app/karaoke-queue.js, tests/test_karaoke_queue.js, tests/test_karaoke_remote.js |
| 5. Host UI | Adds folder scan/import preview, local search, path-free result rendering, revisioned reserve, projected Queue rows, and stale-revision feedback. | web-app/views/host.ejs, web-app/public/js/karaoke-host.js, web-app/public/css/style.css, tests/test_karaoke_host.js |
| 6. Remote UI and isolation | Reuses authenticated search, reserve, queue_view, and key commands; verifies canonical result shape, first-reservation Session reconciliation, Queue labels, and Remote-port 404 isolation for Admin catalog routes. | web-app/remote-mobile.html, tests/test_karaoke_remote.js, tests/test_karaoke_session.js |

Current end-to-end contract at the Queue/Session seam:

choose local folder → preview same-basename assets → import SongLibrary → search on Host or authenticated Remote → reserve canonical Queue → reconcile first Queue item into KaraokeSession PREPARING

The implementation does not add:

- a second Song Library, Queue, metadata store, Remote protocol, or search endpoint;
- online song search;
- arbitrary client filesystem paths;
- client-supplied import paths;
- title or artist columns in Queue storage;
- Music Mode or player ownership changes;
- package, dependency, database-schema, deployment, or release changes.

## 4. Security and data boundaries

- Admin catalog routes exist only on the loopback Admin listener:
  - POST /api/karaoke/library/scan
  - POST /api/karaoke/library/scan/:scanId/import
  - GET /api/karaoke/library/search?q=...
- The Remote listener exposes only its existing mobile page, pairing, health, and WebSocket surfaces. Catalog scan/import/search routes return 404 on the Remote port.
- Remote commands remain allowlisted and authenticated. Search, reserve, queue_view, and key reuse the existing command path.
- Search results project only songId, title, artist, album, variant, and lyricsStatus; no filesystem paths.
- Queue/UI projections do not expose filesystem paths.
- Import accepts scanId, candidateId, corrected metadata, and selected asset indexes. It resolves files only from the server-held scan record.
- Tests use temporary databases/directories. Do not write the formal DB/settings or mutate user songs for verification.
- Do not disable Electron web security, enable Node integration, expose a generic filesystem picker, or widen the Remote listener.

## 5. Latest verification record

The latest complete verification was run after Task 7 on 2026-08-30. All commands below ran in the dedicated worktree unless another directory is shown.

Focused serial tests:

| Command | Result | Exit |
| --- | --- | ---: |
| node tests/test_karaoke_library_scan.js | test_karaoke_library_scan: PASS | 0 |
| node tests/test_karaoke_catalog.js | test_karaoke_catalog: PASS | 0 |
| node tests/test_song_library.js | test_song_library: PASS | 0 |
| node tests/test_karaoke_queue.js | test_karaoke_queue: OK | 0 |
| node tests/test_karaoke_session.js | test_karaoke_session: OK | 0 |
| node tests/test_karaoke_host.js | test_karaoke_host: OK | 0 |
| node tests/test_karaoke_remote.js | unit ok; live boundary OK | 0 |
| node tests/test_origin_guard.js | 全部通過 | 0 |
| node tests/test_karaoke_packaging.js | test_karaoke_packaging: PASS | 0 |
| node tests/test_karaoke_release_artifact.js | v1.1.0 artifact/latest.yml/asar/mpv checks passed | 0 |

Additional gates:

| Command | Result | Exit |
| --- | --- | ---: |
| node --check tests/test_karaoke_remote.js | no output | 0 |
| node --check tests/test_karaoke_session.js | no output | 0 |
| npm.cmd test from web-app | 46/46 Node tests passed | 0 |
| git -c safe.directory=C:/Users/USER/Desktop/project/Kanaric-karaoke-system-gap-closure -C C:/Users/USER/Desktop/project/Kanaric-karaoke-system-gap-closure diff --check | no whitespace errors; warning-only output | 0 |

Historical Search and Song Request Task 6 TDD record:

- Initial RED: node tests/test_karaoke_remote.js exited 1 because the Remote Queue label did not project item.lyricsStatus.
- Minimum fix: web-app/remote-mobile.html added the existing projected lyricsStatus to the Queue label.
- GREEN: the same Remote test exited 0 with unit and live-boundary success.

Do not carry forward older test counts such as 41/41, 42/42, or 43/43. The latest recorded full suite is 46/46.

## 6. Evidence boundaries

| Boundary | Current evidence | Status |
| --- | --- | --- |
| Node contracts | Scanner, Catalog, SongLibrary, Queue, Session, Host, Remote, origin guard, mpv focused contract, syntax, and full suite passed. | PASS |
| Live HTTP/WebSocket | Isolated temporary Admin/Remote server tests passed catalog search, Remote route rejection, pairing/authentication, search, queue view, stale revision, reserve, key, controls, replay, reconnect, and invalidation. | PASS for tested localhost flow |
| Host browser DOM | Task 5 loaded Host and searched the two isolated imported fixtures; both rendered `歌詞：有同步歌詞`, and the stopped-Stage output error rendered as a typed message. | PASS for tested desktop DOM flow |
| Remote browser DOM | Task 5 loaded the LAN Remote page in a browser and live WebSocket/route checks passed; this was not a physical phone. | PARTIAL |
| Electron folder chooser | Controlled Node harness verified the exact native dialog call, selection, cancel, and shutdown guard. A real native picker interaction was not run for Tasks 1–7. | PARTIAL |
| Existing development Electron/local player | Task 5 proved the new catalog-to-central-mpv path with real imported MP3/M4A fixtures through the development server. It does not prove packaged runtime or speaker routing. | PASS for dev central path |
| Windows media monitor | Sandbox test subprocesses may emit WinError -2147023836. Earlier actual-user evidence successfully observed Spotify GSMTC; Task 7 reproduced the environment error and kept it separate from playback evidence. | Environment-dependent |
| Physical phone/LAN | LAN page and WebSocket were checked from the desktop environment; no physical phone was available for direct interaction. | PARTIAL |
| Physical playback/devices | Task 5/7 real dev sequence proved central playback from imported MP3/M4A and transport lifecycle. No physical default/non-default speaker route, unplug/fallback heard on hardware, microphone, or loopback proof was produced. | PARTIAL |
| Dependencies/data | Existing dependencies were reused; package metadata was intentionally updated to v1.1.0; all test DB/settings and audio fixtures were isolated from formal user data. | PASS for tested scope |
| Packaging/deployment/release | Task 6 produced a local `release-final-3` installer, blockmap, latest.yml, asar/resource checks, and unpacked HTTP smoke. No clean installer install/uninstall, public deployment, signing, tag, release upload, or updater download/install was run. | PARTIAL |

The full npm suite may print the known sandbox WinRT media-monitor traceback while still exiting 0. That output is not playback evidence and must remain separate from Node test success.

## 7. Release disposition

Release remains NOT ACCEPTED.

Tasks 1–5 of the seven-gap plan currently prove the bundled runtime, service/lifecycle contracts, Stage-only wiring, output fallback code contracts, and the development central path with real imported audio. Task 6 adds a local packaged candidate and unpacked HTTP smoke. They do not prove:

- physical default or non-default speaker routing;
- output removal/fallback heard on hardware;
- a real Remote phone/LAN flow;
- clean installer install/uninstall and installed-app imported playback;
- deployment, signing, updater download/install, public publication, or release readiness.

Do not claim Karaoke 1.0, hardware readiness, deployment, or release completion from the 46/46 Node result or localhost HTTP/WebSocket tests.

## 8. Working rules for the next agent

- Preserve every current dirty/untracked file.
- Start with git status --short --branch, git log -1 --oneline, and git diff --stat.
- Use focused RED tests before behavior changes.
- Run fixed-port tests serially.
- Keep Node, live HTTP/WebSocket, browser, Electron, dependency, physical-device, packaging, deployment, and release evidence separate.
- Do not install dependencies, modify formal data, or perform reset, clean, checkout, restore, stash, merge, rebase, cherry-pick, commit, push, PR, tag, release, or delete operations unless the user explicitly authorizes the specific action.
- Do not broaden the approved seven-gap plan into microphone, scoring, or unrelated product work.
- Update this handoff with current facts only. Replace superseded facts instead of appending another complete historical phase transcript.

## 9. Next action

The user explicitly approved `docs\superpowers\plans\2026-08-29-karaoke-seven-gap-closure.md`. Tasks 0–5 are complete for their available development/browser/LAN evidence; Task 6 has a local packaged candidate and Task 7 has completed all available checks. The next minimum approved scope is physical validation with one phone and two output devices, followed by clean installer install/uninstall and the user personally performing the public v1.1.0 Release/updater test. Release remains NOT ACCEPTED until every seven-gap gate is directly PASS.

## 10. Suggested skills

For future sessions:

- superpowers:using-superpowers — choose the applicable process before acting.
- superpowers:executing-plans — when the user explicitly approves a dated plan or task.
- superpowers:test-driven-development — for any behavior change or bug fix.
- superpowers:verification-before-completion — before claiming a phase complete.
- verify — for Kanaric browser/Electron UI verification.
- handoff — when compacting this file again; keep only current state and reference plans instead of duplicating them.
