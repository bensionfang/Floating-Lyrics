/*
 * 卡拉OK模式的 MV 背景。
 *
 * **影片一律靜音,聲音永遠來自播放器。** 這支只負責畫面:把使用者挑的 YouTube 影片鋪滿
 * 背景,並跟著真實播放位置對齊。歌詞位置照舊來自媒體監控,現有管線一行都沒改。
 *
 * 為什麼是 IFrame API 而不是純 `<iframe src=".../embed/ID">`:純嵌入不用載外部腳本,
 * 但**沒有 seekTo** —— MV 有前奏/對白,長度與音源對不上,不能 seek 就等於沒做。
 * 這是全 app 唯一的外部腳本 (其餘第三方資源一律自架在 public/vendor/),所以**只在使用者
 * 真的挑了 MV 之後才動態插入**:沒挑 MV 或斷網時整頁行為與沒有這個功能時完全一樣。
 */
// 等 DOMContentLoaded 的理由同 karaoke-mode.js:這支 <script> 排在頁面本體之前,
// 立即執行的話 #kbar-tools / #kbar-mv-row 還不存在,🎞 永遠插不上去 (而且沒有錯誤訊息)。
document.addEventListener('DOMContentLoaded', function () {
    const holder = document.getElementById('karaoke-mv');
    if (!holder) return;

    const IFRAME_API = 'https://www.youtube.com/iframe_api';
    const DRIFT_SEC = 0.5;        // 差這麼多才 seek —— 每幀 seek 會讓影片一直重新緩衝
    const SEEK_COOLDOWN_MS = 800; // seek 之後 getCurrentTime 要一會兒才跟上,期間不准再送
    const SYNC_EVERY_MS = 250;    // 對齊檢查的頻率 (rAF 每幀問一次太浪費)

    let player = null;
    let ready = false;
    let curVideo = '';
    let mvOffset = 0;
    let seekGuardUntil = 0;
    let lastSyncAt = 0;
    let song = { title: '', artist: '' };

    // ── 外部腳本:延後載入,而且只載一次 ──
    let apiState = 'none';   // none → loading → ready
    const waiting = [];
    function ensureApi(cb) {
        if (apiState === 'ready') return cb();
        waiting.push(cb);
        if (apiState === 'loading') return;
        apiState = 'loading';
        window.onYouTubeIframeAPIReady = () => {
            apiState = 'ready';
            waiting.splice(0).forEach((f) => f());
        };
        const s = document.createElement('script');
        s.src = IFRAME_API;
        s.onerror = () => {
            apiState = 'none';
            waiting.length = 0;
            showToast('載入 YouTube 播放器失敗 (需要網路)', 'fa-solid fa-triangle-exclamation');
        };
        document.head.appendChild(s);
    }

    // ── 播放器 ──
    window.mvLoad = function (videoId, offsetSec) {
        if (!videoId) return mvClear();
        mvOffset = Number(offsetSec) || 0;
        curVideo = videoId;
        ensureApi(() => {
            if (curVideo !== videoId) return;   // 這期間又換歌/換影片了
            document.body.classList.add('karaoke-has-mv');
            if (player && ready) { player.loadVideoById(videoId); return; }
            const host = document.createElement('div');
            holder.innerHTML = '';
            holder.appendChild(host);
            player = new YT.Player(host, {
                videoId,
                playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0,
                              // cc_load_policy: 0 是「照使用者的偏好」,**不是關掉** ——
                              // 無痕視窗 (沒有任何帳號偏好) 實測照樣會出現字幕,所以留著它
                              // 不代表擋得住。**不要改用 `unloadModule('captions')` /
                              // `setOption` 去關**:實測會把播放器弄到 UNSTARTED 卡死
                              // (畫面全黑、連手動 playVideo() 都叫不動,而且沒有錯誤訊息)。
                              // 用 CSS 把字幕那一帶裁掉也試過了,代價太大、已經拿掉 (見 style.css
                              // 的 #karaoke-mv)。現在的立場是「字幕就讓它出現,擋到就換一支」。
                              modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3,
                              cc_load_policy: 0 },
                events: {
                    onReady: (e) => { ready = true; e.target.mute(); e.target.playVideo(); },
                    // 嵌入被擋 / 影片消失:歌詞完全不受影響,只是換一支
                    onError: () => {
                        showToast('這支影片不能嵌入播放,換一支吧', 'fa-solid fa-circle-exclamation');
                        mvClear();
                        karaokeOpenMvPicker();
                    },
                },
            });
        });
    };

    window.mvClear = function () {
        curVideo = '';
        ready = false;
        document.body.classList.remove('karaoke-has-mv');
        try { if (player && player.destroy) player.destroy(); } catch (e) {}
        player = null;
        holder.innerHTML = '';
        updateBarButtons();
    };

    // pos 是**真實播放位置** (沒有歌詞的偏移):影片對齊的是音樂,不是歌詞
    window.mvSync = function (pos, playing) {
        if (!player || !ready) return;
        const now = Date.now();
        if (now - lastSyncAt < SYNC_EVERY_MS) return;
        lastSyncAt = now;
        try {
            const state = player.getPlayerState();
            const want = pos + mvOffset;
            if (!playing || want < 0) {
                if (state === YT.PlayerState.PLAYING) player.pauseVideo();
                return;
            }
            if (state !== YT.PlayerState.PLAYING) player.playVideo();
            if (now < seekGuardUntil) return;
            if (Math.abs(player.getCurrentTime() - want) > DRIFT_SEC) {
                player.seekTo(want, true);
                seekGuardUntil = now + SEEK_COOLDOWN_MS;
            }
        } catch (e) {}
    };

    window.mvResetSync = function () {
        lastSyncAt = 0;
        seekGuardUntil = 0;
    };

    window.mvSetOffset = function (sec) {
        mvOffset = Math.round(sec * 10) / 10;
        seekGuardUntil = 0;   // 讓下一次 sync 立刻跳過去,不然要等漂移累積
        saveChoice(curVideo, mvOffset);   // 值就顯示在控制列上,不必再吐 toast
    };

    // ── 每首歌一支 ──
    window.karaokeOnSongChange = async function (title, artist) {
        song = { title: title || '', artist: artist || '' };
        mvClear();
        renderList([]);   // 上一首的候選清單不能留著,不然挑到的是別首歌的 MV
        if (!song.title) { updateBarButtons(); return; }
        try {
            const r = await fetch(`/api/mv?title=${encodeURIComponent(song.title)}&artist=${encodeURIComponent(song.artist)}`);
            const d = r.ok ? await r.json() : {};
            if (song.title !== title || song.artist !== (artist || '')) return;
            if (d && d.videoId) { mvLoad(d.videoId, d.offset); updateBarButtons(); return; }
            if (d && d.videoId === '') return;   // 使用者按過「取消 MV」,那是明確的選擇
            await autoPick(title, artist);
        } catch (e) {}
        updateBarButtons();
    };

    /**
     * 沒挑過的歌自動套用搜尋結果的第一支,並**把它存進 `mv_choices`** ——
     * 所以每首歌一輩子只搜一次 YouTube (換歌就搜一次是找封鎖)。
     *
     * **第一支不是 `ok` (翻唱/演唱會/鋼琴/カラオケ) 就不套**:搜尋結果本來就混著那些,
     * 而唱到一半畫面完全不對比純黑底更糟。那時使用者從控制列的 🎞 自己挑一支,
     * 挑了就蓋掉,跟備選歌詞是同一套手勢。
     */
    async function autoPick(title, artist) {
        const dur = Math.round(window.currentMediaDuration || 0);
        const r = await fetch(`/api/mv/search?title=${encodeURIComponent(title)}`
            + `&artist=${encodeURIComponent(artist || '')}&duration=${dur}`);
        const d = r.ok ? await r.json() : null;
        const top = d && d.results && d.results[0];
        if (!top || !top.ok) return;
        if (song.title !== title || song.artist !== (artist || '')) return;   // 這期間換歌了
        saveChoice(top.videoId, 0);
        mvLoad(top.videoId, 0);
        showToast(`自動套用 MV:${top.title}`, 'fa-solid fa-film');
    }

    function saveChoice(videoId, offset) {
        return fetch('/api/mv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: song.title, artist: song.artist, videoId, offset }),
        }).catch(() => {});
    }

    // ── 挑選面板 ──
    const picker = document.getElementById('karaoke-mv-picker');
    const mask = document.getElementById('karaoke-mv-mask');
    const listEl = document.getElementById('kmv-list');

    function fmtDur(s) {
        if (!s) return '';
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function renderList(items, note) {
        if (note) { listEl.innerHTML = `<div class="kmv-empty">${note}</div>`; return; }
        if (!items.length) { listEl.innerHTML = ''; return; }
        listEl.innerHTML = '';
        for (const it of items) {
            const row = document.createElement('div');
            row.className = 'kmv-item' + (it.videoId === curVideo ? ' on' : '');
            row.onclick = () => karaokePickMv(it.videoId);
            const img = document.createElement('img');
            img.src = it.thumb || '';
            img.alt = '';
            img.loading = 'lazy';
            const meta = document.createElement('div');
            meta.className = 'kmv-meta';
            const name = document.createElement('div');
            name.className = 'kmv-name';
            name.textContent = it.title;          // 外部字串,一律用 textContent 不用 innerHTML
            const sub = document.createElement('div');
            sub.className = 'kmv-sub';
            sub.textContent = [it.channel, fmtDur(it.durationSec)].filter(Boolean).join(' · ');
            // 標題/頻道帶著翻唱、演唱會、鋼琴、カラオケ 那類字眼的標一下 (自動套用也會避開它們,
            // 見 yt_search.py 的 `ok`)。**只是提示不是禁止** —— 使用者要挑照樣挑得到。
            if (it.ok === false) {
                const tag = document.createElement('span');
                tag.className = 'kmv-tag';
                tag.textContent = '可能不是原版';
                sub.append(' ', tag);
            }
            meta.append(name, sub);
            row.append(img, meta);
            listEl.appendChild(row);
        }
    }

    window.karaokeOpenMvPicker = async function () {
        if (!song.title) { showToast('還沒有正在播放的歌', 'fa-solid fa-circle-info'); return; }
        picker.classList.remove('hidden');
        mask.classList.remove('hidden');
        document.getElementById('kmv-title').textContent = `MV 背景 — ${song.title}`;
        karaokeShowBar();
        renderList([], '搜尋中...');
        try {
            const dur = Math.round(window.currentMediaDuration || 0);
            const r = await fetch(`/api/mv/search?title=${encodeURIComponent(song.title)}`
                + `&artist=${encodeURIComponent(song.artist)}&duration=${dur}`);
            const d = r.ok ? await r.json() : null;
            const items = (d && d.results) || [];
            renderList(items, items.length ? '' : '找不到影片');
        } catch (e) {
            renderList([], '搜尋失敗');
        }
    };

    window.karaokeCloseMvPicker = function () {
        picker.classList.add('hidden');
        mask.classList.add('hidden');
    };

    window.karaokePickMv = function (videoId) {
        mvOffset = 0;
        saveChoice(videoId, 0);
        mvLoad(videoId, 0);
        updateBarButtons();
        karaokeCloseMvPicker();
    };

    window.karaokeClearMv = function () {
        saveChoice('', 0);
        mvClear();
        karaokeCloseMvPicker();
    };

    // ── 控制列:🎞 插進 #kbar-tools,快/慢那列是頁面本體的 #kbar-mv-row ──
    const offsetRow = document.getElementById('kbar-mv-row');
    const offsetVal = document.getElementById('kbar-mv-offset');
    function updateBarButtons() {
        if (!offsetRow) return;
        offsetRow.classList.toggle('hidden', !curVideo);
        // 顯示的是**延遲** (跟字幕那列同義),所以是 -mvOffset:mvOffset 大 = 影片跳得更前面 = 更早
        offsetVal.textContent = `${(-mvOffset).toFixed(1)} s`;
    }

    // delta 是延遲的增減:− (慢了,催快) → 延遲變小 → mvOffset 變大。0 = 歸零
    window.karaokeAdjustMvOffset = function (delta) {
        mvSetOffset(delta ? mvOffset - delta : 0);
        updateBarButtons();
    };

    const right = document.getElementById('kbar-tools');
    if (right) {
        const mvBtn = document.createElement('button');
        mvBtn.className = 'ctrl-btn';
        mvBtn.type = 'button';
        mvBtn.dataset.tip = 'MV 背景';
        mvBtn.innerHTML = '<i class="fa-solid fa-film"></i>';
        mvBtn.onclick = () => karaokeOpenMvPicker();
        right.prepend(mvBtn);
    }
});
