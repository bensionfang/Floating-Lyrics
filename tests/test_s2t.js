// 簡繁轉換守門:中文轉繁、日文原封不動 (實作在 web-app/s2t.js)
const assert = require('assert');
const { toTraditional } = require('../web-app/s2t');

assert.strictEqual(toTraditional('我们的爱情像风筝断了线'), '我們的愛情像風箏斷了線');
const ja = '[00:01.00]君の声が聞こえる 実は学校の後ろ';
assert.strictEqual(toTraditional(ja), ja);   // 声/学 不可以被改成 聲/學
assert.strictEqual(toTraditional('[00:01.00]別問我為什麼'), '[00:01.00]別問我為什麼');  // 已是繁體不變

// 日文歌詞:本體不准動,但網易給的簡體製作人員列 (已標 #TITLE#) 要轉繁
const jaCredit = '[00:00.000]#TITLE#作词 : ASAKURA\n[00:12.00]君の声が聞こえる 実は学校の後ろ';
assert.strictEqual(
  toTraditional(jaCredit),
  '[00:00.000]#TITLE#作詞 : ASAKURA\n[00:12.00]君の声が聞こえる 実は学校の後ろ'
);

// 日文歌詞裡混進來的簡體字要修 (網易的モザイクロール 整份是簡體漢字打的),
// 但同一行的日文漢字不能被順手改掉 (声/学/叶 都在 JIS X 0208 裡)
assert.strictEqual(
  toTraditional('[00:26.78]とある言叶が君に突き刺さり 爱したっていいじゃないか 谁も 触れないよう'),
  '[00:26.78]とある言叶が君に突き刺さり 愛したっていいじゃないか 誰も 触れないよう'
);
assert.strictEqual(
  toTraditional('[00:01.00]伤口から漏れ出す液を 运命じゃないか 终わる顷には饱きてるよ'),
  '[00:01.00]傷口から漏れ出す液を 運命じゃないか 終わる頃には飽きてるよ'
);
// 修出來的要是新字體 (弾/揺/脳),不是繁體 (彈/搖/腦) —— 繁體形 unidic 查不到,注音會壞
assert.strictEqual(
  toTraditional('[00:01.00]弹き語りで摇れる脑と现実'),
  '[00:01.00]弾き語りで揺れる脳と現実'
);

console.log('OK');
