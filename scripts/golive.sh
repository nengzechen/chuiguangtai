#!/usr/bin/env bash
#
# 从"部署钱包有 gas"到"站上能 mint"的全部步骤，一条命令。
#
#   ./scripts/golive.sh testnet      # 部署到 Robinhood 测试网
#   ./scripts/golive.sh mainnet      # 部署到主网（会先让你确认）
#
# 做的事，按顺序：
#   1. 部署合约（献纳收款地址写死在里面，不经过部署者）
#   2. 用线上域名重新生成元数据和分享页
#   3. 打内容指纹，跑测试和上线闸
#   4. 把 web/ 发到 gh-pages
set -euo pipefail
cd "$(dirname "$0")/.."

# 两行分开写：`export A=1 B=$A` 里的 $A 取的是**旧**值，
# 一行连写会让 BASE 变成 "/metadata/"，元数据里的图片地址全成相对路径。
SITE="https://nengzechen.github.io/chuiguangtai"
export SITE
export BASE="${SITE}/metadata/"

case "${1:-}" in
  testnet) NET=robinhoodTestnet ;;
  mainnet) NET=robinhood ;;
  *) echo "用法：$0 testnet|mainnet"; exit 1 ;;
esac

echo "══ 1/4 部署合约到 $NET"
npx hardhat run scripts/whoami.js --network "$NET"

if [ "$NET" = "robinhood" ]; then
  echo
  echo "这是**主网**，花的是真钱，合约地址和金库一旦部署就改不了。"
  read -r -p "确认继续？输入 yes：" ok
  [ "$ok" = "yes" ] || { echo "已取消"; exit 1; }
fi

npx hardhat run scripts/deploy.js --network "$NET"

echo
echo "══ 2/4 用线上域名重新生成元数据与分享页"
npm run metadata
npm run site

echo
echo "══ 3/4 指纹、字体、测试、上线闸"
npm run font
npm run stamp
npm run smoke
npm run preflight

echo
echo "══ 4/4 发布"
git add -A
git commit -m "上线 $NET：合约已部署，站点地址与元数据同步" || echo "（没有新改动要提交）"
git push origin main
git subtree push --prefix web origin gh-pages

echo
echo "完成。$SITE/"
echo "主网记得确认元数据无误后再 advancePhase(1) → advancePhase(2)。"
