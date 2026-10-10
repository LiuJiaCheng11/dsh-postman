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
  en: Manage Postman cloud collections from dsh, and scan ASP.NET Core controllers to sync API routes into a collection. Zero dependencies.
  zh: 在 dsh 里管理 Postman 云端集合，并可扫描 ASP.NET Core 控制器把接口批量同步进集合。零依赖。
YAML
echo "✓ 市场投稿文件 → ${ENTRY}"

# 3) 设置 git remote
REMOTE="https://github.com/${OWNER}/${REPO}.git"
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE"
  echo "✓ git origin 已更新 → ${REMOTE}"
else
  git remote add origin "$REMOTE"
  echo "✓ git origin 已添加 → ${REMOTE}"
fi

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
