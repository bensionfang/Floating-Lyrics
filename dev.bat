@echo off
cd /d "%~dp0web-app"

REM 每跑一次就留一份殭屍 server (連帶 media monitor),久了會佔住 5720 讓新的掉到隨機 port
REM —— port 一變 origin 就變,localStorage 整份失憶 (使用說明每次重播就是這個症狀)。
REM 認人的方式是「parent 是 node 的 Kanaric media monitor」而不是比對 `node server.js`:
REM node 的 command line 只有 "node  server.js"、認不出是哪個專案,而 monitor 的 command line
REM 帶著完整的 Kanaric 路徑。砍掉 leaf 的 node,上面的 cmd.exe / npm 會自己收攤。
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$py = Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*Kanaric*pytools.py*' };" ^
  "$nodes = $py | ForEach-Object { $_.ParentProcessId } | Where-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName -eq 'node' } | Select-Object -Unique;" ^
  "$all = @($nodes) + @($py.ProcessId) | Where-Object { $_ };" ^
  "if ($all) { Write-Host ('[dev] 清掉 ' + $all.Count + ' 個殘留進程') -ForegroundColor DarkYellow; $all | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"

call npm run app
