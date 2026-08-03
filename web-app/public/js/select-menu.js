/**
 * 設定選單裡的下拉選單 (select.menu-select) 換成自己畫的彈出清單。
 *
 * 理由只有一個:**原生 select 的彈窗是瀏覽器畫的,選項的 hover 底色改不了** ——
 * Chromium 要到 135 才有 `appearance: base-select` + `::picker(select)`,而打包用的
 * Electron 33 是 Chromium 130。要讓 hover 是專案的綠色 (--accent-main) 就只能自己畫。
 *
 * 做法刻意是「攔開啟」而不是「換掉控制項」:**<select> 本身留著,關起來的樣子照舊**
 * (寬度、字級全都吃現有的 .menu-select 那幾條 CSS,一條都不用改),只在
 * mousedown 時 preventDefault 擋掉原生彈窗,改開我們的 .sel-pop。選了就寫回 select.value
 * 並補發 change —— 所有既有的 onchange 處理器 (saveSettingsToServer…) 完全不用動。
 *
 * 彈窗是 position: fixed,不會被選單面板的 overflow 裁掉;高度上限交給 CSS,長清單
 * (選項多的時候) 自己捲。
 */
(function () {
    let pop = null;
    let openFor = null;

    function close() {
        if (pop) pop.remove();
        pop = null;
        openFor = null;
    }

    function open(sel) {
        close();
        if (!sel.options.length) return;

        pop = document.createElement('div');
        pop.className = 'sel-pop';
        pop.setAttribute('role', 'listbox');
        [...sel.options].forEach((o, i) => {
            const item = document.createElement('div');
            item.className = 'sel-pop-item' + (i === sel.selectedIndex ? ' is-sel' : '');
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', i === sel.selectedIndex ? 'true' : 'false');
            item.textContent = o.textContent;
            item.title = o.textContent;   // 長模型名會被截斷,滑上去看得到全名
            item.addEventListener('click', () => {
                if (sel.selectedIndex !== i) {
                    sel.selectedIndex = i;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                }
                close();
            });
            pop.appendChild(item);
        });
        document.body.appendChild(pop);

        // 定位:預設開在下方,下面放不下且上面比較寬就往上翻。左緣對齊 select,超出右邊界才往回收。
        const r = sel.getBoundingClientRect();
        pop.style.minWidth = r.width + 'px';
        const h = pop.offsetHeight;
        const below = window.innerHeight - r.bottom;
        pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
        pop.style.top = (below >= h + 8 || below >= r.top ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + 'px';

        openFor = sel;
        const cur = pop.querySelector('.is-sel');
        if (cur) cur.scrollIntoView({ block: 'nearest' });
    }

    // 捕獲階段:要在瀏覽器決定要不要開原生彈窗之前擋下來
    document.addEventListener('mousedown', (e) => {
        const sel = e.target.closest ? e.target.closest('select.menu-select') : null;
        if (sel) {
            e.preventDefault();          // 擋掉原生彈窗 (連帶不會 focus,無妨)
            if (openFor === sel) close(); else open(sel);
            return;
        }
        if (pop && !e.target.closest('.sel-pop')) close();
    }, true);

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    // 位置是開啟當下算的,版面一動就不準 —— 與其追著重算,不如關掉。
    // **但只認「會讓這個 select 移動」的捲動** (它自己的祖先或整頁):歌詞區每幾秒就自動捲一次,
    // 捕獲階段的 scroll 收得到,一律關掉的話設定選單的下拉根本開不起來。
    window.addEventListener('resize', close);
    window.addEventListener('scroll', (e) => {
        if (!openFor) return;
        const t = e.target;
        if (t === document || t === document.documentElement || (t.contains && t.contains(openFor))) close();
    }, true);
})();
