/**
 * 羅馬拼音 (#ROMAJI#) 的回歸測試。
 *
 *   node tests/test_romaji.js
 */
const { kanaToRomaji, lineToRomaji, mergeRomaji } = require('../web-app/romaji');

let failed = 0;
const eq = (got, want, label) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got  ${got}\n      want ${want}`}`);
};

// --- 假名 → 羅馬字 ---
eq(kanaToRomaji('うつくしいちょうのはねをみた'), 'utsukushiichounohaneomita', '直音 + 拗音 + を');
eq(kanaToRomaji('きって'), 'kitte', '促音重複子音');
eq(kanaToRomaji('まっちゃ'), 'matcha', '促音在 ch 前寫 t');
eq(kanaToRomaji('きんえん'), "kin'en", '撥音後接母音要隔音符號');
eq(kanaToRomaji('きねん'), 'kinen', '撥音後接子音不加');
eq(kanaToRomaji('ラーメン'), 'raamen', '片假名 + 長音符延長母音');
eq(kanaToRomaji('しんじゅく'), 'shinjuku', 'し/じゅ 的非機械式拼法');
eq(kanaToRomaji('あっ'), 'a', '行尾的促音沒有下一個音,不留孤立子音');

// --- 注音後的 HTML → 羅馬字 ---
const RUBY = (o, h) => `<ruby class='editable-ruby' data-orig='${o}' data-hira='${h}'>${o}<rt>${h}</rt></ruby>`;
// 讀音取 <rt> 而不是漢字本身;助詞前後斷開,送り仮名黏著
eq(lineToRomaji(`${RUBY('美', 'うつく')}しい${RUBY('蝶', 'ちょう')}の${RUBY('羽', 'はね')}を${RUBY('見', 'み')}た`),
  'utsukushii chou no hane o mita', 'ruby 的讀音 + 助詞斷句');
// 送り仮名不可以被當成斷點:聞こえる 要黏成一個字
eq(lineToRomaji(`${RUBY('君', 'きみ')}の${RUBY('声', 'こえ')}が${RUBY('聞', 'き')}こえる`),
  'kimi no koe ga kikoeru', '送り仮名黏著,不裂成 ki koeru');
// 助詞 は 自成一段時唸 wa
eq(lineToRomaji(`${RUBY('私', 'わたし')}は${RUBY('歩', 'ある')}いた`), 'watashi wa aruita', '單獨一段的 は = wa');
// 黏在詞裡的 は 照樣是 ha
eq(lineToRomaji(`こんばんは${RUBY('君', 'きみ')}`), 'konbanha kimi', '詞尾的 は 仍然是 ha');
// 一個詞被送り仮名拆成好幾顆 ruby 時 (data-hs > 0) 不可以斷開
eq(lineToRomaji("<ruby class='editable-ruby' data-hs='0' data-hlen='1'>噛<rt>か</rt></ruby>み"
  + "<ruby class='editable-ruby' data-hs='2' data-hlen='1'>締<rt>し</rt></ruby>め"), 'kamishime',
  'data-hs>0 的續接 ruby 不是詞頭');
// 片假名詞沒有 ruby,靠助詞照樣斷得出來
eq(lineToRomaji(`ドアを${RUBY('開', 'あ')}けて`), 'doa o akete', '片假名詞 + 助詞');
// 全形標點轉半形,前面不留空格
eq(lineToRomaji(`${RUBY('私', 'わたし')}の${RUBY('足', 'あし')}も、${RUBY('指', 'ゆび')}も`),
  'watashi no ashi mo, yubi mo', '全形頓號轉半形逗號');

// --- 併進 LRC ---
const lrc = [
  '[00:00.00]#TITLE#作詞 : n-buna',
  `[00:10.00]${RUBY('君', 'きみ')}の${RUBY('声', 'こえ')}`,
  '[00:10.00]#TRANS#你的聲音',
  '[00:20.00]I love you',
].join('\n');
const merged = mergeRomaji(lrc);
eq(merged.split('\n')[2], '[00:10.00]#ROMAJI#kimi no koe', '羅馬字插在歌詞行後面 (譯文之前)');
eq(merged.split('\n').filter((l) => l.includes('#ROMAJI#')).length, 1, '製作人員列與英文行不插');
eq(mergeRomaji(merged), merged, '同一份輸入合併兩次不會插出兩行');

// --- 逃逸:歌詞是外部字串,前端用 innerHTML 畫 ---
const xss = mergeRomaji(`[00:01.00]&lt;img onerror=alert(1)&gt;${RUBY('君', 'きみ')}`);
eq(/#ROMAJI#[^\n]*<img/.test(xss), false, '解回來的實體字串要重新逃逸');
eq(/#ROMAJI#[^\n]*&lt;img/.test(xss), true, '逃逸後的內容仍然留著');

console.log(failed ? `\n${failed} FAILED` : '\nall pass');
process.exit(failed ? 1 : 0);
