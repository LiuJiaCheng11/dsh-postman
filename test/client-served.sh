#!/usr/bin/env bash
# 真启动验证：客户端半边（设置 → Postman 那一页）是否被宿主编入启动图并正常发出。
#
# 用法： bash test/client-served.sh [port] [runtime-bin]
#   DSH 环境变量可覆盖运行时入口。
#
# 为什么需要它：
#   `dsh.client` + `exports["./client"]` 的接线错了，宿主**不会报错**——表现是
#   设置里那一页凭空消失。`test/client-bundle.js` 只测文件本身，测不到
#   「宿主有没有把它编进启动图」，所以这里真起一个实例，从 index.html 里读出
#   该插件的 bundle 地址再取回来校验。
#
# 两个运行时的 URL 格式不同，都要认：
#   0.2.x（源码仓库）： /plugins/??dsh-postman/client.js&rev=<rev>        （combo）
#   0.1.x（已安装）  ： /plugins/dsh-postman/client.js?rev=<rev>          （单资源）
set -u

PORT="${1:-3099}"
DSH="${2:-${DSH:-C:/Users/ljc/.dsh/dsh-browser/node_modules/@deepseek-ai/dsh/lib/bin.js}}"

# curl 在 Windows 上是原生二进制，写不了 Git Bash 的 /tmp —— 用项目内的临时目录。
# 注意 `pwd -W`：Git Bash 的 `pwd` 返回 `/e/Code/...`，传给 node 会被当成
# 「当前盘符下的相对路径」（变成 E:\e\Code\...）。`-W` 给出 Windows 风格路径。
ROOT="$(cd "$(dirname "$0")/.." && pwd -W 2>/dev/null || pwd)"
TMP="$ROOT/.tmp"
mkdir -p "$TMP"
OUT="$TMP/client-served-$PORT.log"
JAR="$TMP/client-served-$PORT.jar"
INDEX="$TMP/client-served-$PORT.html"
BODY="$TMP/client-served-$PORT.bundle.js"
: > "$OUT"; : > "$JAR"

echo "== 启动 dsh web (port=$PORT) =="
echo "   runtime = $DSH"
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
curl -sL -c "$JAR" -b "$JAR" -o "$INDEX" --noproxy '*' --max-time 8 \
  "http://127.0.0.1:$PORT/?token=$TOKEN" 2>/dev/null
echo "   index.html = $(wc -c < "$INDEX")B"

echo "== 从启动图里找 dsh-postman 的 client bundle =="
URL=$(env -u NODE_OPTIONS node -e "
const fs = require('fs')
const html = fs.readFileSync(process.argv[1], 'utf8')
// 启动图里的地址是文档相对的（没有前导斜杠），<script src> 里则带斜杠 —— 两种都认。
const combo = html.match(/\/?plugins\/\?\?dsh-postman\/client\.js&rev=[0-9a-f]+/)
const single = html.match(/\/?plugins\/dsh-postman\/client\.js\?rev=[0-9a-f]+/)
const found = (combo || single || [''])[0]
console.log(found.startsWith('/') ? found : '/' + found)
" "$INDEX")

if [ -z "$URL" ]; then
  echo "!! 启动图里没有 dsh-postman 的 client bundle —— 检查 package.json 的 dsh.client 与 exports[\"./client\"]"
  echo "== 日志尾部 =="
  tail -20 "$OUT"
  kill "$PID" 2>/dev/null; sleep 1; kill -9 "$PID" 2>/dev/null
  exit 1
fi
echo "   URL = $URL"

CODE=$(curl -s -c "$JAR" -b "$JAR" -o "$BODY" -w '%{http_code}' --noproxy '*' --max-time 8 \
  "http://127.0.0.1:$PORT$URL" 2>/dev/null)
SIZE=$(wc -c < "$BODY")
echo "   HTTP $CODE  ${SIZE}B"

FAIL=0
[ "$CODE" = "200" ] || { echo "!! 期望 HTTP 200"; FAIL=1; }
[ "$SIZE" -gt 1000 ] || { echo "!! bundle 太小（$SIZE B），像是错误页"; FAIL=1; }
grep -q '__ModuleLoader__' "$BODY" || { echo "!! bundle 里没有 __ModuleLoader__.load 包装"; FAIL=1; }
grep -q "id: *'dsh-postman'" "$BODY" || { echo "!! bundle 的注册 id 不是 dsh-postman"; FAIL=1; }
grep -q 'settings.section' "$BODY" || { echo "!! bundle 里没有 settings.section 注册"; FAIL=1; }
[ "$FAIL" = "0" ] && echo "   ✓ 包装 / 注册 id / settings.section 均正确"

echo "== 检查致命报错 =="
if grep -qiE 'failed to apply|unsupported JSON schema|Cannot find module' "$OUT"; then
  echo "!! 日志中发现疑似错误："
  grep -inE 'failed to apply|unsupported JSON schema|Cannot find module' "$OUT" | head -10
  FAIL=1
else
  echo "OK：未见致命报错"
fi

kill "$PID" 2>/dev/null; sleep 1; kill -9 "$PID" 2>/dev/null
echo "READY=$READY FAIL=$FAIL"
exit "$FAIL"
