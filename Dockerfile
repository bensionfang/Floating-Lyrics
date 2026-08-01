# 雲端唯讀歌詞服務 (Render)。跑的是同一份 server.js,靠 CLOUD_MODE=1 只暴露
# /mobile/* 與 GET /api/lyrics —— 見 server.js 頂端的 CLOUD 那段註解。
# 媒體監控不會啟動 (startMediaMonitor 在非 Windows 上早退)。
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# venv 而不是 pip --break-system-packages:bookworm 有 PEP 668。
# 順帶讓 PATH 上有 `python` —— server.js 找不到 venv/Scripts/python.exe (那是 Windows 路徑)
# 時的 fallback 正好是 'python',所以這裡零程式碼改動就接得起來。
ENV VIRTUAL_ENV=/opt/venv PATH=/opt/venv/bin:$PATH
RUN python3 -m venv $VIRTUAL_ENV

WORKDIR /app

# winrt-* 只有 Windows 有,Linux 上裝不起來。現場過濾而不是維護第二份 requirements ——
# 兩份清單一定會漂,而漏掉的那個套件是在執行期才炸。
COPY requirements.txt ./
RUN grep -v '^winrt' requirements.txt > /tmp/requirements-cloud.txt \
 && pip install --no-cache-dir -r /tmp/requirements-cloud.txt

COPY web-app/package.json web-app/package-lock.json web-app/
RUN cd web-app && npm ci --omit=dev    # electron 是 devDependency,別把 100+ MB 拉進來

COPY . .

ENV CLOUD_MODE=1 NODE_ENV=production
CMD ["node", "web-app/server.js"]
