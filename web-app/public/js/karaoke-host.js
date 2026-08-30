'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('karaoke-host');
    if (!root) return;

    const stateEl = document.getElementById('host-session-state');
    const titleEl = document.getElementById('host-song-title');
    const artistEl = document.getElementById('host-song-artist');
    const positionEl = document.getElementById('host-position');
    const sessionEl = document.getElementById('host-session-id');
    const keyEl = document.getElementById('host-key');
    const outputDeviceEl = document.getElementById('host-output-device');
    const outputStatusEl = document.getElementById('host-output-status');
    const outputRefreshButton = document.getElementById('host-output-refresh');
    const queueEl = document.getElementById('host-queue');
    const queueRevisionEl = document.getElementById('host-queue-revision');
    const diagnosticsEl = document.getElementById('host-diagnostics');
    const diagnosticsOverallEl = document.getElementById('host-diagnostics-overall');
    const remoteStatusEl = document.getElementById('host-remote-status');
    const remoteCodeEl = document.getElementById('host-remote-code');
    const remoteUrlEl = document.getElementById('host-remote-url');
    const remotePairButton = document.getElementById('host-remote-pair');
    const libraryAddButton = document.getElementById('host-library-add');
    const libraryPreviewEl = document.getElementById('host-library-preview');
    const libraryImportButton = document.getElementById('host-library-import');
    const libraryStatusEl = document.getElementById('host-library-status');
    const searchForm = document.getElementById('host-song-search');
    const searchInput = document.getElementById('host-song-search-input');
    const searchResultsEl = document.getElementById('host-search-results');
    const searchStatusEl = document.getElementById('host-search-status');
    let session = null;
    let libraryScan = null;
    let pendingReserveButton = null;
    let outputRequestCounter = 0;

    const labels = {
        IDLE: '待機中', PREPARING: '準備中', INTRO: '前奏', PLAYING: '播放中',
        PAUSED: '已暫停', ENDING: '結束中', RESULT: '結果', TRANSITION: '切歌中', ERROR: '錯誤',
    };
    const severityLabels = { ok: '正常', warn: '注意', error: '錯誤', info: '資訊' };
    const lyricStatusLabels = {
        ready: '有同步歌詞',
        unsynced: '無時間軸',
        malformed: '歌詞格式錯誤',
        'duration-mismatch': '時長不符',
        missing: '無歌詞',
        unknown: '未提供',
    };
    const issueLabels = {
        'metadata-incomplete': '需要修正歌手或歌名',
        'asset-conflict': '請選擇資產',
    };

    function text(element, value) {
        if (element) element.textContent = value;
    }

    function formatMs(value) {
        const seconds = Math.max(0, Math.round(Number(value) || 0) / 1000);
        return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    }

    function notify(message, error = false) {
        if (typeof window.showToast === 'function') {
            window.showToast(message, error ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-circle-info');
        }
    }

    function outputRequestId() {
        outputRequestCounter += 1;
        return `host-output-${Date.now()}-${outputRequestCounter}`;
    }

    function requestOutputDevices() {
        if (!outputDeviceEl) return;
        outputDeviceEl.disabled = true;
        text(outputStatusEl, '讀取輸出裝置…');
        window.sendMediaSocket({
            type: 'karaoke_player_output_devices', requestId: outputRequestId(),
        }, 'karaoke-host-output');
    }

    function renderOutput(output) {
        if (!output) return;
        const requested = output.requested || 'auto';
        const active = output.active || 'null';
        text(outputStatusEl, output.degraded
            ? `已回落：${active}` : `${requested} → ${active}${output.verified ? '（已驗證）' : '（未驗證）'}`);
        if (output.degraded && outputDeviceEl) outputDeviceEl.value = 'auto';
    }

    function setInlineStatus(element, message, error = false) {
        if (!element) return;
        element.textContent = message;
        element.className = `${element.id === 'host-library-status' || element.id === 'host-search-status'
            ? 'host-muted' : ''}${error ? ' host-status-error' : ''}`.trim();
    }

    async function readJsonResponse(response) {
        let payload = null;
        try { payload = await response.json(); } catch (error) { /* empty response */ }
        if (response.ok) return payload;
        const failure = new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
        failure.code = payload && payload.error;
        throw failure;
    }

    function lyricStatusLabel(status) {
        return lyricStatusLabels[status || 'unknown'] || String(status || '未提供');
    }

    function assetName(value) {
        return String(value || '').split(/[\\/]/).pop() || '檔案';
    }

    function textField(label, value, field) {
        const wrapper = document.createElement('label');
        wrapper.className = 'host-library-field';
        wrapper.textContent = label;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = value || '';
        input.dataset.field = field;
        wrapper.appendChild(input);
        return wrapper;
    }

    function assetField(label, kind, options) {
        const wrapper = document.createElement('label');
        wrapper.className = 'host-library-field';
        wrapper.textContent = label;
        const select = document.createElement('select');
        select.dataset.assetKind = kind;
        if (!options.length) {
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '無';
            select.appendChild(empty);
            select.disabled = true;
        } else {
            if (options.length > 1) {
                const choose = document.createElement('option');
                choose.value = '';
                choose.textContent = `選擇${label}`;
                select.appendChild(choose);
            }
            options.forEach((value, index) => {
                const option = document.createElement('option');
                option.value = String(index);
                option.textContent = assetName(value);
                select.appendChild(option);
            });
            if (options.length === 1) select.value = '0';
        }
        wrapper.appendChild(select);
        return wrapper;
    }

    function renderLibraryPreview(scan) {
        libraryPreviewEl.replaceChildren();
        libraryPreviewEl.hidden = false;
        const summary = document.createElement('p');
        summary.className = 'host-library-summary';
        summary.textContent = `掃描到 ${scan.candidates.length} 首可匯入歌曲`;
        libraryPreviewEl.appendChild(summary);
        if (scan.issues && scan.issues.length) {
            const issues = document.createElement('p');
            issues.className = 'host-library-issues';
            issues.textContent = scan.issues.map((issue) => issue.code || issue.message || issue).join('、');
            libraryPreviewEl.appendChild(issues);
        }
        scan.candidates.forEach((candidate) => {
            const row = document.createElement('div');
            row.className = `host-library-candidate${candidate.issues.length ? ' has-issues' : ''}`;
            row.dataset.candidateId = candidate.candidateId;

            const head = document.createElement('div');
            head.className = 'host-library-candidate-head';
            const includeLabel = document.createElement('label');
            const include = document.createElement('input');
            include.type = 'checkbox';
            include.checked = true;
            include.dataset.field = 'include';
            includeLabel.append(include, document.createTextNode('匯入'));
            const name = document.createElement('strong');
            name.textContent = candidate.basename;
            const state = document.createElement('span');
            state.textContent = candidate.issues.length
                ? candidate.issues.map((issue) => issueLabels[issue] || issue).join('、')
                : '可匯入';
            head.append(includeLabel, name, state);

            const fields = document.createElement('div');
            fields.className = 'host-library-fields';
            fields.append(
                textField('歌手', candidate.metadata.artist, 'artist'),
                textField('歌名', candidate.metadata.title, 'title'),
            );

            const assets = document.createElement('div');
            assets.className = 'host-library-assets';
            assets.append(
                assetField('音訊', 'audio', candidate.audioOptions),
                assetField('歌詞', 'lyric', candidate.lyricOptions),
                assetField('影片', 'video', candidate.videoOptions),
                assetField('封面', 'cover', candidate.coverOptions),
            );
            row.append(head, fields, assets);
            libraryPreviewEl.appendChild(row);
        });
        libraryImportButton.hidden = false;
        libraryImportButton.disabled = !scan.candidates.length;
    }

    function selectedAssetIndex(row, kind) {
        const select = row.querySelector(`[data-asset-kind="${kind}"]`);
        if (!select || select.value === '') return undefined;
        return Number(select.value);
    }

    function collectLibraryCorrections() {
        return [...libraryPreviewEl.querySelectorAll('.host-library-candidate')].map((row) => ({
            candidateId: row.dataset.candidateId,
            include: row.querySelector('[data-field="include"]').checked,
            artist: row.querySelector('[data-field="artist"]').value,
            title: row.querySelector('[data-field="title"]').value,
            audioIndex: selectedAssetIndex(row, 'audio'),
            lyricIndex: selectedAssetIndex(row, 'lyric'),
            videoIndex: selectedAssetIndex(row, 'video'),
            coverIndex: selectedAssetIndex(row, 'cover'),
        }));
    }

    async function searchLibrary(query) {
        setInlineStatus(searchStatusEl, '搜尋中…');
        try {
            const response = await fetch(`/api/karaoke/library/search?q=${encodeURIComponent(query || '')}`);
            const payload = await readJsonResponse(response);
            const items = Array.isArray(payload && payload.items) ? payload.items : [];
            renderSearchResults(items);
            setInlineStatus(searchStatusEl, `找到 ${items.length} 首`);
        } catch (error) {
            searchResultsEl.replaceChildren();
            setInlineStatus(searchStatusEl, `搜尋失敗：${error.code || error.message}`, true);
        }
    }

    function renderSearchResults(items) {
        searchResultsEl.replaceChildren();
        if (!items.length) {
            const empty = document.createElement('p');
            empty.className = 'host-empty';
            empty.textContent = '沒有符合的本機歌曲';
            searchResultsEl.appendChild(empty);
            return;
        }
        items.forEach((song) => {
            const row = document.createElement('div');
            row.className = 'host-search-row';
            const details = document.createElement('div');
            details.className = 'host-search-details';
            const title = document.createElement('strong');
            title.textContent = song.title || song.songId || '未知歌曲';
            const artist = document.createElement('span');
            artist.textContent = song.artist || '未知歌手';
            const lyrics = document.createElement('span');
            lyrics.textContent = `歌詞：${lyricStatusLabel(song.lyricsStatus || song.lyrics?.status)}`;
            details.append(title, artist, lyrics);

            const reserve = document.createElement('button');
            reserve.type = 'button';
            reserve.className = 'game-btn-primary host-song-reserve';
            reserve.textContent = '點歌';
            reserve.addEventListener('click', () => reserveSong(song, reserve));
            row.append(details, reserve);
            searchResultsEl.appendChild(row);
        });
    }

    function reserveSong(song, button) {
        if (pendingReserveButton) return;
        if (!session || !session.queue) {
            setInlineStatus(searchStatusEl, '尚未同步 Queue', true);
            return;
        }
        pendingReserveButton = button;
        button.disabled = true;
        setInlineStatus(searchStatusEl, '等待 Queue 回覆…');
        const reservationId = window.crypto && typeof window.crypto.randomUUID === 'function'
            ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        window.sendMediaSocket({
            type: 'karaoke_queue_reserve',
            expectedRevision: session.queue.revision,
            item: {
                reservationId,
                songId: song.songId,
                singer: 'Host',
                key: 0,
            },
        });
    }

    function renderQueue(queue) {
        const currentId = queue.currentQueueId || null;
        text(queueRevisionEl, `revision ${Number.isInteger(queue.revision) ? queue.revision : '—'}`);
        queueEl.replaceChildren();
        if (!Array.isArray(queue.items) || !queue.items.length) {
            const empty = document.createElement('p');
            empty.className = 'host-empty';
            empty.textContent = 'Queue 是空的';
            queueEl.appendChild(empty);
            return;
        }
        queue.items.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = `host-queue-row${item.queueId === currentId ? ' current' : ''}`;

            const details = document.createElement('div');
            details.className = 'host-queue-details';
            const name = document.createElement('strong');
            name.textContent = `${index + 1}. ${item.title || item.songId || '未知歌曲'}${item.artist ? ` · ${item.artist}` : ''}`;
            const singer = document.createElement('span');
            singer.textContent = item.singer ? `演唱者：${item.singer}` : '演唱者：—';
            const lyrics = document.createElement('span');
            lyrics.textContent = `歌詞：${lyricStatusLabel(item.lyricsStatus)}`;
            details.append(name, singer, lyrics);

            const meta = document.createElement('span');
            meta.className = 'host-queue-meta';
            meta.textContent = `${item.queueId === currentId ? '現在' : '等待'} · Key ${item.key ?? 0}`;

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'host-queue-remove';
            remove.textContent = '移除';
            remove.addEventListener('click', () => {
                window.sendMediaSocket({
                    type: 'karaoke_queue_remove',
                    queueId: item.queueId,
                    expectedRevision: queue.revision,
                }, 'karaoke-host-queue');
            });

            row.append(details, meta, remove);
            queueEl.appendChild(row);
        });
    }

    function renderSession(next) {
        if (!next) return;
        session = next;
        text(stateEl, labels[next.state] || next.state || '—');
        text(titleEl, next.song?.title || '尚未選擇歌曲');
        text(artistEl, next.song?.artist || '—');
        text(positionEl, `${formatMs(next.transport?.positionMs)} / ${formatMs(next.transport?.durationMs)}`);
        text(sessionEl, next.sessionId || '—');
        const current = next.queue?.items?.find((item) => item.queueId === next.queue.currentQueueId);
        text(keyEl, current ? String(current.key ?? 0) : '—');
        renderQueue(next.queue || { revision: 0, items: [] });
    }

    function renderDiagnostics(payload) {
        const diagnostics = payload && payload.diagnostics ? payload.diagnostics : payload;
        if (!diagnostics || !Array.isArray(diagnostics.items)) return;
        text(diagnosticsOverallEl, severityLabels[diagnostics.overall] || diagnostics.overall || '—');
        diagnosticsOverallEl.className = `host-severity severity-${diagnostics.overall || 'info'}`;
        diagnosticsEl.replaceChildren();
        diagnostics.items.forEach((check) => {
            const row = document.createElement('div');
            row.className = `host-diagnostic-row severity-${check.severity}`;
            const label = document.createElement('strong');
            label.textContent = check.label;
            const message = document.createElement('span');
            message.textContent = check.message;
            const severity = document.createElement('span');
            severity.className = 'host-diagnostic-severity';
            severity.textContent = severityLabels[check.severity] || check.severity;
            row.append(label, message, severity);
            diagnosticsEl.appendChild(row);
        });
    }

    function sendHostCommand(command) {
        window.sendMediaSocket({
            type: 'karaoke_host_command',
            command,
            sessionId: session && session.sessionId,
        }, 'karaoke-host-command');
    }

    if (libraryAddButton) {
        libraryAddButton.addEventListener('click', async () => {
            libraryAddButton.disabled = true;
            libraryImportButton.hidden = true;
            libraryImportButton.disabled = true;
            libraryPreviewEl.replaceChildren();
            libraryPreviewEl.hidden = true;
            libraryScan = null;
            setInlineStatus(libraryStatusEl, '掃描中…');
            try {
                const response = await fetch('/api/karaoke/library/scan', { method: 'POST' });
                if (response.status === 204) {
                    setInlineStatus(libraryStatusEl, '已取消掃描');
                    return;
                }
                libraryScan = await readJsonResponse(response);
                renderLibraryPreview(libraryScan);
                setInlineStatus(libraryStatusEl, '請檢查預覽');
            } catch (error) {
                setInlineStatus(libraryStatusEl, `掃描失敗：${error.code || error.message}`, true);
            } finally {
                libraryAddButton.disabled = false;
            }
        });
    }

    if (libraryImportButton) {
        libraryImportButton.addEventListener('click', async () => {
            if (!libraryScan) return;
            libraryImportButton.disabled = true;
            setInlineStatus(libraryStatusEl, '匯入中…');
            try {
                const response = await fetch(`/api/karaoke/library/scan/${encodeURIComponent(libraryScan.scanId)}/import`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ corrections: collectLibraryCorrections() }),
                });
                const result = await readJsonResponse(response);
                const rejected = Array.isArray(result && result.rejected) ? result.rejected.length : 0;
                setInlineStatus(libraryStatusEl, rejected
                    ? `已匯入 ${result.imported || 0} 首，${rejected} 首需要修正`
                    : `已匯入 ${result.imported || 0} 首`);
                libraryScan = null;
                libraryPreviewEl.replaceChildren();
                libraryPreviewEl.hidden = true;
                libraryImportButton.hidden = true;
                await searchLibrary(searchInput ? searchInput.value : '');
            } catch (error) {
                setInlineStatus(libraryStatusEl, `匯入失敗：${error.code || error.message}`, true);
                libraryImportButton.disabled = false;
            }
        });
    }

    if (searchForm) {
        searchForm.addEventListener('submit', (event) => {
            event.preventDefault();
            searchLibrary(searchInput ? searchInput.value : '');
        });
    }

    if (remotePairButton) {
        remotePairButton.addEventListener('click', () => {
            window.sendMediaSocket({ type: 'karaoke_remote_pairing_create' }, 'karaoke-remote-pairing');
        });
    }

    root.querySelectorAll('[data-host-command]').forEach((button) => {
        button.addEventListener('click', () => sendHostCommand(button.dataset.hostCommand));
    });

    window.onMediaMessage((message) => {
        if (message.type === 'karaoke_session' || message.type === 'karaoke_session_result'
            || message.type === 'karaoke_queue_result') {
            renderSession(message.state || message);
            if (message.type === 'karaoke_queue_result') {
                const reserveButton = pendingReserveButton;
                pendingReserveButton = null;
                if (reserveButton) reserveButton.disabled = false;
                if (message.accepted === false) {
                    if (message.reason === 'stale-queue-revision') {
                        setInlineStatus(searchStatusEl, 'Queue 已更新，請再點一次', true);
                    } else {
                        setInlineStatus(searchStatusEl, `點歌未套用：${message.reason || '未知原因'}`, true);
                    }
                } else if (reserveButton) {
                    setInlineStatus(searchStatusEl, '已加入 Queue');
                }
            } else if (message.accepted === false) notify(`操作未套用：${message.reason || '未知原因'}`, true);
            return;
        }
        if (message.type === 'karaoke_diagnostics') {
            renderDiagnostics(message);
            return;
        }
        if (message.type === 'karaoke_player_output_devices_result') {
            if (message.accepted === false) {
                text(outputStatusEl, `無法讀取：${message.reason || '未知原因'}`);
                return;
            }
            outputDeviceEl.replaceChildren();
            (message.devices || []).forEach((device) => {
                const option = document.createElement('option');
                option.value = device.name || '';
                option.textContent = device.description ? `${device.description} (${device.name})` : device.name;
                outputDeviceEl.appendChild(option);
            });
            outputDeviceEl.disabled = !message.devices?.length;
            renderOutput(message.state?.output);
            return;
        }
        if (message.type === 'karaoke_player_output_device_result') {
            if (message.accepted === false) {
                text(outputStatusEl, `切換失敗：${message.reason || '未知原因'}`);
                return;
            }
            renderOutput(message.output || message.state?.output);
            return;
        }
        if (message.type === 'karaoke_host_command_result' && message.accepted === false) {
            notify(`Stage 控制未送出：${message.reason || '未知原因'}`, true);
            return;
        }
        if (message.type === 'karaoke_remote_pairing') {
            if (message.accepted === false) {
                text(remoteStatusEl, message.reason || '無法配對');
                notify(`Remote 配對失敗：${message.reason || '未知原因'}`, true);
                return;
            }
            text(remoteStatusEl, `有效至 ${new Date(message.expiresAt).toLocaleTimeString()}`);
            text(remoteCodeEl, message.code);
            if (remoteUrlEl) {
                remoteUrlEl.textContent = message.remoteUrl;
                remoteUrlEl.href = message.remoteUrl;
            }
        }
    });

    window.sendMediaSocket({ type: 'karaoke_role', role: 'host' }, 'karaoke-host-role');
    if (outputRefreshButton) outputRefreshButton.addEventListener('click', requestOutputDevices);
    if (outputDeviceEl) outputDeviceEl.addEventListener('change', () => {
        window.sendMediaSocket({
            type: 'karaoke_player_output_device', requestId: outputRequestId(), deviceId: outputDeviceEl.value,
        }, 'karaoke-host-output');
    });
});
