/*
 * 卡拉OK字幕機模式 (/karaoke) 的頁面邏輯。
 *
 * 與首頁 (app.js) 的三個關鍵差別:
 *
 * 1. **沒有提前量。** 首頁的 WEB_APP_LYRICS_ADVANCE 是為了讓下一句早 0.25 秒上畫面,
 *    而字幕機的下一句本來就一直在畫面上。所以換行與填色吃同一個位置值,不必像首頁那樣
 *    在填色前再減回去 (那一減曾經漏掉,整首歌的填色比聽到的快了 0.25 秒都沒人發現)。
 * 2. **整份歌詞一次渲染,靠 class 切換顯示哪兩行。** karaokeSplit 把字元 span memo 在
 *    root.__kc 上且不還原,所以換行時重寫 innerHTML 必須手動作廢那個 memo (靈動島踩過)。
 *    每行各自一顆 .kline 就沒有這個問題,換行那一幀零重建。
 * 3. **播放列就是控制列。** 備選歌詞浮層是 position:absolute 錨在播放列裡那顆按鈕上,
 *    display:none 掉播放列會連它一起藏掉,所以這裡是把播放列改成自動隱藏的浮條 (CSS),
 *    這支只負責「滑鼠動了就露出、閒置就收回」。
 */
// **一定要等 DOMContentLoaded**:這一頁的 <script> 排在 include('footer') 之前,而
// window.onMediaMessage (WebSocket 的 handler 註冊點) 與 .player-bar 都在 footer 裡,
// 立即執行的話是 `onMediaMessage is not a function`,整支腳本死掉、頁面空白。
// app.js 也是同樣的理由把初始化放在 DOMContentLoaded 裡。
document.addEventListener('DOMContentLoaded', function () {
    const stage = document.getElementById('karaoke-stage');
    if (!stage) return;

    const linesEl = document.getElementById('karaoke-lines');
    const statusEl = document.getElementById('karaoke-status');
    const countEl = document.getElementById('karaoke-countin');
    const countSecEl = document.getElementById('karaoke-countin-sec');
    const degradedEl = document.getElementById('karaoke-degraded');
    const dots = Array.from(countEl.querySelectorAll('.kdot'));

    // ── 歌詞狀態 ──
    let lines = [];
    let unsynced = false;
    let curIdx = -1;
    let nextIdx = -1;
    let fetchSeq = 0;

    // ── 播放狀態 (自己內插,理由同 app.js:廣播一秒才一則) ──
    let pos = 0;
    let playing = false;
    let lastServerPos = -1;
    let lastFrame = performance.now();
    let syncOffset = 0;
    let title = '';
    let artist = '';
    let lyricsKey = '';

    const m0 = window.__initialMedia;
    if (m0 && m0.title) {
        pos = m0.position || 0;
        playing = !!m0.is_playing;
    }

    // ===================== 畫面 =====================

    function setStatus(text, icon) {
        if (!text) { statusEl.classList.add('hidden'); return; }
        statusEl.classList.remove('hidden');
        statusEl.innerHTML = '';
        const i = document.createElement('i');
        i.className = 'fa-solid ' + (icon || 'fa-microphone-lines');
        const p = document.createElement('p');
        p.textContent = text;
        statusEl.append(i, p);
    }

    function renderLines() {
        curIdx = -1;
        nextIdx = -1;
        // 歌詞本體是 server 產好的 HTML (含 <ruby>),furigana_inject.py 在分詞前就逃逸過了
        linesEl.innerHTML = lines.map((l, i) =>
            `<div class="kline" id="kline-${i}"><span>${l.text}</span></div>`).join('');
        // 沒有逐字時間的歌照樣進來,只是整句一起亮 —— 標一下,別讓人以為壞了
        degradedEl.classList.toggle('hidden', unsynced || !lines.length || lines.some(l => l.words));
    }

    function setLyrics(lrc) {
        const r = parseLrc(lrc);
        lines = r.lines;
        unsynced = r.unsynced;
        if (unsynced) {
            // 字幕機沒有時間軸就沒有意義:不硬撐,直接說清楚
            lines = [];
            linesEl.innerHTML = '';
            degradedEl.classList.add('hidden');
            setStatus('這份歌詞沒有時間軸,卡拉OK模式需要同步歌詞', 'fa-solid fa-clock');
            return;
        }
        renderLines();
        setStatus(lines.length ? '' : '找不到這首歌的歌詞', 'fa-solid fa-face-frown');
    }

    function paintCountdown(cd) {
        if (!cd) { countEl.classList.add('hidden'); return; }
        countEl.classList.remove('hidden');
        const lit = Math.ceil(cd.remain / cd.total * dots.length);
        dots.forEach((d, i) => d.classList.toggle('on', i < lit));
        countSecEl.textContent = cd.remain.toFixed(1) + 's';
    }

    function frame() {
        const now = performance.now();
        const dt = (now - lastFrame) / 1000;
        lastFrame = now;
        if (playing) pos += dt;

        if (lines.length) {
            const p = pos - syncOffset;
            const s = karaokeSlots(lines, p, curIdx);
            if (s.index !== curIdx || s.nextIndex !== nextIdx) {
                const oldCur = document.getElementById(`kline-${curIdx}`);
                if (oldCur) { oldCur.classList.remove('cur'); karaokeClear(oldCur); }
                const oldNext = document.getElementById(`kline-${nextIdx}`);
                if (oldNext) oldNext.classList.remove('next');
                curIdx = s.index;
                nextIdx = s.nextIndex;
                const cur = document.getElementById(`kline-${curIdx}`);
                if (cur) cur.classList.add('cur');
                const nxt = document.getElementById(`kline-${nextIdx}`);
                if (nxt) nxt.classList.add('next');
            }
            if (curIdx >= 0) {
                const el = document.getElementById(`kline-${curIdx}`);
                // 位置沒有提前量,所以這裡不必再減回去 (見檔頭第 1 點)
                if (el) karaokePaint(el.firstElementChild, lines[curIdx].words, (p - lines[curIdx].time) * 1000);
            }
            paintCountdown(s.countdown);
        } else {
            paintCountdown(null);
        }

        mvSync(pos, playing);
        requestAnimationFrame(frame);
    }

    // ===================== 播放狀態 =====================

    async function fetchLyrics(t, a) {
        const seq = ++fetchSeq;
        setStatus('正在搜尋歌詞...', 'fa-solid fa-spinner fa-spin');
        try {
            const r = await fetch(`/api/lyrics/fetch?title=${encodeURIComponent(t)}&artist=${encodeURIComponent(a || '')}`);
            if (seq !== fetchSeq) return;
            const d = r.ok ? await r.json() : null;
            if (seq !== fetchSeq) return;
            setLyrics(d && d.lyrics ? d.lyrics : '');
        } catch (e) {
            if (seq === fetchSeq) setStatus('歌詞抓取失敗', 'fa-solid fa-triangle-exclamation');
        }
    }

    function applyState(d) {
        playing = !!d.is_playing;

        if (d.title && d.position !== lastServerPos) {
            const diff = d.position - pos;
            // 換歌 / seek 就硬對齊,小漂移補一半 (同 app.js)
            if (Math.abs(diff) > 1.5 || d.title !== title) pos = d.position;
            else pos += diff * 0.5;
            lastServerPos = d.position;
        }

        if (d.title && (d.title !== title || d.artist !== artist)) {
            title = d.title;
            artist = d.artist || '';
            window.currentMediaDuration = d.duration || 0;
            lines = [];
            linesEl.innerHTML = '';
            degradedEl.classList.add('hidden');
            setStatus('正在搜尋歌詞...', 'fa-solid fa-spinner fa-spin');
            fetch(`/api/lyrics/offset?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`)
                .then(r => r.json()).then(o => { syncOffset = o.offset || 0; })
                .catch(() => { syncOffset = 0; });
            karaokeOnSongChange(title, artist);
        } else if (!d.title && title) {
            title = artist = lyricsKey = '';
            lines = [];
            linesEl.innerHTML = '';
            degradedEl.classList.add('hidden');
            setStatus('等待播放...');
            karaokeOnSongChange('', '');
        }
        if (d.duration !== undefined) window.currentMediaDuration = d.duration;

        // 名字定案 (iTunes 日文原名還原是非同步的) 才抓歌詞 —— 不等的話會用兩個不同的鍵
        // 各抓一次,第二次多半撞來源限流拿到空的,把已經抓對的歌詞蓋掉
        if (d.title && !d.resolving) {
            const key = `${d.title}|||${d.artist || ''}`;
            if (key !== lyricsKey) {
                lyricsKey = key;
                fetchLyrics(d.title, d.artist);
            }
        }
    }

    // 這一頁本身就是一個更大的歌詞畫面,置頂的靈動島是重複的而且會蓋在上面 —— 請 server
    // 把它收起來 (離開/重整/當掉時連線一斷,server 自己開回來,見 syncIslandHidden)。
    // **sticky**:連線斷掉重連後要重送,否則旗標歸零、島自己跑回來。
    window.sendMediaSocket({ type: 'karaoke_active', active: true }, 'karaoke');

    window.onMediaMessage((msg) => {
        if (msg.type === 'media_state' || msg.type === 'init') {
            if (msg.state) applyState(msg.state);
            return;
        }
        if (msg.type !== 'lyrics_updated' || !msg.lyrics) return;
        if (msg.title !== title || msg.artist !== artist) return;
        setLyrics(msg.lyrics);
    });

    // WebSocket 斷線時的保底 (同 app.js/common.js:連線活著就完全不打)
    setInterval(async () => {
        if (window.__mediaSocketAlive) return;
        try {
            const r = await fetch('/api/current-media', { cache: 'no-store' });
            if (r.ok) applyState(await r.json());
        } catch (e) {}
    }, 2000);

    // ===================== 控制列 (= 自動隱藏的播放列) =====================

    let barTimer = null;
    let overBar = false;

    function barPinned() {
        if (overBar) return true;
        const opt = document.getElementById('lyrics-options-modal');
        if (opt && opt.classList.contains('show')) return true;
        return !document.getElementById('karaoke-mv-picker').classList.contains('hidden');
    }

    function showBar() {
        document.body.classList.add('bar-visible');
        clearTimeout(barTimer);
        barTimer = setTimeout(() => {
            if (barPinned()) { showBar(); return; }
            document.body.classList.remove('bar-visible');
        }, 3000);
    }
    window.karaokeShowBar = showBar;

    document.addEventListener('mousemove', showBar);
    const bar = document.getElementById('player-bar');
    if (bar) {
        bar.addEventListener('mouseenter', () => { overBar = true; });
        bar.addEventListener('mouseleave', () => { overBar = false; });
    }
    showBar();

    // ESC 離開。浮層開著時先讓它們吃掉這一下 (備選歌詞的浮層自己有 ESC handler)
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const opt = document.getElementById('lyrics-options-modal');
        if (opt && opt.classList.contains('show')) return;
        if (!document.getElementById('karaoke-mv-picker').classList.contains('hidden')) {
            karaokeCloseMvPicker();
            return;
        }
        location.href = '/';
    });

    // 降級提示上那顆「找別份歌詞」:露出控制列再跑既有的備選歌詞流程 (lyrics-tools.js)
    window.karaokeFindLyrics = function () {
        showBar();
        searchLyricsOptions();
    };

    requestAnimationFrame(frame);
});
