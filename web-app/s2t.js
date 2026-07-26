// 中國的歌詞站 (網易/QQ/酷狗) 回來的是簡體,存進快取前轉繁體。
// **日文歌詞絕對不能過這個轉換** —— 日文漢字有一半跟簡體同形,會被改掉 (声→聲、学校→學校),
// 所以整份有假名就原封不動。這跟 furigana_inject.process_lrc 的「無假名就不注音」是同一條規則。
// 單獨一個檔案 (而非留在 server.js) 只是為了讓 test_s2t.js 能直接 require,不用把整台 server 帶起來。
const OpenCC = require('opencc-js');

const convert = OpenCC.Converter({ from: 'cn', to: 'tw' });

// 「這個字是日文字嗎」= 它在 JIS X 0208 裡嗎。用 Shift_JIS 解碼器把整張表倒出來當集合,
// 免得為了同一件事塞一份幾千字的常數進原始碼 (Node 的 TextDecoder 只能解碼,所以是反著建表)。
let jisChars = null;
function isJapaneseChar(ch) {
  if (!jisChars) {
    jisChars = new Set();
    const dec = new TextDecoder('shift_jis');
    for (let hi = 0x81; hi <= 0xfc; hi++) {
      for (let lo = 0x40; lo <= 0xfc; lo++) {
        const c = dec.decode(Uint8Array.from([hi, lo]));
        if (c.length === 1 && c !== '�') jisChars.add(c);
      }
    }
  }
  return jisChars.has(ch);
}

// 日文歌詞裡混進來的簡體字 (網易上有些日文歌整份是簡體漢字打的:爱/谁/终/伤)。
// 那些字**不是日文漢字**,留著就是缺字,所以逐字轉;日文本來就有的字 (声/学/叶/麼) 在 JIS 表裡,一律不動。
// 轉去**新字體 (cn -> jp)** 而不是繁體:弹->弾、脑->脳、摇->揺 才是日文的寫法,繁體形 (彈/腦/搖) 連 unidic 都查不到、注音會跟著壞。
// **JIS 那道閘門不可以省** —— cn->jp 對日文本來就有的字照樣改 (机->機、后->後、里->裏),整份直接轉會毀掉正常日文歌詞。
const convertToJp = OpenCC.Converter({ from: 'cn', to: 'jp' });

function fixStraySimplified(line) {
  return line.replace(/[一-鿿]/g, (ch) => {
    if (isJapaneseChar(ch)) return ch;
    const t = convertToJp(ch);
    return [...t].length === 1 ? t : ch;
  });
}

function toTraditional(text) {
  if (!/[぀-ヿ]/.test(text)) return convert(text);
  // 日文歌詞:歌詞本體整行不准過 convert(),但網易連日文歌都給簡體的製作人員列 (作词 : … / 编曲 : …)。
  // 那些列在寫入時已被 autoMarkTitleLines() 標上 #TITLE#,只轉這些列;其餘各行只挑非日文漢字逐字修。
  // ponytail: 名字裡剛好有簡繁同形字的話會一起被轉 (學/實),製作人員列上罕見,真遇到再改成只轉冒號前的標籤。
  return text
    .split('\n')
    .map((line) => (line.includes('#TITLE#') ? convert(line) : fixStraySimplified(line)))
    .join('\n');
}

// 反向:繁 -> 簡,只給「查中國平台」用。中國三家的搜尋結果標題是簡體,cn_music._title_matches
// 拿正規化字串互相包含來比對,繁體歌名 (告白氣球) 永遠對不上簡體結果 (告白气球) —— 整首歌就 MISS。
// **不能無條件轉**:日文歌名常是純漢字 (新宝島 -> 新宝岛) 轉了反而查不到,所以呼叫端是
// 「原名先查、MISS 才用簡體重試」,這裡只負責轉換,有假名一律原樣回傳 (同 toTraditional 的分界)。
const convertToCn = OpenCC.Converter({ from: 'tw', to: 'cn' });

function toSimplified(text) {
  if (!text || /[぀-ヿ]/.test(text)) return text;
  return convertToCn(text);
}

module.exports = { toTraditional, toSimplified };
