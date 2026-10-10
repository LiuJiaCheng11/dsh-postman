#!/usr/bin/env bash
# 一键准备发布：填好 package.json 里的仓库地址，并生成 dsh 插件市场的投稿文件。
#
# 用法：
#   bash scripts/setup-publish.sh <github-username>
#
# 做完之后你只需要：建空仓库 → push → npm publish → 把 marketplace/*.yml 提到 awesome-dsh-plugin
set -euo pipefail

OWNER="${1:-}"
if [ -z "$OWNER" ]; then
  echo "用法: bash scripts/setup-publish.sh <github-username>" >&2
  exit 1
fi

REPO="dsh-postman"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 1) 替换 package.json 里的占位符
if grep -q 'USERNAME' package.json; then
  sed -i "s|github\.com/USERNAME/|github.com/${OWNER}/|g" package.json
  echo "✓ package.json 仓库地址 → github.com/${OWNER}/${REPO}"
else
  echo "· package.json 里已无 USERNAME 占位符，跳过"
fi

# 2) 生成市场投稿文件 data/plugins/<owner>__<repo>.yml 的本地副本
mkdir -p marketplace
ENTRY="marketplace/${OWNER}__${REPO}.yml"
cat > "$ENTRY" <<YAML
url: https://github.com/${OWNER}/${REPO}
name: ${OWNER}/${REPO}
category: tools
description:
  en: Manage Postman cloud collections from dsh with 9 tools — list, browse, add one or many requests, edit and delete them, and export or overwrite a whole collection.
  zh: 用 9 个工具在 dsh 里管理 Postman 云端集合——列出、浏览、新增（单个或批量）、修改、删除接口，导出或整体覆盖集合。
YAML
echo "✓ 市场投稿文件 → ${ENTRY}"

# 3) 设置 git remote —— 不覆盖已经指向同一仓库的 remote
#    （很多人用 SSH（git@github.com:...）推送，直接改成 HTTPS 会打断他们的推送方式）
WANTED_PATH="${OWNER}/${REPO}"
EXISTING="$(git remote get-url origin 2>/dev/null || true)"
case "$EXISTING" in
  "")
    git remote add origin "https://github.com/${WANTED_PATH}.git"
    echo "✓ git origin 已添加 → https://github.com/${WANTED_PATH}.git"
    ;;
  *"${WANTED_PATH}"*)
    echo "· git origin 已指向 ${WANTED_PATH}，保持不变 → ${EXISTING}"
    ;;
  *)
    git remote set-url origin "https://github.com/${WANTED_PATH}.git"
    echo "✓ git origin 已更新 → https://github.com/${WANTED_PATH}.git（原为 ${EXISTING}）"
    ;;
esac

cat <<NEXT

接下来（手动四步）：
  1. 在 GitHub 建一个空仓库 ${OWNER}/${REPO}
     （不要勾 README / .gitignore / LICENSE）
  2. git add -A && git commit -m "chore: 填写仓库地址" && git push -u origin main
  3. npm login && npm publish
  4. Fork awesome-dsh-plugin/awesome-dsh-plugin，
     把 ${ENTRY} 复制到它的 data/plugins/ 目录下，提 PR

别忘了给 GitHub 仓库加上 Topics：dsh, dsh-plugin, deepseek-harness, postman
NEXT
