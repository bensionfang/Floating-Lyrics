'use strict';

(function expose(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KaraokeDiagnostics = factory();
}(typeof self === 'object' ? self : this, function createDiagnostics() {
    const RANK = { info: 0, ok: 1, warn: 2, error: 3 };

    function item(id, label, severity, message) {
        return { id, label, severity, message };
    }

    function buildKaraokeDiagnostics(input = {}) {
        const session = input.session || {};
        const transport = session.transport || {};
        const output = input.output || {};
        const microphone = input.microphone || {};
        const video = input.video || {};
        const items = [];

        items.push(input.libraryReady === true
            ? item('library', '曲庫', 'ok', '曲庫可用')
            : item('library', '曲庫', input.libraryReady === false ? 'error' : 'warn',
                input.libraryReady === false ? '曲庫尚未就緒' : '曲庫狀態未知'));

        if (transport.error || session.state === 'ERROR') {
            const error = transport.error || {};
            items.push(item('player', '播放器', 'error', error.message || '播放器發生錯誤'));
        } else if (input.playerReady === false) {
            items.push(item('player', '播放器', 'error', '播放器不可用'));
        } else if (session.state === 'IDLE' || !session.state) {
            items.push(item('player', '播放器', 'warn', '尚未啟動歌曲'));
        } else {
            items.push(item('player', '播放器', 'ok', '播放器運作中'));
        }

        if (output.verified === true && output.supported !== false) {
            items.push(item('output', '輸出', 'ok', '輸出裝置已驗證'));
        } else if (output.supported === false) {
            items.push(item('output', '輸出', 'warn', '瀏覽器不支援輸出裝置選擇，使用預設輸出'));
        } else {
            items.push(item('output', '輸出', 'warn', '輸出裝置尚未驗證'));
        }

        items.push(Number(input.stageConnections) > 0
            ? item('stage', 'Stage', 'ok', 'Stage 已連線')
            : item('stage', 'Stage', 'warn', '尚未連線 Stage'));

        items.push(input.hostSocketAlive === true
            ? item('websocket', 'WebSocket', 'ok', 'Host 已連線')
            : item('websocket', 'WebSocket', 'warn', 'Host WebSocket 尚未連線'));

        items.push(input.remote && input.remote.enabled
            ? item('remote', 'Remote Gateway', 'ok', 'Remote Gateway 已啟用')
            : item('remote', 'Remote Gateway', 'info', '尚未啟用（P2.3）'));

        items.push(microphone.error
            ? item('microphone', '麥克風', 'warn', microphone.error)
            : microphone.enabled
                ? item('microphone', '麥克風', 'ok', '麥克風已啟用')
                : item('microphone', '麥克風', 'info', '可選功能，未啟用'));

        items.push(video.error
            ? item('video', '影片', 'warn', video.error)
            : video.enabled
                ? item('video', '影片', 'ok', '影片已啟用')
                : item('video', '影片', 'info', '可選功能，未啟用'));

        const overall = items.reduce((highest, current) =>
            RANK[current.severity] > RANK[highest] ? current.severity : highest, 'ok');
        return { overall, items };
    }

    return { buildKaraokeDiagnostics };
}));
