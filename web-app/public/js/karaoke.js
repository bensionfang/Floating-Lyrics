/**
 * 逐字卡拉OK填色的共用實作。歌詞區、靈動島、行動版三個端共用這一份 ——
 * 各寫一份就是靜默失效的來源 (哪一端漏掉一個狀態不會有錯誤訊息,只是那裡不會動)。
 *
 * 放在 public/js 是為了讓瀏覽器 <script> 載得到,同 scroll-zone.js、song-key.js 的先例。
 *
 * 吃的資料是 server 併進 LRC 的 `#WORDS#` 行解析出來的折線 `[[字元索引, 相對毫秒], …]`,
 * **毫秒相對於那一句自己的時間戳**。沒有折線就不要呼叫 —— 沒有逐字資料的歌一律
 * 整行一起變白 (勻速掃光做過又拿掉了:那個時間是猜的,句中有停頓就明顯對不上)。
 */

/**
 * 把一段歌詞的文字節點就地切成一字一顆 `<span class="kc">`,並記下每顆 `<ruby>`
 * 蓋住的字元範圍 (注音也要逐字填)。
 *
 * **不用整行的 background-clip 漸層**:歌詞區 32px 的字會換行,水平漸層對換行後的
 * 第二列位置是錯的。逐字 span + 只有「正在唱的那一個字」做局部漸層,換行天然正確。
 *
 * 切過就記在元素上不再切、也不還原:多出來的 span 是無害的,而還原會跟 ruby 編輯、
 * 段落循環那幾個也在讀這棵 DOM 的功能打架。
 *
 * @param {Element} root      歌詞本體那顆元素 (不要含譯文/羅馬字)
 * @param {string} rejectSel  要跳過的子樹。`rt` 是注音不是歌詞本體,算進去索引會整個歪掉
 */
function karaokeSplit(root, rejectSel = 'rt') {
  if (root.__kc) return root.__kc;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest(rejectSel) ? NodeFilter.FILTER_REJECT
                                                          : NodeFilter.FILTER_ACCEPT)
  });
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);

  const chars = [];
  const rubies = [];
  for (const node of texts) {
    const frag = document.createDocumentFragment();
    const ruby = node.parentElement.closest('ruby');
    const rt = ruby && ruby.querySelector('rt');
    if (rt && rt.textContent) rubies.push({ rt, start: chars.length, len: node.data.length });
    for (const ch of node.data) {
      const s = document.createElement('span');
      s.className = 'kc';
      s.textContent = ch;
      frag.appendChild(s);
      chars.push(s);
    }
    node.parentNode.replaceChild(frag, node);
  }
  root.__kc = { chars, rubies };
  return root.__kc;
}

/** 折線內插:給相對毫秒,回傳「唱到第幾個字」(小數) */
function karaokeCharAt(points, ms) {
  if (ms <= points[0][1]) return points[0][0];
  for (let i = 1; i < points.length; i++) {
    const [pi, pt] = points[i - 1];
    const [ci, ct] = points[i];
    if (ms < ct) return ct === pt ? ci : pi + (ci - pi) * ((ms - pt) / (ct - pt));
  }
  return points[points.length - 1][0];
}

/**
 * 畫一次填色。每幀跑,但實際會動到 DOM 的只有邊界那一兩顆 span。
 * @param {number} ms 相對於這一句時間戳的毫秒
 */
function karaokePaint(root, points, ms, rejectSel) {
  if (!root || !points || points.length < 2) return;
  const { chars, rubies } = karaokeSplit(root, rejectSel);
  if (!chars.length) return;

  const k = karaokeCharAt(points, ms);
  const full = Math.floor(k);
  for (let i = 0; i < chars.length; i++) {
    const on = i < full;
    if (chars[i].classList.contains('sung') !== on) chars[i].classList.toggle('sung', on);
  }
  // 正在唱的那一個字做局部漸層。單一個字不會換行,所以水平漸層在這裡是正確的。
  // **換掉正在唱的那顆時要一併清掉行內的 `--k`** —— 三端的 CSS 現在是「每一顆 .kc 都套
  // 同一條漸層,唱過的靠 --k:100%」(見下面 karaokeClear 的註解),行內值的權重比 class 高,
  // 留著的話那顆字會永遠停在當時的百分比 (例如唱過了卻只填到六成)。
  const cur = chars[full];
  if (root.__kcNow && root.__kcNow !== cur) {
    root.__kcNow.classList.remove('kc-now');
    root.__kcNow.style.removeProperty('--k');
  }
  root.__kcNow = cur || null;
  if (cur) {
    cur.classList.add('kc-now');
    cur.style.setProperty('--k', `${Math.max(0, Math.min(1, k - full)) * 100}%`);
  }
  // 注音跟著它蓋住的那幾個字一起填。rt 很短、不會換行,所以整塊用水平漸層是對的。
  // 一行頂多幾顆 ruby,每幀全掃比記「哪顆變了」便宜
  for (const r of rubies) {
    const p = Math.max(0, Math.min(1, (k - r.start) / r.len));
    r.rt.classList.toggle('rt-pending', p <= 0);
    r.rt.classList.toggle('rt-now', p > 0 && p < 1);
    r.rt.classList.toggle('rt-sung', p >= 1);
    if (p > 0 && p < 1) r.rt.style.setProperty('--k', `${p * 100}%`);
    else r.rt.style.removeProperty('--k');   // 同上:行內值會蓋掉 rt-sung 的 100%
  }
}

/**
 * 把填色狀態收乾淨 (換句時要做,不然唱過的那一行會整行留白)。
 *
 * 行內的 `--k` 也要清:三端的 CSS 是「每一顆 .kc / rt 都套同一條 background-clip 漸層」
 * (**不是只有正在唱的那顆才套**) —— 只有正在唱的那顆套的話,它未填的那半會比旁邊還沒唱到
 * 的字**暗一截**:background-clip 會關掉次像素抗鋸齒,同一個顏色畫出來就是比較細比較暗
 * (實測平均亮度 42.4 vs 47.4)。統一套之後兩者逐像素相同。
 */
function karaokeClear(el) {
  if (!el) return;
  el.querySelectorAll('.kc.sung, .kc.kc-now, rt.rt-pending, rt.rt-now, rt.rt-sung')
    .forEach((c) => {
      c.classList.remove('sung', 'kc-now', 'rt-pending', 'rt-now', 'rt-sung');
      c.style.removeProperty('--k');
    });
  el.__kcNow = null;
}

if (typeof module !== 'undefined') {
  module.exports = { karaokeSplit, karaokeCharAt, karaokePaint, karaokeClear };
}
