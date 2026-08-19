/**
 * 回读垂光台的链上状态，含 OpenSea 索引依赖的全部字段。
 *
 *   npx hardhat run scripts/inspect.js --network localhost
 */
const { ethers } = require("hardhat");
const dep = require("../web/deployment.json");

const CON = 10000;

const PHASES = ["闭台 Sealed", "拾屑 Drifting", "铭刻 Inscribing"];
const TIERS = ["None", "Ember 星屑", "Constellation 星座"];

async function main() {
  const dome = await ethers.getContractAt("Observatory", dep.address);

  console.log("address     :", dep.address);
  console.log("name/symbol :", await dome.name(), "/", await dome.symbol());
  console.log("phase       :", PHASES[Number(await dome.phase())]);
  console.log("contractURI :", await dome.contractURI());

  const drifted = await dome.embersDrifted();
  const inscribed = await dome.constellationsInscribed();
  console.log(
    "星屑        :",
    `${drifted} / ${await dome.EMBER_SUPPLY()}`,
    `· 每人 ${await dome.EMBER_PER_WALLET()} · 免费`
  );
  console.log(
    "星座        :",
    `${inscribed} / ${await dome.CONSTELLATION_SUPPLY()}`,
    `· 每人 ${await dome.CONSTELLATION_PER_WALLET()} ·`,
    ethers.formatEther(await dome.INSCRIPTION_PRICE()),
    "ETH"
  );

  if (drifted > 0n) {
    console.log("tokenURI(1) :", await dome.tokenURI(1), `[${TIERS[Number(await dome.tierOf(1))]}]`);
    console.log("ownerOf(1)  :", await dome.ownerOf(1));
  }
  if (inscribed > 0n) {
    console.log("tokenURI(10001):", await dome.tokenURI(10001), `[${TIERS[Number(await dome.tierOf(10001))]}]`);
    console.log("ownerOf(10001) :", await dome.ownerOf(10001));
  }

  const [receiver, amount] = await dome.royaltyInfo(10001, ethers.parseEther("1"));
  console.log(
    "royalty     :",
    ethers.formatEther(amount),
    "ETH per 1 ETH sale ->",
    receiver
  );

  console.log(
    "interfaces  : ERC721",
    await dome.supportsInterface("0x80ac58cd"),
    "| ERC721Metadata",
    await dome.supportsInterface("0x5b5e139f"),
    "| ERC2981",
    await dome.supportsInterface("0x2a55205a")
  );

  console.log(
    "proceeds    :",
    ethers.formatEther(await ethers.provider.getBalance(dep.address)),
    "ETH held by the contract"
  );

  // ── 穹顶的人口结构：谁持有多少、留了几句话
  const owners = Array.from(await dome.seatOwners());
  if (!owners.length) return;

  const byAddr = new Map();
  owners.forEach((o) => byAddr.set(o, (byAddr.get(o) || 0) + 1));

  const RANKS = [
    [16, "司天监"], [8, "星域主"], [4, "星官"], [2, "巡天者"], [1, "执灯人"],
  ];
  const tally = {};
  for (const n of byAddr.values()) {
    const r = RANKS.find(([m]) => n >= m)[1];
    tally[r] = (tally[r] || 0) + 1;
  }

  console.log("\n── 穹顶人口 ──");
  console.log("持有者      :", byAddr.size, "人 ·", owners.length, "席");
  for (const [, name] of RANKS) {
    if (tally[name]) console.log(`  ${name.padEnd(4)} ${String(tally[name]).padStart(3)} 人`);
  }

  // ── 刻痕志：转手与题刻
  let hands = 0;
  let carved = 0;
  let longest = { n: 0, words: "" };
  for (let i = 1; i <= owners.length; i++) {
    const marks = Array.from(await dome.chronicleOf(CON + i));
    hands += marks.length - 1; // 第一条是铭刻，不算转手
    for (const m of marks) {
      if (!m.words) continue;
      carved++;
      if (m.words.length > longest.words.length) longest = { n: i, words: m.words };
    }
  }

  console.log("\n── 刻痕志 ──");
  console.log("转手次数    :", hands);
  console.log("题刻条数    :", carved);
  if (longest.words) {
    console.log(`最长的一句  : 第 ${longest.n} 刻 「${longest.words}」`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
