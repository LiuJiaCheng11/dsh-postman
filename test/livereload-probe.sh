#!/usr/bin/env bash
# 实验：**外部**直接改 profile 的 cordis.patch.yml，运行中的 dsh 会不会热更新插件配置？
#
# 结论（2026-10-10 实测，源码运行时 0.2.0-rc.2）：**不会**。改完等 12 秒，
# 插件仍报旧来源。只有走设置页那条通道（configForms → remote.settings.mutate →
# settings.update → configEditor.edit）才会 reconcileProfilePatches 重载条目。
# 详见 README 的「保存为什么可能不马上生效」。
#
# ⚠️ 这个脚本会**临时修改你的 profile 文件**（默认 ~/.dsh/profiles/web/cordis.patch.yml）。
#    它自带备份 + trap 还原，但仍请确保 dsh 没有正在跑重要任务。
#    必须显式确认才运行：  I_KNOW=1 bash test/livereload-probe.sh
set -u

if [ "${I_KNOW:-0}" != "1" ]; then
  echo "!! 本脚本会临时改动 profile 的 cordis.patch.yml。"
  echo "!! 确认后请这样运行：  I_KNOW=1 bash test/livereload-probe.sh [port]"
  exit 2
fi

PORT="${1:-3093}"
DSH="${2:-E:/software/deepseek-harness/apps/cli/lib/bin.js}"
PROFILE="$HOME/.dsh/profiles/web/cordis.patch.yml"
# 传给 node 的必须是 Windows 风格路径：Git Bash 的 /c/Users/... 会被 node 当成
# 「当前盘符下的相对路径」（变成 E:\c\Users\...）。
PROFILE_WIN="$(cd "$(dirname "$PROFILE")" && pwd -W)/$(basename "$PROFILE")"
ROOT="$(cd "$(dirname "$0")/.." && pwd -W 2>/dev/null || pwd)"
TMP="$ROOT/.tmp"
mkdir -p "$TMP"
OUT="$TMP/livereload-$PORT.log"
JAR="$TMP/livereload-$PORT.jar"
BAK="$TMP/cordis.patch.yml.bak"
: > "$OUT"; : > "$JAR"

cp "$PROFILE" "$BAK"
echo "== 已备份 patch → $BAK =="

restore() {
  cp "$BAK" "$PROFILE"
  echo "== 已还原 patch；校验 dsh-postman 块 =="
  grep -A3 "id: dsh-postman" "$PROFILE" | head -5
}
trap restore EXIT

probe() {
  curl -s -c "$JAR" -b "$JAR" --noproxy '*' --max-time 10 \
    "http://127.0.0.1:$PORT/dsh-postman/api/config" 2>/dev/null
  echo
}

echo "== 启动 dsh web (port=$PORT) =="
env -u NODE_OPTIONS -u CODEBUDDY_MCP_CONFIG node "$DSH" web --port "$PORT" --no-open > "$OUT" 2>&1 &
PID=$!
for i in $(seq 1 40); do
  sleep 1
  if ! kill -0 "$PID" 2>/dev/null; then echo "!! 进程在 ${i}s 时退出"; break; fi
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null)
  if [ "$CODE" != "000" ]; then echo "端口就绪于 ${i}s (HTTP $CODE)"; break; fi
done
TOKEN=$(sed -n 's/.*token=\([A-Za-z0-9_-]*\).*/\1/p' "$OUT" | head -1)
curl -sL -c "$JAR" -b "$JAR" -o /dev/null --noproxy '*' --max-time 8 "http://127.0.0.1:$PORT/?token=$TOKEN" 2>/dev/null

echo "── 基线（启动时）──"
probe

echo "== 临时摘掉 dsh-postman 的 config 块 =="
# 删掉 "id: dsh-postman" 起的三行（id/name/config + apiKey）
grep -v -A0 "" "$PROFILE" > "$TMP/patch.orig" 2>/dev/null || cp "$PROFILE" "$TMP/patch.orig"
env -u NODE_OPTIONS node -e "
const fs=require('fs');
const p=process.argv[1];
const lines=fs.readFileSync(p,'utf8').split('\n');
const out=[];let skip=0;
for(let i=0;i<lines.length;i++){
  if(/^-\s*id:\s*dsh-postman\s*\$/.test(lines[i])){ skip=4; continue }
  if(skip>0){ skip--; continue }
  out.push(lines[i]);
}
fs.writeFileSync(p,out.join('\n'));
console.log('已移除 dsh-postman 块，剩余行数', out.length);
" "$PROFILE_WIN"

echo "== 等 12s（看是否热更新）=="
sleep 12
echo "── 摘掉后（不重启）──"
probe

echo "== 日志里与 reload/patch 相关的行 =="
grep -inE "reload|patch|hmr|watch" "$OUT" | head -15 || echo "(无)"

kill "$PID" 2>/dev/null; sleep 1; kill -9 "$PID" 2>/dev/null
echo "READY done"
