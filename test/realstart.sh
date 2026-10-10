#!/usr/bin/env bash
# 真启动验证：在空闲端口起一个 dsh web 实例，确认 dsh-postman 插件能加载、不崩，
# 且路由（含客户端 bundle）都被宿主接上。
#
# 用法： bash test/realstart.sh [port]
#
# 默认跑**源码仓库那份 0.2.0-rc.2**（用户真实在跑的运行时）。
# 覆盖方式见 test/_runtime.sh 顶部注释，例如：
#   DSH="C:/Users/ljc/.dsh/dsh-browser/node_modules/@deepseek-ai/dsh/lib/bin.js" bash test/realstart.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null)"
[ -n "$HERE" ] || HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_runtime.sh
source "$HERE/_runtime.sh"

PORT="${1:-3099}"
runtime_resolve || exit 1
TMP="$(runtime_dir)"
OUT="$TMP/realstart-$PORT.log"
JAR="$TMP/realstart-$PORT.jar"
INDEX="$TMP/realstart-$PORT.html"
: > "$JAR"

echo "== 启动 dsh web (port=$PORT) =="
echo "   运行时 = $RT_DESC"
PID=$(start_dsh "$PORT" "$OUT")
echo "   pid=$PID"
READY=$(wait_for_port "$PID" "$PORT" "$OUT")

TOKEN=$(read_token "$OUT")
echo "   token=${TOKEN:0:8}..."

echo "== 启动日志（尾部 30 行）=="
tail -30 "$OUT"

echo "== 路由探测（带 token + cookie）=="
curl -sL -c "$JAR" -b "$JAR" -o "$INDEX" --noproxy '*' --max-time 8 \
  "http://127.0.0.1:$PORT/?token=$TOKEN" 2>/dev/null
echo "  index.html = $(wc -c < "$INDEX")B  cookie 数 = $(grep -c . "$JAR" 2>/dev/null)"
for P in "/dsh-postman" "/dsh-postman/api/config" "/__no_such_route__"; do
  C=$(curl -s -c "$JAR" -b "$JAR" -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 5 "http://127.0.0.1:$PORT$P" 2>/dev/null)
  S=$(curl -s -c "$JAR" -b "$JAR" --noproxy '*' --max-time 5 "http://127.0.0.1:$PORT$P" 2>/dev/null | wc -c)
  echo "  $P -> HTTP $C (${S}B)"
done
echo "  对照：/__no_such_route__ 若为 404，则 /dsh-postman 的 401 说明路由已注册（仅被鉴权拦）"

echo "== 客户端 bundle 是否在启动图里 =="
URL=$(env -u NODE_OPTIONS node -e "
const fs = require('fs')
const html = fs.readFileSync(process.argv[1], 'utf8')
// 启动图里的地址是文档相对的（没有前导斜杠），<script src> 里则带斜杠 —— 两种都认。
const combo = html.match(/\/?plugins\/\?\?dsh-postman\/client\.js&rev=[0-9a-f]+/)
const single = html.match(/\/?plugins\/dsh-postman\/client\.js\?rev=[0-9a-f]+/)
const found = (combo || single || [''])[0]
console.log(found.startsWith('/') ? found : '/' + found)
" "$INDEX" 2>/dev/null)
if [ -n "$URL" ]; then
  BODY="$TMP/realstart-$PORT.bundle.js"
  CODE=$(curl -s -c "$JAR" -b "$JAR" -o "$BODY" -w '%{http_code}' --noproxy '*' --max-time 8 \
    "http://127.0.0.1:$PORT$URL" 2>/dev/null)
  echo "  $URL -> HTTP $CODE ($(wc -c < "$BODY")B)"
else
  echo "  !! 启动图里没有 dsh-postman 的 client bundle"
fi

echo "== 检查致命报错 =="
if grep -qiE 'failed to apply|unsupported JSON schema|Cannot find module|Error:' "$OUT"; then
  echo "!! 日志中发现疑似错误："
  grep -inE 'failed to apply|unsupported JSON schema|Cannot find module|Error:' "$OUT" | head -10
else
  echo "OK：未见致命报错"
fi

echo "== 收尾 =="
stop_dsh "$PID"
echo "READY=$READY"
