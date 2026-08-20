#!/usr/bin/env bash
#
# 把 web/ 发到 gh-pages。
#
# 不用 `git subtree push`：历史被 filter-repo 改写过之后，它会拿改写前的
# 映射缓存，于是报 "Everything up-to-date" 而线上其实是旧的 ——
# 不报错、不留痕，只有去 diff 两边的树才看得出来。踩过一次。
#
# 这里直接拿 main 里 web/ 的那棵树造一个提交推上去，结果是确定的。
set -euo pipefail
cd "$(dirname "$0")/.."

git diff --quiet || { echo "工作区有未提交的改动，先 commit"; exit 1; }

TREE=$(git rev-parse main:web)
COMMIT=$(git commit-tree "$TREE" -p gh-pages -m "发布 $(git rev-parse --short main)")
git update-ref refs/heads/gh-pages "$COMMIT"
git push --force origin gh-pages

if git diff --quiet main:web gh-pages; then
  echo "✓ gh-pages 和 main:web 完全一致"
else
  echo "✗ 两边对不上，检查一下"; exit 1
fi
