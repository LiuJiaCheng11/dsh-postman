#!/usr/bin/env bash
# 真启动验证：在空闲端口起一个 dsh web 实例，确认 dsh-postman 插件能加载且不崩。
# 用法： bash test/realstart.sh [port]
# 环境变量 DSH 可覆盖运行时入口（默认已安装版；源码版见下方注释）。
set -u
PORT="${1:-3099}"
# 默认用「已安装运行时」；想测源码仓库版：
#   DSH="E:/software/deepseek-harness/apps/cli/lib/bin.js" bash test/realstart.sh
DSH="${DSH:-C:/Users/ljc/.dsh/dsh-browser/node_modules/@deepseek-ai/dsh/lib/bin.js}"
OUT="/tmp/dsh-postman-realstart.log"
: > "$OUT"

echo "== 启动 dsh web (port=$PORT) =="
echo "   runtime = $DSH"
env -u NODE_OPTIONS -u CODEBUDDY_MCP_CONFIG \
  node "$DSH" web --port "$PORT" --no-open > "$OUT" 2>&1 &
PID=$!
echo "pid=$PID"

# 轮询等待端口就绪（最多 40s）
READY=0
for i in $(seq 1 40); do
  sleep 1
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "!! 进程在 ${i}s 时退出"
    break
  fi
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null)
  if [ "$CODE" != "000" ]; then READY=1; echo "端口就绪于 ${i}s (HTTP $CODE)"; break; fi
done

# 从启动日志里取访问 token
TOKEN=$(sed -n 's/.*token=\([A-Za-z0-9_-]*\).*/\1/p' "$OUT" | head -1)
echo "token=${TOKEN:0:8}..."

echo "== 启动日志（尾部 40 行）=="
tail -40 "$OUT"

echo "== 路由探测（带 token + cookie）=="
JAR="/tmp/dsh-postman-cookies.txt"
: > "$JAR"
# 先访问 /?token=... 让实例下发会话 cookie
curl -s -c "$JAR" -b "$JAR" -o /dev/null --noproxy '*' --max-time 5 \
  "http://127.0.0.1:$PORT/?token=$TOKEN" 2>/dev/null
echo "  cookie 数: $(grep -c . "$JAR" 2>/dev/null)"
for P in "/" "/dsh-postman" "/dsh-postman/api/config" "/__no_such_route__"; do
  C=$(curl -s -c "$JAR" -b "$JAR" -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 5 "http://127.0.0.1:$PORT$P" 2>/dev/null)
  S=$(curl -s -c "$JAR" -b "$JAR" --noproxy '*' --max-time 5 "http://127.0.0.1:$PORT$P" 2>/dev/null | wc -c)
  echo "  $P -> HTTP $C (${S}B)"
done
echo "  对照：/__no_such_route__ 若为 404，则 /dsh-postman 的 401 说明路由已注册（仅被鉴权拦）"

echo "== 检查致命报错 =="
if grep -qiE 'failed to apply|unsupported JSON schema|Cannot find module|Error:' "$OUT"; then
  echo "!! 日志中发现疑似错误："
  grep -inE 'failed to apply|unsupported JSON schema|Cannot find module|Error:' "$OUT" | head -10
else
  echo "OK：未见致命报错"
fi

echo "== 收尾 =="
kill "$PID" 2>/dev/null
sleep 1
kill -9 "$PID" 2>/dev/null
echo "READY=$READY"
