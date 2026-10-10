#!/usr/bin/env bash
# 探测：插件在启动时到底有没有读到 cordis.patch.yml 里的 config.apiKey
# 用法： bash test/probe-key.sh [port] [runtime-bin]
set -u

PORT="${1:-3095}"
DSH="${2:-${DSH:-C:/Users/ljc/.dsh/dsh-browser/node_modules/@deepseek-ai/dsh/lib/bin.js}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd -W 2>/dev/null || pwd)"
TMP="$ROOT/.tmp"
mkdir -p "$TMP"
OUT="$TMP/probe-$PORT.log"
JAR="$TMP/probe-$PORT.jar"
: > "$OUT"; : > "$JAR"

echo "== 启动 dsh web (port=$PORT) =="
env -u NODE_OPTIONS -u CODEBUDDY_MCP_CONFIG \
  node "$DSH" web --port "$PORT" --no-open > "$OUT" 2>&1 &
PID=$!
READY=0
for i in $(seq 1 40); do
  sleep 1
  if ! kill -0 "$PID" 2>/dev/null; then echo "!! 进程在 ${i}s 时退出"; break; fi
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null)
  if [ "$CODE" != "000" ]; then READY=1; echo "端口就绪于 ${i}s (HTTP $CODE)"; break; fi
done

TOKEN=$(sed -n 's/.*token=\([A-Za-z0-9_-]*\).*/\1/p' "$OUT" | head -1)
# 先用 token 换 cookie
curl -sL -c "$JAR" -b "$JAR" -o /dev/null --noproxy '*' --max-time 8 \
  "http://127.0.0.1:$PORT/?token=$TOKEN" 2>/dev/null

echo "== GET /dsh-postman/api/config =="
curl -s -c "$JAR" -b "$JAR" --noproxy '*' --max-time 10 \
  "http://127.0.0.1:$PORT/dsh-postman/api/config" 2>/dev/null
echo

echo "== 启动日志里的 dsh-postman 行 =="
grep -i "dsh-postman" "$OUT" | head -10 || echo "(日志里没有 dsh-postman 行)"

kill "$PID" 2>/dev/null; sleep 1; kill -9 "$PID" 2>/dev/null
echo "READY=$READY"
