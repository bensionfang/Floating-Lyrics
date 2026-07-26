// 內嵌注音的歌詞守門 (實作在 web-app/lyric-quality.js)
// 樣本全取自真實快取:壞的那份是網易的 DECO*27 / モザイクロール,乾淨的取自比例最高的幾首
const assert = require('assert');
const { hasInlineRuby, inlineRubyRatio } = require('../web-app/lyric-quality');

// 漢字後面直接黏著讀音 —— 言葉ことば / 君きみ / 突つき
const inline = `[source:NetEase]
[00:00.000]#TITLE#作詞 : DECO*27
[00:26.780]とある言葉ことばが君きみに突つき刺ささり
[00:32.700]傷口きずぐちから漏もれ出だす液えきを愛あいと形容けいようしてみた
[00:53.220]思おもいやりの欠如けつじょと形かたちだけの交尾こうびは
[00:59.140]腐くされ縁えんのキミとアタシによく似にている
[01:05.750]それでも好すき…とか笑わら
[01:09.830]愛あいしたっていいじゃないか
[01:12.630]縛しばり 誰だれも 触ふれないよう
[01:17.110]これも運命うんめいじゃないか
[01:19.470]消きえる 消きえる とある愛世あいせ
[01:36.330]終おわる頃ころには君きみに飽あきいてるよ
[01:42.050]愛あいか欲よくか分わからず放はなつことは何なにとしようか`;
assert.strictEqual(hasInlineRuby(inline), true);

// 正常日文歌詞:送假名長的動詞會命中幾個 (刺さり/醒めない),但比例遠低於門檻
const clean = `[source:NetEase]
[00:00.000]#TITLE#作詞 : n-buna
[00:22.37]あれはどうしようもないね
[00:25.45]どれも腐りかけてる
[00:28.79]あのね、きっと夢なんて
[00:31.93]いずれ、ふっと消え去って
[00:34.97]けどね、ずっと醒めないで
[00:38.27]いつも試されている
[00:41.11]水を忘れた魚みたい
[00:43.55]私の鼓動マーチみたい
[00:45.11]少しダサいけど
[00:47.20]互いに傷つけ合って
[00:49.30]ずっと叶わない思いばかりを
[00:51.40]決まっていたのかな
[00:53.50]君の声が聞こえる 実は学校の後ろ
[00:55.60]そしたらこんな日が来ることも同じように`;
assert.strictEqual(hasInlineRuby(clean), false);

// 樣本太少不判 (短歌詞、副歌重複的歌會整份只有幾個漢字串)
assert.strictEqual(hasInlineRuby('[00:01.00]言葉ことばが君きみに'), false);
// 中文歌沒有假名,這條規則不適用
assert.strictEqual(hasInlineRuby('[00:01.00]' + '我們的愛情像風箏斷了線 '.repeat(20)), false);

// 兩份的分數要拉得開,不是剛好卡在門檻兩邊
const rIn = inlineRubyRatio(inline).ratio;
const rCl = inlineRubyRatio(clean).ratio;
assert.ok(rIn - rCl > 0.15, `分數沒拉開: 內嵌 ${rIn.toFixed(2)} vs 乾淨 ${rCl.toFixed(2)}`);

console.log(`OK (內嵌 ${rIn.toFixed(2)} / 乾淨 ${rCl.toFixed(2)})`);
