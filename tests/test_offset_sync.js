// 歌詞 offset 的跨頁共用行為：快速切歌不能互相取消或存錯歌曲。
const assert = require('assert');

let api = {};
try { api = require('../web-app/public/js/offset-sync.js'); } catch (e) {}

assert.strictEqual(typeof api.offsetSongKey, 'function', '缺少歌曲身分函式');
assert.strictEqual(typeof api.createOffsetSaver, 'function', '缺少逐歌延遲儲存器');

const { offsetSongKey, createOffsetSaver } = api;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    assert.strictEqual(offsetSongKey('Song', 'Artist'), 'Artist|||Song');

    const sent = [];
    const save = createOffsetSaver(payload => sent.push(payload), 5);
    save('A', 'Singer', 0.1);
    save('A', 'Singer', 0.2);       // 同一首只留最後一次
    save('B', 'Singer', -0.1);      // 不同首不能取消 A
    save('A', 'Other', 0.3);        // 同歌名、不同歌手也是另一首
    save('', 'Singer', 9);          // 沒歌名不送

    await wait(30);
    sent.sort((a, b) => `${a.artist}|${a.title}`.localeCompare(`${b.artist}|${b.title}`));
    assert.deepStrictEqual(sent, [
        { title: 'A', artist: 'Other', offset: 0.3 },
        { title: 'A', artist: 'Singer', offset: 0.2 },
        { title: 'B', artist: 'Singer', offset: -0.1 },
    ]);

    console.log('test_offset_sync: OK');
})().catch((e) => { console.error(e); process.exitCode = 1; });
