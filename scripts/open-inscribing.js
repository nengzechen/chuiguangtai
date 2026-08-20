/**
 * 开到【铭刻】—— 放开付费层。
 *
 * 这一步之后有人付的就是真钱了，而且阶段只进不退，开了收不回来。
 * 所以它单独成一个脚本，不混在部署流程里：
 * 部署、验证元数据、开免费层、开付费层，是四次独立的决定。
 *
 *   npx hardhat run scripts/open-inscribing.js --network robinhood
 */
const hre = require("hardhat");
const { ethers } = hre;

const NAMES = ["闭台", "拾屑", "铭刻"];

async function main() {
  const dep = require("../web/deployment.json");
  const d = await ethers.getContractAt("Observatory", dep.address);
  const [me] = await ethers.getSigners();

  const before = Number(await d.phase());
  console.log(`合约   : ${dep.address}（chainId ${dep.chainId}）`);
  console.log(`当前   : ${NAMES[before]}`);

  if (before >= 2) {
    console.log("已经在【铭刻】了，无需再开。");
    return;
  }
  if (before < 1) {
    throw new Error("还没开【拾屑】。阶段只能一档一档往上推。");
  }
  if ((await d.owner()) !== me.address) {
    throw new Error(`只有 owner 能推进阶段。当前 owner 是 ${await d.owner()}`);
  }

  const tx = await d.advancePhase(2);
  const r = await tx.wait();
  console.log(`→ 已开到: ${NAMES[Number(await d.phase())]} · ${tx.hash}`);
  console.log(`  gas ${r.gasUsed}`);

  const price = await d.INSCRIPTION_PRICE();
  console.log(`\n付费层已开：0.0088 ETH 一席，或交出 14 枚星屑（22 席）`);
  console.log(`剩余席位: ${await d.CONSTELLATION_SUPPLY() - await d.constellationsInscribed()} / 88`);
  console.log(`献纳流向: ${await d.TREASURY()}`);
  console.log(`\n余额剩 ${ethers.formatEther(await ethers.provider.getBalance(me.address))} ETH`);
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exitCode = 1; });
