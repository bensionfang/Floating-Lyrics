// 逐字時間合併 (#WORDS#) 的回歸測試。
// 最關鍵的一條是「兩份資料的斷句不同」:逐字時間來自 QQ 的 QRC,歌詞本體多半來自網易,
// 網易切短行、QQ 併長行。整行比對只有 62% 對得上,靠字元流的單調前進比對才拉到 98%。
const { mergeWordTimes, rawIndexMap, simplify } = require('../web-app/word-times');

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}\n      預期 ${w}\n      實際 ${g}`); }
}

// 用文字建流:每個字一個 token,間隔 100ms
function flowOf(text, start = 0, step = 100) {
  const chars = [...text];
  return { flow: text, ms: chars.map((_, i) => start + i * step) };
}
function wordsLine(out, n = 0) {
  return out.split('\n').filter((l) => l.includes('#WORDS#'))[n];
}

// --- rawIndexMap:正規化索引映回原始行 ---
check('索引映射 / 有標點空白', rawIndexMap('あ、い う'), [0, 2, 4]);
check('索引映射 / 全是字', rawIndexMap('あいう'), [0, 1, 2]);
check('索引映射 / 純標點', rawIndexMap('、。'), []);

// --- simplify:斜率沒變的中間點丟掉 ---
check('折線簡化 / 等速只留頭尾', simplify([[0, 0], [1, 100], [2, 200], [3, 300]]), [[0, 0], [3, 300]]);
check('折線簡化 / 斜率變了就留', simplify([[0, 0], [1, 100], [2, 500]]), [[0, 0], [1, 100], [2, 500]]);
check('折線簡化 / 兩點原樣', simplify([[0, 0], [2, 200]]), [[0, 0], [2, 200]]);

// --- 主要案例:QQ 併長行 vs 網易切短行 (自白 的真實形狀) ---
// QQ 的一行是「ぶっ飛んじゃってる 自意識過剰」,快取的歌詞卻拆成兩行
{
  const wt = flowOf('ぶっ飛んじゃってる自意識過剰', 30000, 100);
  const lrc = '[00:10.00]ぶっ飛んじゃってる\n[00:12.00]自意識過剰';
  const out = mergeWordTimes(lrc, wt);
  // 第一行:9 個字,等速;收尾點的長度有 120ms 下限,所以最後一段斜率不同、不會被簡化掉
  check('併長行 / 第一行對上', wordsLine(out, 0), '[00:10.00]#WORDS#0:0,9:900');
  // 第二行:游標已經前進,毫秒重新以自己的行首為基準 (所以又是從 0 開始)
  check('併長行 / 第二行對上', wordsLine(out, 1), '[00:12.00]#WORDS#0:0,4:400,5:520');
}

// --- 毫秒必須相對於行首:flow 的時間軸 (QQ) 與歌詞的時間戳 (網易) 不同源 ---
{
  const wt = flowOf('あいう', 99000, 200);
  const out = mergeWordTimes('[00:03.00]あいう', wt);
  check('時間軸重新對齊', wordsLine(out), '[00:03.00]#WORDS#0:0,3:600');
}

// --- 副歌重複行:游標往前找不到就回頭找 ---
{
  const wt = flowOf('あいうえおあいう', 0, 100);
  const out = mergeWordTimes('[00:01.00]あいうえお\n[00:05.00]あいう\n[00:09.00]えお', wt);
  check('重複行 / 三行都插上', out.split('\n').filter((l) => l.includes('#WORDS#')).length, 3);
  // 第三行「えお」在游標 (8) 之後找不到,回頭找到位置 3
  check('重複行 / 回頭找', wordsLine(out, 2), '[00:09.00]#WORDS#0:0,2:200');
}

// --- ruby 要先還原成原文才比對得到,而索引是**原始行**的索引 (含 rt 之外的假名) ---
{
  const wt = flowOf('夢ならば', 0, 100);
  const out = mergeWordTimes("[00:01.00]<ruby class='editable-ruby'>夢<rt>ゆめ</rt></ruby>ならば", wt);
  check('ruby / 索引是原文的', wordsLine(out), '[00:01.00]#WORDS#0:0,3:300,4:420');
}

// --- 不該碰的行 ---
{
  const wt = flowOf('あいう', 0, 100);
  const lrc = '[00:01.00]#TITLE#作詞:誰か\n[00:02.00]あいう\n[00:02.00]#TRANS#譯文\n[00:02.00]#ROMAJI#a i u';
  const out = mergeWordTimes(lrc, wt);
  check('跳過 / 只插一行', out.split('\n').filter((l) => l.includes('#WORDS#')).length, 1);
  check('跳過 / 插在歌詞行後面', out.split('\n')[2], '[00:02.00]#WORDS#0:0,2:200,3:320');
}

// --- 冪等:同一份輸入合併兩次不該插出兩行 ---
{
  const wt = flowOf('あいう', 0, 100);
  const once = mergeWordTimes('[00:01.00]あいう', wt);
  check('冪等', mergeWordTimes(once, wt), once);
}

// --- 全有或全無:一行對不上就整份不插 (「一句有一句沒有」比整首都不逐字更糟) ---
{
  const wt = flowOf('あいうかきく', 0, 100);
  const good = '[00:01.00]あいう\n[00:05.00]かきく';
  check('全對上 / 兩行都插', mergeWordTimes(good, wt).split('\n').filter((l) => l.includes('#WORDS#')).length, 2);

  // 中間夾一行 flow 裡沒有的 (合聲括號、尾巴的 yeah 這類真實情況)
  const partial = '[00:01.00]あいう\n[00:03.00]さしす\n[00:05.00]かきく';
  check('一行對不上 / 整份原樣回傳', mergeWordTimes(partial, wt), partial);

  // 純標點的行不算數,不該因為它而整首放棄
  const punct = '[00:01.00]あいう\n[00:03.00]♪♪♪\n[00:05.00]かきく';
  check('純標點行不影響', mergeWordTimes(punct, wt).split('\n').filter((l) => l.includes('#WORDS#')).length, 2);

  // 已經插好的行要算成「對上」,否則第二次合併會把整首丟掉
  const once = mergeWordTimes(good, wt);
  check('冪等 / 全有或全無之後仍然冪等', mergeWordTimes(once, wt), once);
}

// --- 沒有資料 / 資料壞掉就原樣回傳 ---
{
  const lrc = '[00:01.00]あいう';
  check('無資料 / 空物件', mergeWordTimes(lrc, {}), lrc);
  check('無資料 / null', mergeWordTimes(lrc, null), lrc);
  check('無資料 / flow 與 ms 長度不符', mergeWordTimes(lrc, { flow: 'あいう', ms: [0] }), lrc);
  check('無資料 / 整首都對不上', mergeWordTimes(lrc, flowOf('かきくけこ')), lrc);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
