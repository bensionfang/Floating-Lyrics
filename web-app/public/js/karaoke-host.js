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
    const queueEl = document.getElementById('host-queue');
    const queueRevisionEl = document.getElementById('host-queue-revision');
    const diagnosticsEl = document.getElementById('host-diagnostics');
    const diagnosticsOverallEl = document.getElementById('host-diagnostics-overall');
    const remoteStatusEl = document.getElementById('host-remote-status');
    const remoteCodeEl = document.getElementById('host-remote-code');
    const remoteUrlEl = document.getElementById('host-remote-url');
    const remotePairButton = document.getElementById('host-remote-pair');
    let session = null;

    const labels = {
        IDLE: '待機中', PREPARING: '準備中', INTRO: '前奏', PLAYING: '播放中',
        PAUSED: '已暫停', ENDING: '結束中', RESULT: '結果', TRANSITION: '切歌中', ERROR: '錯誤',
    };
    const severityLabels = { ok: '正常', warn: '注意', error: '錯誤', info: '資訊' };

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
            name.textContent = `${index + 1}. ${item.songId || '未知歌曲'}`;
            const singer = document.createElement('span');
            singer.textContent = item.singer ? `演唱者：${item.singer}` : '演唱者：—';
            details.append(name, singer);

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
            if (message.accepted === false) notify(`操作未套用：${message.reason || '未知原因'}`, true);
            return;
        }
        if (message.type === 'karaoke_diagnostics') {
            renderDiagnostics(message);
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
});
