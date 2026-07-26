// 猜歌小遊戲 (邊聽邊猜)。
// 題目就是「現在正在播的那首歌」—— 這一頁負責藏答案、出選項、計分,切歌走既有的
// /api/media-control。遊戲狀態全在這裡,server 不記錄局面 (只記每題結果)。
(function () {
  const $ = (id) => document.getElementById(id);
  const el = {
    setup: $('game-setup'), play: $('game-play'), over: $('game-over'),
    modes: $('game-modes'), start: $('game-start'), again: $('game-again'),
    progress: $('game-progress'), score: $('game-score'), lives: $('game-lives'), timer: $('game-timer'),
    streak: $('game-streak'),
    stage: $('game-stage'), options: $('game-options'), reveal: $('game-reveal'),
    log: $('game-log'), track: $('game-track'), trackFill: $('game-track-fill'),
    trackPos: $('game-track-pos'), trackDur: $('game-track-dur'),
    skip: $('game-skip'), quit: $('game-quit'),
    resultScore: $('game-result-score'), resultLine: $('game-result-line'), wrong: $('game-wrong'),
    missing: $('game-missing'),
    remode: $('game-remode'), starts: $('game-starts'),
    artName: $('game-artist-name'), artLoad: $('game-artist-load'),
    artStatus: $('game-artist-status'), artClear: $('game-artist-clear'),
    artPick: $('game-artist-pick'), artCard: $('game-artist-card'), artImg: $('game-artist-img'),
    artTitle: $('game-artist-title'), artCount: $('game-artist-count'),
    artRecent: $('game-artist-recent'),
  };

  const TOTAL = 10;           // 「10 題一局」的題數
  const LIVES = 3;            // 「三次錯就結束」的命數
  const REVEAL_MS = 3000;     // 揭曉後自動切下一題
  // 全曲目玩法:連續跳過幾首考過的就放棄。清單沒涵蓋全部曲目時 (最常見的情況) 會一直跳,
  // 不設上限就是無止境地按下一首。曲目多的歌手後期本來就會連跳好幾首,所以門檻要寬
  const FULL_SKIP_LIMIT = 25;
  const MISSING_SHOWN = 24;   // 結算只列前幾首沒考到的 (114 首全列會把畫面吃光)
  // 計分公式在 game-score.js (基本 1 + 速度加成 + 連勝加成,沒有扣分項)

  let mode = '10';
  let poolTracks = [];        // 指定歌手的曲目,干擾選項的第一順位;沒指定就是空陣列
  let startMode = 'intro';    // 從哪裡開始播:前奏 (0 秒) / 隨機時間
  let lastKey = '';           // 最後一次看到的播放狀態 (不管有沒有在遊戲中)
  const S = {
    running: false, q: 0, score: 0, lives: LIVES, wrong: [], streak: 0, best: 0, log: [],
    answer: null, key: '', answered: true,
    askedAt: 0, waitFrom: 0, timerId: null, revealId: null,
    // 全曲目玩法:考過的歌 (titleKey) 與連續跳過次數
    asked: new Set(), skips: 0,
  };

  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, (m) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]
    ));
  }
  const keyOf = (m) => (m.artist || '') + '|||' + (m.title || '');
  // 分數是小數 (速度分吃實際秒數),但整數就別多印一個 .0
  const fmtPts = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const post = (url, body) => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const control = (action) => post('/api/media-control', { action });

  // ── WebSocket:唯一的換歌通知,同時也是「遊戲進行中」旗標的載體。
  // 旗標綁在這條連線上 —— 關頁/重整就自動解除,server 不必做逾時 (見 server.js isGameActive)
  let ws = null;
  function connect() {
    ws = new WebSocket(`ws://${location.host}`);
    ws.onopen = () => { if (S.running) sendActive(true); };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'init' || msg.type === 'media_state') onMediaState(msg.state || {});
    };
    ws.onclose = () => setTimeout(connect, 2000);
    ws.onerror = () => ws.close();
  }
  function sendActive(active) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'game_active', active }));
  }
  connect();

  // ── 出題 ──
  function onMediaState(m) {
    // 開局時要靠它擋掉「還沒切歌」的那首 (見 startGame)。**只記非空的** ——
    // 沒有播放來源時監控照樣推空 payload,記進去等於把開局要擋的那首忘掉
    if (m.title) lastKey = keyOf(m);
    // 進度條的基準點。廣播是換狀態才來 (不是每 0.1 秒),所以畫的時候要自己內插
    if (typeof m.position === 'number') {
      track = { at: Date.now(), base: m.position, dur: Number(m.duration) || 0, playing: !!m.is_playing };
      paintTrack();
    }
    if (!S.running || S.answered === false) return;   // 作答中不理會播放狀態
    if (S.answer || !m.title || m.resolving) return;
    // resolving = 歌名還沒定案 (iTunes 日文原名還原中)。不等它的話答案會在作答途中被換掉。
    // 通常要求「與上一題不同」才算換歌成功,但清單只有一兩首時 next 會切回同一首 ——
    // 等超過 8 秒就接受重複,否則畫面永遠停在「切歌中」
    if (keyOf(m) === S.key && Date.now() - S.waitFrom < 8000) return;
    // 全曲目:考過的歌播到就自己跳掉,不佔一題。判定用 titleKey ——「春泥棒」與
    // 「春泥棒 (Live)」算同一首,否則同一首歌會因為版本不同被考兩次
    if (mode === 'full' && S.asked.has(titleKey(m))) {
      if (++S.skips > FULL_SKIP_LIMIT) {
        showToast('清單裡好像沒有沒考過的歌了', 'fa-solid fa-circle-info', 4000);
        return endGame();
      }
      S.waitFrom = Date.now();
      S.key = keyOf(m);
      control('next').catch(() => {});
      return;
    }
    S.skips = 0;
    askQuestion(m);
  }

  async function askQuestion(m) {
    S.answer = { artist: m.artist, title: m.title };
    S.key = keyOf(m);
    // 出過就算考過 (答錯也算),不然答錯的歌會一直回來,永遠跑不完全曲目。
    // 鍵是 titleKey 不是 songKey —— 連動曲的歌手是聯名寫法,比歌手會永遠對不上
    S.asked.add(titleKey(m));
    seekForQuestion(m);
    el.reveal.classList.add('hidden');
    el.stage.classList.remove('revealed');

    let d;
    try {
      // pool = 指定歌手的曲目。四個選項全同一位歌手,才不能靠「歌手不對」刷掉。
      // original_* 一起送:iTunes 給的是還原前後可能不同的寫法,不排掉答案會以兩種寫法同時出現
      const r = await post('/api/game/options', {
        title: m.title, artist: m.artist,
        original_title: m.original_title || '', original_artist: m.original_artist || '',
        pool: poolTracks,
      });
      d = await r.json();
    } catch (e) { d = { error: 'fetch_failed' }; }

    if (!d.options) {
      // 題庫湊不出 4 個選項就沒得玩,直接收攤比出一題殘缺的題目好
      showToast(d.error === 'not_enough'
        ? '題庫不足,先聽一陣子歌再來玩' : '取得選項失敗', 'fa-solid fa-triangle-exclamation', 4000);
      return endGame();
    }

    el.options.innerHTML = d.options.map((o) => `
      <button class="game-option" data-key="${escapeHtml(keyOf(o))}">
        <span class="game-option-title">${escapeHtml(o.title)}</span>
      </button>`).join('');
    el.options.querySelectorAll('.game-option').forEach((b) => {
      b.addEventListener('click', () => answer(b.dataset.key, b));
    });

    S.answered = false;
    S.askedAt = Date.now();
    updateHud();
    startTimer();
  }

  // 前奏 = 回到 0 秒 (next 之後多半已經在 0,但使用者手動切歌進來就不一定);
  // 隨機時間 = 10%~80% 之間隨機跳一次。沒有時長 (瀏覽器來源) 就不動,亂 seek 只會跳到歌尾
  function seekForQuestion(m) {
    const dur = Number(m.duration) || 0;
    if (startMode === 'random' && dur > 30) {
      const pos = Math.round(dur * (0.1 + Math.random() * 0.7));
      post('/api/seek', { position: pos }).catch(() => {});
    } else if (startMode === 'intro' && (m.position || 0) > 3) {
      post('/api/seek', { position: 0 }).catch(() => {});
    }
  }

  function answer(chosenKey, btn) {
    if (S.answered) return;
    S.answered = true;
    stopTimer();
    const correct = chosenKey === S.key;
    const elapsed = Date.now() - S.askedAt;
    el.timer.textContent = `${fmtSec(elapsed)} 秒`;
    S.streak = correct ? S.streak + 1 : 0;
    S.best = Math.max(S.best, S.streak);
    const sc = correct ? scoreFor(elapsed, S.streak) : null;
    const gained = sc ? sc.total : 0;
    // 累加也要收一次小數 —— 不收的話 0.1 + 0.2 那種浮點誤差會一路長出 17.400000000000002
    S.score = round1(S.score + gained);
    if (!correct) {
      S.lives--;
      S.wrong.push(S.answer);
    }

    el.options.querySelectorAll('.game-option').forEach((b) => {
      b.disabled = true;
      if (b.dataset.key === S.key) b.classList.add('is-answer');
      else if (b === btn) b.classList.add('is-wrong');
    });
    el.stage.classList.add('revealed');
    el.reveal.innerHTML = `
      <div class="game-reveal-mark ${correct ? 'ok' : 'no'}">
        <i class="fa-solid ${correct ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
        ${correct ? `答對 +${fmtPts(gained)}` : (btn ? '答錯' : '跳過')}
      </div>
      ${sc ? `<div class="game-reveal-breakdown">基本 +1${
        sc.speed ? ` ・ ${fmtSec(elapsed)} 秒 +${fmtPts(sc.speed)}` : ''}${
        sc.streak ? ` ・ 連勝 ${S.streak} +${sc.streak}` : ''}</div>` : ''}
      <div class="game-reveal-song">${escapeHtml(S.answer.title)}<span>${escapeHtml(S.answer.artist)}</span></div>`;
    el.reveal.classList.remove('hidden');
    S.log.push({ n: S.q + 1, correct, sec: fmtSec(elapsed), title: S.answer.title, gained });
    renderLog();
    updateHud();

    post('/api/game/result', {
      artist: S.answer.artist, title: S.answer.title,
      correct, hints: 0, answer_ms: elapsed, mode,
    }).catch(() => {});

    S.q++;
    if ((mode === '10' && S.q >= TOTAL) || (mode === 'lives' && S.lives <= 0)
        || (mode === 'full' && !remainingTracks().length)) {
      S.revealId = setTimeout(endGame, REVEAL_MS);
    } else {
      S.revealId = setTimeout(nextQuestion, REVEAL_MS);
    }
  }

  function nextQuestion() {
    clearTimeout(S.revealId);
    S.answer = null;            // 空著就是「等下一首歌」,onMediaState 會接手
    S.answered = true;
    S.waitFrom = Date.now();
    el.options.innerHTML = '<div class="game-waiting"><i class="fa-solid fa-forward"></i> 切歌中…</div>';
    el.reveal.classList.add('hidden');
    el.stage.classList.remove('revealed');
    updateHud();
    control('next').catch(() => {});
  }

  el.skip.addEventListener('click', () => { if (!S.answered) answer('', null); });
  el.quit.addEventListener('click', endGame);

  // ── 全曲目玩法 ──
  // 分母只算歌手本人的曲目:標了 `extra` 的是 search 補回來的連動曲,**只當干擾選項** ——
  // 那批沒有 lookup 乾淨 (客串、合輯漏網),算進來覆蓋率永遠差幾首。
  // 還有,**比對的是 iTunes 的曲目清單而不是使用者的播放清單** —— 兩邊本來就對不齊
  // (清單缺歌、單曲版與專輯版),所以 100% 常常到不了。因此結算一定要把「沒考到的」列出來,
  // 而且隨時可以按結束收攤,不能設計成「跑不完就沒有成績」
  const mainTracks = () => poolTracks.filter((t) => !t.extra);
  const remainingTracks = () => mainTracks().filter((t) => !S.asked.has(titleKey(t)));

  // ── 計分板 ──
  function updateHud() {
    if (mode === 'full') {
      const total = mainTracks().length;
      el.progress.textContent = `${total - remainingTracks().length} / ${total} 首`;
    } else {
      el.progress.textContent = mode === '10'
        ? `第 ${Math.min(S.q + 1, TOTAL)} 題 / ${TOTAL}` : `第 ${S.q + 1} 題`;
    }
    el.score.textContent = `${fmtPts(S.score)} 分`;
    el.lives.classList.toggle('hidden', mode !== 'lives');
    el.lives.textContent = '❤'.repeat(Math.max(0, S.lives));
    // 連勝只在真的連起來 (2 題以上) 時才出現,平常不佔位置
    el.streak.classList.toggle('hidden', S.streak < 2);
    el.streak.innerHTML = `<i class="fa-solid fa-fire"></i> ${S.streak} 連勝`;
  }

  // 碼表只往上跑,不再掛「現在答對 +N」那種一直變小的數字 —— 計分沒有扣分項,
  // 慢只是拿不到速度加成。小數點後一位是為了讓快答的差別看得出來 (3.2 vs 4.8 秒)
  const fmtSec = (ms) => (Math.max(0, ms) / 1000).toFixed(1);
  function paintTimer(ms) { el.timer.textContent = `${fmtSec(ms)} 秒`; }

  function startTimer() {
    stopTimer();
    S.timerId = setInterval(() => {
      paintTimer(Date.now() - S.askedAt);
      paintTrack();
    }, 100);
    paintTimer(0);
  }
  function stopTimer() { if (S.timerId) clearInterval(S.timerId); S.timerId = null; }

  // ── 播放進度條 ──
  // 歌名藏起來了,但「這首有多長、播到哪」不會洩答案,而且看得出快到尾聲該下決定了。
  // 沒有時長 (瀏覽器來源 currentDuration() 回 null) 就整條收起來
  let track = { at: 0, base: 0, dur: 0, playing: false };
  const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  function paintTrack() {
    el.track.classList.toggle('hidden', !track.dur);
    if (!track.dur) return;
    const drift = track.playing ? (Date.now() - track.at) / 1000 : 0;
    const pos = Math.max(0, Math.min(track.dur, track.base + drift));
    el.trackFill.style.width = `${(pos / track.dur) * 100}%`;
    el.trackPos.textContent = fmtClock(pos);
    el.trackDur.textContent = fmtClock(track.dur);
  }

  // ── 本局戰績 ──
  // 一題一列往下疊。左欄本來只有一顆轉的唱片,空著也是空著,而且答完 3 秒就換下一題,
  // 沒有這份紀錄使用者根本來不及回想剛剛錯在哪
  function renderLog() {
    el.log.innerHTML = S.log.map((r) => `
      <div class="game-log-row ${r.correct ? 'ok' : 'no'}">
        <span class="game-log-n">${r.n}</span>
        <i class="fa-solid ${r.correct ? 'fa-check' : 'fa-xmark'}"></i>
        <span class="game-log-sec">${r.sec}s</span>
        <span class="game-log-title">${escapeHtml(r.title)}</span>
        <span class="game-log-pt">${r.gained ? `+${fmtPts(r.gained)}` : ''}</span>
      </div>`).join('');
    el.log.scrollTop = el.log.scrollHeight;
  }

  // ── 開始 / 結束 ──
  const pickTab = (box, set) => box.addEventListener('click', (e) => {
    const b = e.target.closest('.mode-tab');
    if (!b) return;
    set(b);
    box.querySelectorAll('.mode-tab').forEach((x) => x.classList.toggle('active', x === b));
  });
  pickTab(el.modes, (b) => { mode = b.dataset.mode; });
  pickTab(el.starts, (b) => { startMode = b.dataset.start; });

  // ── 題庫來源:指定一位歌手 (選填) ──
  // 只做歌手不做播放清單:不會有人同時猜多位歌手的歌,而清單那條是爬網頁內嵌 JSON、
  // 對方改版就壞的最脆弱路徑 (做過又移除,細節記在 ROADMAP)

  // 最近載入過的三位歌手,存在 localStorage (只是方便,不值得為它開一張表)。
  // 存的是正規化後的歌手名 + 封面,點下去重跑一次 loadArtist —— 曲目本身不快取,
  // 免得清單過期而使用者看不出來
  const RECENT_KEY = 'kanaric.game.artists';
  const RECENT_MAX = 3;
  const readRecent = () => {
    try { const v = JSON.parse(localStorage.getItem(RECENT_KEY)); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  };
  function pushRecent(a) {
    const list = readRecent().filter((x) => x && x.artist !== a.artist);
    list.unshift({ artist: a.artist, image: a.image || '' });
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch (e) {}
    renderRecent();
  }
  function renderRecent() {
    const list = readRecent();
    el.artRecent.classList.toggle('hidden', !list.length);
    el.artRecent.innerHTML = '<span class="game-artist-recent-label">最近</span>' + list.map((a) => `
      <button class="game-artist-chip" data-name="${escapeHtml(a.artist)}">
        ${a.image ? `<img src="${escapeHtml(a.image)}" alt="">` : '<i class="fa-solid fa-user"></i>'}
        <span>${escapeHtml(a.artist)}</span>
      </button>`).join('');
  }
  el.artRecent.addEventListener('click', (e) => {
    const b = e.target.closest('.game-artist-chip');
    if (!b) return;
    el.artName.value = b.dataset.name;
    loadArtist();
  });
  renderRecent();

  // 卡片與輸入區互斥 —— 兩個都攤開的話右欄會長到要捲動,而猜歌頁刻意不讓使用者捲
  function showArtistCard(d) {
    el.artTitle.textContent = d.artist;
    el.artCount.textContent = `${d.count} 首曲目`;
    el.artImg.hidden = !d.image;
    if (d.image) el.artImg.src = d.image;
    el.artCard.classList.remove('hidden');
    el.artPick.classList.add('hidden');
    el.artStatus.textContent = '';
  }

  async function loadArtist() {
    const name = el.artName.value.trim();
    if (!name) return;
    el.artLoad.disabled = true;
    el.artCard.classList.add('hidden');
    el.artStatus.textContent = '載入中…';
    try {
      const d = await (await post('/api/game/artist', { name })).json();
      if (!d.tracks) {
        poolTracks = [];
        el.start.disabled = true;
        el.artPick.classList.remove('hidden');
        el.artStatus.textContent = {
          no_artist: '找不到這位歌手，換個寫法試試',
          no_tracks: 'iTunes 上找不到這位歌手的歌',
          bad_name: '請先輸入歌手名',
        }[d.error] || '載入失敗，稍後再試';
        return;
      }
      poolTracks = d.tracks;
      showArtistCard(d);
      pushRecent(d);
      el.start.disabled = false;
    } catch (e) {
      el.artStatus.textContent = '載入失敗，稍後再試';
    } finally {
      el.artLoad.disabled = false;
    }
  }
  el.artLoad.addEventListener('click', loadArtist);
  el.artName.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadArtist(); });
  el.artClear.addEventListener('click', () => {
    poolTracks = [];
    el.artName.value = '';
    el.artStatus.textContent = '';
    el.artCard.classList.add('hidden');
    el.artPick.classList.remove('hidden');
    el.artName.focus();
    el.start.disabled = true;
  });

  el.start.addEventListener('click', startGame);
  el.again.addEventListener('click', startGame);
  // 回開始畫面重選模式 (結算完最常見的下一步就是換個玩法)
  el.remode.addEventListener('click', () => {
    el.over.classList.add('hidden');
    el.setup.classList.remove('hidden');
    el.start.disabled = !poolTracks.length;
  });

  async function startGame() {
    // 歌手是必填的:沒有它就沒有干擾選項來源,整局會退回「從你聽過的歌亂抽」
    if (!poolTracks.length) {
      showToast('先填一位歌手並按「載入」', 'fa-solid fa-circle-info', 3000);
      el.artName.focus();
      return;
    }
    // key 設成「開局當下正在播的那首」而不是空字串:next 生效前監控還在推那一首,
    // 空字串會讓它被當成新題目 —— 選項是上一首的,使用者聽到的卻是切過去的新歌
    Object.assign(S, {
      running: true, q: 0, score: 0, lives: LIVES, wrong: [], streak: 0, best: 0, log: [],
      answer: null, key: lastKey, hints: 0, answered: true, waitFrom: Date.now(),
      asked: new Set(), skips: 0,
    });
    el.setup.classList.add('hidden');
    el.over.classList.add('hidden');
    el.play.classList.remove('hidden');
    el.options.innerHTML = '<div class="game-waiting"><i class="fa-solid fa-forward"></i> 切歌中…</div>';
    el.reveal.classList.add('hidden');
    el.stage.classList.remove('revealed');
    renderLog();
    paintTimer(0);
    updateHud();
    // 播放列與封面也寫著答案。syncPlayerBar 每秒把歌名寫回 DOM,所以用 class 讓 CSS 去遮
    document.body.classList.add('game-masked');
    sendActive(true);
    // 不隨機的話 next 會照專輯順序跑,題目很好猜。結束後不會自動改回來
    await control('shuffle').catch(() => {});
    await control('next').catch(() => {});
  }

  function endGame() {
    clearTimeout(S.revealId);
    stopTimer();
    S.running = false;
    S.answered = true;
    S.answer = null;
    // 一局結束就把音樂停下來 —— 不停的話播放器會自己接著跑下一首,
    // 使用者還在看成績,背景卻已經在放沒人聽的歌
    control('pause').catch(() => {});
    document.body.classList.remove('game-masked');
    sendActive(false);
    el.play.classList.add('hidden');
    el.over.classList.remove('hidden');
    el.resultScore.textContent = `${fmtPts(S.score)} 分`;
    const played = S.q;
    // 連勝用出題畫面那組橘色標記,不要混在灰字裡
    const streakTag = S.best >= 2
      ? `　<span class="game-result-streak"><i class="fa-solid fa-fire"></i> 最長 ${S.best} 連勝</span>` : '';
    el.resultLine.innerHTML = played
      ? `答對 ${played - S.wrong.length} / ${played} 題${streakTag}`
      : '這局沒有作答';
    el.wrong.innerHTML = S.wrong.length
      ? '<h3>沒認出來的歌</h3>' + S.wrong.map((w) => `
          <div class="game-wrong-row">${escapeHtml(w.title)}<span>${escapeHtml(w.artist)}</span></div>`).join('')
      : '';

    // 全曲目:覆蓋率與沒考到的歌。缺的多半是清單裡沒有的歌,列出來才知道要補什麼
    const left = mode === 'full' ? remainingTracks() : [];
    if (mode === 'full') {
      const total = mainTracks().length;
      el.resultLine.innerHTML = `考過 ${total - left.length} / ${total} 首`
        + (played ? `　答對 ${played - S.wrong.length} / ${played} 題` : '')
        + streakTag;
    }
    el.missing.innerHTML = left.length
      ? `<h3>還沒考到的 ${left.length} 首${left.length > MISSING_SHOWN ? `(列出前 ${MISSING_SHOWN} 首)` : ''}</h3>`
        + left.slice(0, MISSING_SHOWN).map((t) => `
          <div class="game-wrong-row">${escapeHtml(t.title)}</div>`).join('')
      : '';
  }
})();
