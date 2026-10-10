#!/usr/bin/env bash
# 测试脚本共用的「运行时选择 + 起实例 + 取 token」小工具。
#
# 默认运行时 = **用户真实在跑的那份源码**（E:/software/deepseek-harness，
# 0.2.0-rc.2），启动命令与用户手敲的一致：
#
#   node --expose-internals --import tsx/esm apps/cli/src/bin.ts web
#
# 为什么默认它：之前的默认是 `~/.dsh/dsh-browser/node_modules/@deepseek-ai/dsh`
# （0.1.1-rc.1，且是被别的包带下来的传递依赖）。那是**已安装的旧版**，能力不同
# （没有 configForms / settings.section），拿它当默认会把结论带偏。
#
# 覆盖方式（做兼容性回归时用）：
#   DSH_SRC=/path/to/repo                      改源码仓库位置
#   DSH_CMD="node /path/to/lib/bin.js"         直接指定完整启动命令前缀
#   DSH="C:/path/to/lib/bin.js"                简写，等价于 DSH_CMD="node $DSH"
#
# 用法：
#   source "$(dirname "$0")/_runtime.sh"
#   PID=$(start_dsh "$PORT" "$OUT")
#   wait_for_port "$PID" "$PORT" "$OUT"
#   TOKEN=$(read_token "$OUT")

# curl 在 Windows 上是原生二进制，写不了 Git Bash 的 /tmp —— 统一用项目内 .tmp。
_rt_root() { cd "$(dirname "${BASH_SOURCE[0]}")/.." && (pwd -W 2>/dev/null || pwd); }

runtime_dir() {
  local d
  d="$(_rt_root)/.tmp"
  mkdir -p "$d"
  printf '%s' "$d"
}

# 把运行时选择解析成 RT_CMD / RT_CWD / RT_DESC 三个变量。
runtime_resolve() {
  RT_SRC="${DSH_SRC:-E:/software/deepseek-harness}"
  if [ -n "${DSH_CMD:-}" ]; then
    RT_CMD="$DSH_CMD"
    RT_CWD="${DSH_CWD:-$PWD}"
    RT_DESC="自定义命令：$RT_CMD"
  elif [ -n "${DSH:-}" ]; then
    RT_CMD="node $DSH"
    RT_CWD="${DSH_CWD:-$PWD}"
    RT_DESC="指定入口：$DSH"
  else
    RT_CMD="node --expose-internals --import tsx/esm apps/cli/src/bin.ts"
    RT_CWD="$RT_SRC"
    RT_DESC="源码仓库 $RT_SRC（0.2.0-rc.2，主目标运行时）"
  fi
  if [ ! -d "$RT_CWD" ]; then
    echo "!! 运行时工作目录不存在：$RT_CWD（用 DSH_SRC / DSH_CWD 覆盖）" >&2
    return 1
  fi
}

# 起一个 dsh web 实例，回显 PID。日志写进 $2。
start_dsh() {
  local port="$1" out="$2"
  : > "$out"
  (
    cd "$RT_CWD" || exit 1
    # WorkBuddy 会注入 NODE_OPTIONS / CODEBUDDY_MCP_CONFIG，会污染 dsh 的启动
    exec env -u NODE_OPTIONS -u CODEBUDDY_MCP_CONFIG \
      $RT_CMD web --port "$port" --no-open
  ) > "$out" 2>&1 &
  echo $!
}

# 轮询等实例真正就绪。**判据是日志里出现 token 那一行**，不是「端口有响应」——
# 实测端口会先被占住并返回 404/401，此时 dsh 还没打印访问地址，拿去换 cookie 必失败。
# 进程提前退出则立刻返回。回显 1/0 表示 READY。
wait_for_port() {
  local pid="$1" port="$2" out="$3" i
  for i in $(seq 1 60); do
    sleep 1
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "!! 进程在 ${i}s 时退出，日志尾部：" >&2
      tail -20 "$out" >&2
      echo 0
      return 0
    fi
    if [ -n "$(read_token "$out")" ]; then
      echo "实例就绪于 ${i}s（日志已给出 token）" >&2
      echo 1
      return 0
    fi
  done
  echo "!! 60s 内未见 token，日志尾部：" >&2
  tail -20 "$out" >&2
  echo 0
}

read_token() {
  sed -n 's/.*token=\([A-Za-z0-9_-]*\).*/\1/p' "$1" | head -1
}

stop_dsh() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill "$pid" 2>/dev/null
  sleep 1
  kill -9 "$pid" 2>/dev/null
  return 0
}
