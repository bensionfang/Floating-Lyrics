// 猜歌小遊戲 (邊聽邊猜)。
// 題目就是「現在正在播的那首歌」—— 這一頁負責藏答案、出選項、計分,切歌走既有的
// /api/media-control。遊戲狀態全在這裡,server 不記錄局面 (只記每題結果)。
(function () {
  const $ = (id) => document.getElementById(id);
  const el = {
    setup: $('game-setup'), play: $('game-play'), over: $('game-over'),
    modes: $('game-modes'), start: $('game-start'), again: $('game-again'),
    progress: $('game-progress'), score: $('game-score'), lives: $('game-lives'), timer: $('game-timer'),
    stage: $('game-stage'), options: $('game-options'), reveal: $('game-reveal'),
    skip: $('game-skip'), quit: $('game-quit'),
    resultScore: $('game-result-score'), resultLine: $('game-result-line'), wrong: $('game-wrong'),
    remode: $('game-remode'), starts: $('game-starts'),
    artName: $('game-artist-name'), artLoad: $('game-artist-load'),
    artStatus: $('game-artist-status'), artClear: $('game-artist-clear'),
  };

  const TOTAL = 10;           // 「10 題一局」的題數
  const LIVES = 3;            // 「三次錯就結束」的命數
  const REVEAL_MS = 3000;     // 揭曉後自動切下一題
  const BASE_SCORE = 10;
  // 答題計分:5 秒內滿分,之後每 5 秒少 1 分,最低 3 分。
  // 有下限是因為冷門歌本來就要聽久一點,一路扣到 0 只會讓人放棄慢慢想
  const MIN_SCORE = 3, DECAY_SEC = 5;
  const timeScore = (ms) => Math.max(MIN_SCORE, BASE_SCORE - Math.floor(ms / 1000 / DECAY_SEC));

  let mode = '10';
  let poolTracks = [];        // 指定歌手的曲目,干擾選項的第一順位;沒指定就是空陣列
  let startMode = 'intro';    // 從哪裡開始播:前奏 (0 秒) / 隨機時間
  let lastKey = '';           // 最後一次看到的播放狀態 (不管有沒有在遊戲中)
  const S = {
    running: false, q: 0, score: 0, lives: LIVES, wrong: [],
    answer: null, key: '', answered: true,
    askedAt: 0, waitFrom: 0, timerId: null, revealId: null,
  };

  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, (m) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]
    ));
  }
  const keyOf = (m) => (m.artist || '') + '|||' + (m.title || '');
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
    if (!S.running || S.answered === false) return;   // 作答中不理會播放狀態
    if (S.answer || !m.title || m.resolving) return;
    // resolving = 歌名還沒定案 (iTunes 日文原名還原中)。不等它的話答案會在作答途中被換掉。
    // 通常要求「與上一題不同」才算換歌成功,但清單只有一兩首時 next 會切回同一首 ——
    // 等超過 8 秒就接受重複,否則畫面永遠停在「切歌中」
    if (keyOf(m) === S.key && Date.now() - S.waitFrom < 8000) return;
    askQuestion(m);
  }

  async function askQuestion(m) {
    S.answer = { artist: m.artist, title: m.title };
    S.key = keyOf(m);
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
        <span class="game-option-artist">${escapeHtml(o.artist)}</span>
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
    // 答完了就只留花掉的時間,「現在答對 +N」再掛著會看起來像還能拿分
    el.timer.textContent = `${Math.floor(elapsed / 60000)}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}`;
    const gained = correct ? timeScore(elapsed) : 0;
    S.score += gained;
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
        ${correct ? `答對 +${gained}` : (btn ? '答錯' : '跳過')}
      </div>
      <div class="game-reveal-song">${escapeHtml(S.answer.title)}<span>${escapeHtml(S.answer.artist)}</span></div>`;
    el.reveal.classList.remove('hidden');
    updateHud();

    post('/api/game/result', {
      artist: S.answer.artist, title: S.answer.title,
      correct, hints: 0, answer_ms: elapsed, mode,
    }).catch(() => {});

    S.q++;
    if ((mode === '10' && S.q >= TOTAL) || (mode === 'lives' && S.lives <= 0)) {
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

  // ── 計分板 ──
  function updateHud() {
    el.progress.textContent = mode === '10' ? `第 ${Math.min(S.q + 1, TOTAL)} 題 / ${TOTAL}` : `第 ${S.q + 1} 題`;
    el.score.textContent = `${S.score} 分`;
    el.lives.classList.toggle('hidden', mode !== 'lives');
    el.lives.textContent = '❤'.repeat(Math.max(0, S.lives));
  }

  // 碼表旁邊直接寫「現在答對能拿幾分」—— 不然時間扣分是看不見的規則,催不動人
  function paintTimer(ms) {
    const s = Math.floor(ms / 1000);
    const worth = timeScore(ms);
    el.timer.innerHTML = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` +
      ` <b class="game-worth">現在答對 +${worth}</b>`;
  }

  function startTimer() {
    stopTimer();
    S.timerId = setInterval(() => paintTimer(Date.now() - S.askedAt), 500);
    paintTimer(0);
  }
  function stopTimer() { if (S.timerId) clearInterval(S.timerId); S.timerId = null; }

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
  async function loadArtist() {
    const name = el.artName.value.trim();
    if (!name) return;
    el.artLoad.disabled = true;
    el.artStatus.textContent = '載入中…';
    try {
      const d = await (await post('/api/game/artist', { name })).json();
      if (!d.tracks) {
        poolTracks = [];
        el.start.disabled = true;
        el.artStatus.textContent = {
          no_artist: '找不到這位歌手，換個寫法試試',
          no_tracks: 'iTunes 上找不到這位歌手的歌',
          bad_name: '請先輸入歌手名',
        }[d.error] || '載入失敗，稍後再試';
        return;
      }
      poolTracks = d.tracks;
      el.artStatus.textContent = `已載入「${d.artist}」${d.count} 首`;
      el.artClear.classList.remove('hidden');
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
    el.artClear.classList.add('hidden');
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
      running: true, q: 0, score: 0, lives: LIVES, wrong: [],
      answer: null, key: lastKey, hints: 0, answered: true, waitFrom: Date.now(),
    });
    el.setup.classList.add('hidden');
    el.over.classList.add('hidden');
    el.play.classList.remove('hidden');
    el.options.innerHTML = '<div class="game-waiting"><i class="fa-solid fa-forward"></i> 切歌中…</div>';
    el.reveal.classList.add('hidden');
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
    el.resultScore.textContent = `${S.score} 分`;
    const played = S.q;
    el.resultLine.textContent = played
      ? `答對 ${played - S.wrong.length} / ${played} 題`
      : '這局沒有作答';
    el.wrong.innerHTML = S.wrong.length
      ? '<h3>沒認出來的歌</h3>' + S.wrong.map((w) => `
          <div class="game-wrong-row">${escapeHtml(w.title)}<span>${escapeHtml(w.artist)}</span></div>`).join('')
      : '';
  }
})();
