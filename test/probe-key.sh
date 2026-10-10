#!/usr/bin/env bash
# 探测：插件在启动时到底有没有读到 cordis.patch.yml 里的 config.apiKey
# （不开 UI 就能排查「Key 到底来自哪一条来源」）
#
# 用法： bash test/probe-key.sh [port]
# 默认跑**源码仓库那份 0.2.0-rc.2**；覆盖方式见 test/_runtime.sh 顶部注释。
set -u

HERE="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null)"
[ -n "$HERE" ] || HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_runtime.sh
source "$HERE/_runtime.sh"

PORT="${1:-3095}"
runtime_resolve || exit 1
TMP="$(runtime_dir)"
OUT="$TMP/probe-$PORT.log"
JAR="$TMP/probe-$PORT.jar"
: > "$JAR"

echo "== 启动 dsh web (port=$PORT) =="
echo "   运行时 = $RT_DESC"
PID=$(start_dsh "$PORT" "$OUT")
echo "   pid=$PID"
READY=$(wait_for_port "$PID" "$PORT" "$OUT")

TOKEN=$(read_token "$OUT")
curl -sL -c "$JAR" -b "$JAR" -o /dev/null --noproxy '*' --max-time 8 \
  "http://127.0.0.1:$PORT/?token=$TOKEN" 2>/dev/null

echo "== GET /dsh-postman/api/config =="
curl -s -c "$JAR" -b "$JAR" --noproxy '*' --max-time 10 \
  "http://127.0.0.1:$PORT/dsh-postman/api/config" 2>/dev/null
echo

echo "== 启动日志里的 dsh-postman 行 =="
grep -i "dsh-postman" "$OUT" | head -10 || echo "(日志里没有 dsh-postman 行)"

stop_dsh "$PID"
echo "READY=$READY"
