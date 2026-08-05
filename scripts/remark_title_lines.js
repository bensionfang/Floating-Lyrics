/**
 * 一次性:把快取裡漏標的製作人員列補上 `#TITLE#`。
 *
 * `autoMarkTitleLines` (web-app/title-lines.js) 是在**寫入時**跑的,所以規則改進之前存下來的
 * 歌詞不會回頭重標 —— 症狀是畫面上出現超長的「歌詞行」,實際是一整排作曲/編曲名單
 * (實測最長 109 字:`编曲 : 芝芝香/Mike/晚安/…`)。
 *
 * 預設 dry-run,`--apply` 才寫入 (寫入前自動備份 lyrics_data.db.bak)。
 *   node scripts/remark_title_lines.js
 *   node scripts/remark_title_lines.js --apply
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require(path.join(__dirname, '..', 'web-app', 'node_modules', 'sqlite3'));
const { autoMarkTitleLines } = require(path.join(__dirname, '..', 'web-app', 'title-lines.js'));

const DB = process.env.DB_PATH || path.join(__dirname, '..', 'lyrics_data.db');
const APPLY = process.argv.includes('--apply');

/**
 * 重標的結果只准「多出 `#TITLE#` 前綴」與「時間戳後面的空白被吃掉」——
 * 後者是 `autoMarkTitleLines` 本來就會做的 (`match[2].trim()`),新歌詞寫入時同樣會被吃掉,
 * 所以不算內容被改。其餘任何差異一律跳過那一列,寧可漏標也不要動到歌詞本身。
 */
function onlyAddedMarks(before, after) {
  const norm = (s) => s.split('\n')
    .map((l) => l.trim().replace(/^((?:\[[\d:.]+\])+)\s*(?:#TITLE#)?/, '$1'))
    .join('\n');
  return norm(before) === norm(after);
}

const db = new sqlite3.Database(DB);
db.all('SELECT artist, title, lyrics FROM cache', (err, rows) => {
  if (err) { console.error('讀取失敗:', err.message); process.exit(1); }

  const changes = [];
  let skipped = 0;
  for (const r of rows) {
    const out = autoMarkTitleLines(r.lyrics, r.title);
    if (out === r.lyrics) continue;
    if (!onlyAddedMarks(r.lyrics, out)) { skipped++; continue; }
    const added = out.split('\n').filter((l) => /\]#TITLE#/.test(l)).length
      - r.lyrics.split('\n').filter((l) => /\]#TITLE#/.test(l)).length;
    changes.push({ ...r, out, added });
  }

  console.log(`快取 ${rows.length} 首,要補標的 ${changes.length} 首` + (skipped ? `,內容會被改動而跳過的 ${skipped} 首` : ''));
  for (const c of changes.slice(0, 15)) {
    const sample = c.out.split('\n').find((l, i) => /\]#TITLE#/.test(l) && !/\]#TITLE#/.test(c.lyrics.split('\n')[i] || ''));
    console.log(`  +${c.added}  ${c.artist} / ${c.title}   ${(sample || '').slice(0, 60)}`);
  }
  if (changes.length > 15) console.log(`  … 另外 ${changes.length - 15} 首`);

  if (!APPLY) {
    console.log('\n這是 dry-run,沒有寫入。要套用:node scripts/remark_title_lines.js --apply');
    return db.close();
  }
  if (!changes.length) return db.close();

  fs.copyFileSync(DB, DB + '.bak');
  console.log(`\n已備份到 ${DB}.bak,開始寫入…`);
  db.serialize(() => {
    const stmt = db.prepare('UPDATE cache SET lyrics = ? WHERE artist = ? AND title = ?');
    for (const c of changes) stmt.run(c.out, c.artist, c.title);
    stmt.finalize(() => {
      console.log(`寫入完成:${changes.length} 首。重開 server 或重新載入歌詞就會生效 (記憶體裡的 furiganaCache 是舊的)。`);
      db.close();
    });
  });
});
