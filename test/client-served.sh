#!/usr/bin/env bash
# 真启动验证：客户端半边（设置 → Postman 那一页）是否被宿主编入启动图并正常发出。
#
# 用法： bash test/client-served.sh [port]
#
# 默认跑**源码仓库那份 0.2.0-rc.2**（用户真实在跑的运行时）。
# 覆盖方式见 test/_runtime.sh 顶部注释。
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

HERE="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null)"
[ -n "$HERE" ] || HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_runtime.sh
source "$HERE/_runtime.sh"

PORT="${1:-3098}"
runtime_resolve || exit 1
TMP="$(runtime_dir)"
OUT="$TMP/client-served-$PORT.log"
JAR="$TMP/client-served-$PORT.jar"
INDEX="$TMP/client-served-$PORT.html"
BODY="$TMP/client-served-$PORT.bundle.js"
: > "$JAR"

echo "== 启动 dsh web (port=$PORT) =="
echo "   运行时 = $RT_DESC"
PID=$(start_dsh "$PORT" "$OUT")
echo "   pid=$PID"
READY=$(wait_for_port "$PID" "$PORT" "$OUT")

TOKEN=$(read_token "$OUT")
curl -sL -c "$JAR" -b "$JAR" -o "$INDEX" --noproxy '*' --max-time 10 \
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
  stop_dsh "$PID"
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

stop_dsh "$PID"
echo "READY=$READY FAIL=$FAIL"
exit "$FAIL"
