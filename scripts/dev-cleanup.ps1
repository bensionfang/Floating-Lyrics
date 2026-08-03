# 啟動前清掉殘留的 Kanaric server 與 media monitor。
#
# 每跑一次 dev.bat 就留一份殭屍 server (連帶 media monitor),久了會佔住 5720 讓新的掉到
# 隨機 port —— port 一變 origin 就變,localStorage 整份失憶 (使用說明每次重播就是這個症狀)。
#
# 認人的方式是「Kanaric media monitor 的 parent」而不是比對 `node server.js`:
# node 的 command line 只有 "node  server.js"、認不出是哪個專案,而 monitor 的 command line
# 帶著完整的 Kanaric 路徑。砍掉那個 parent,上面的 cmd.exe / npm 會自己收攤。
#
# **parent 要同時認 node 與 electron。** dev.bat 跑的是 `npm run app` (Electron 殼),
# 那時 pytools 的 parent 是 electron.exe、佔著 5720 的也是它 —— 只認 node 的話會變成
# 「python 被殺掉、真正的殭屍 server 留著」,完全反效果。純 node 的 `npm start` 才是 node。
# (這條在 dev.bat 修好之前從來沒有真的執行過,所以之前看不出來。)
#
# **這段刻意不放在 dev.bat 裡。** 它原本用 cmd 的 `^` 行接續寫成一行,那有兩個坑:
#   1. `^` 續行要求檔案是 CRLF,LF-only 會把續行拆散、後面的註解片段當成指令跑
#      (症狀:exit 255 + 幾行「'xxx' 不是內部或外部命令」)。
#   2. 就算修成 CRLF,cmd 仍然用系統字碼頁讀批次檔,UTF-8 的中文註解會被誤解碼,
#      多位元組字的殘餘位元組把後面的 ASCII 吃掉 —— `chcp 65001` 也救不回來。
# 搬到 .ps1 之後 dev.bat 只剩純 ASCII,兩個坑同時消失。

$py = Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -like '*Kanaric*pytools.py*' }
$nodes = $py | ForEach-Object { $_.ParentProcessId } |
    Where-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName -in @('node', 'electron') } |
    Select-Object -Unique
$all = @($nodes) + @($py.ProcessId) | Where-Object { $_ }
if ($all) {
    # Write-Output 不是 Write-Host:後者寫的是 console host,dev.bat 的輸出被重導向到檔案時
    # 整行會消失,除錯時看起來像「清理沒有執行」。
    Write-Output ("[dev] 清掉 " + $all.Count + " 個殘留進程")
    $all | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}
