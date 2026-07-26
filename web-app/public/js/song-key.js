// 歌曲身分:(artist, title),比對時剝掉第一個括號起的尾綴。
// 剝括號是為了讓「春泥棒 (Live)」不會變成「春泥棒」以外的另一首 —— 兩個選項長得幾乎一樣
// 但只有一個算對,那不是難度是刁難。跟 listening_history 的 base_title 同一個概念。
//
// **前後端共用**:server 用它挑干擾選項 (web-app/game.js),前端「全曲目」玩法用它比對
// 「這首考過了沒」。兩邊算出來的鍵必須逐字相同,所以只能有這一份 —— 各寫各的就是靜默失效
// (覆蓋率永遠差幾首,而且不會有錯誤訊息)。放在 public/js 是為了瀏覽器 <script> 載得到,
// 同時 server 與測試 require 得到,同 scroll-zone.js 的先例。
function songKey(row) {
  const base = String((row && row.title) || '').replace(/[(（\[【].*$/, '');
  return (String((row && row.artist) || '') + '|' + base).replace(/\s+/g, '').toLowerCase();
}

// 只看歌名的鍵。**全曲目玩法的「這首考過了沒」要用這個,不能用 songKey** ——
// 連動曲在 iTunes 上的 artistName 是聯名寫法 (`Chevon & ヨルシカ`),而曲目池裡的歌手已經
// 收斂成正規名,兩邊的 songKey 永遠對不起來,那首歌就永遠算沒考過。曲目池只有一位歌手,
// 光比歌名不會誤判。
function titleKey(row) {
  return String((row && row.title) || '')
    .replace(/[(（\[【].*$/, '')
    .replace(/\s*feat\.?.*$/i, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

if (typeof module !== 'undefined') module.exports = { songKey, titleKey };
