/**
 * 把穹顶灌满 —— 用 88 个独立钱包刻完全部刻位，看售罄时的样子。
 *
 *   npx hardhat run scripts/fill.js --network localhost
 *
 * 只在本地链上跑。真实网络上这件事需要 88 个真人。
 */
const { ethers, network } = require("hardhat");
const dep = require("../web/deployment.json");

const LOCAL = new Set([31337n, 1337n]);

// 随机挑几句留在石壁上，让穹顶看起来像有人真的来过
const VOICES = [
  "第一次抬头看见它，是在我母亲走的那年。",
  "献给还没出生的人。",
  "如果你读到这里，说明光还没走完。",
  "我不信永恒，但我信这块石头。",
  "替一个不会用钱包的人刻的。",
  "买它花掉了我三个月的房租。不后悔。",
  "看完这句就抬头。",
  "给 L。你知道为什么。",
  "我来过，在最后一批人里。",
  "没什么可说的，就是想留个名字。",
  "十年后如果我还在，会回来看一眼。",
  "宇宙不欠我们什么。",
  "把这个位置留给我女儿。",
  "熄灭之前，总要有人记下点什么。",
  "错过了前面八十席，这个刚好。",
  "写给那个劝我别买的人。",
];

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (!LOCAL.has(chainId)) {
    throw new Error(`拒绝执行：只能在本地链上灌满穹顶，当前 chainId=${chainId}`);
  }

  const dome = await ethers.getContractAt("Observatory", dep.address);
  const price = await dome.INSCRIPTION_PRICE();
  const total = Number(await dome.CONSTELLATION_SUPPLY());

  let done = Number(await dome.constellationsInscribed());
  console.log(`当前 ${done} / ${total}，开始灌满…`);

  const fresh = [];
  for (let i = done; i < total; i++) {
    const w = ethers.Wallet.createRandom().connect(ethers.provider);
    await ethers.provider.send("hardhat_setBalance", [
      w.address,
      "0x8AC7230489E80000", // 10 ETH
    ]);
    fresh.push(w);
  }

  for (const [i, w] of fresh.entries()) {
    await (await dome.connect(w).claimEmbers(1)).wait();
    await (await dome.connect(w).inscribeConstellation({ value: price })).wait();

    // 约三分之一的人会留字，剩下的只留一个地址 —— 更像真实的墙
    if (i % 3 === 0) {
      const words = VOICES[(done + i) % VOICES.length];
      await (await dome.connect(w).carveWords(10001 + done + i, words)).wait();
    }

    if ((i + 1) % 20 === 0) console.log(`  …${done + i + 1} / ${total}`);
  }

  // 让一个收藏家从散户手里收席，把高阶称号打出来。
  // COLLECT=0 可以跳过，看纯散户分布的样子。
  const collect = Math.min(
    Number(process.env.COLLECT ?? 16),
    fresh.length
  );
  if (collect < 2) {
    console.log("\n跳过收席（COLLECT < 2）");
    await report(dome, total);
    return;
  }

  const collector = fresh[0];
  console.log(`\n收藏家开始收席（目标 ${collect} 席）…`);
  for (let k = 1; k <= collect - 1; k++) {
    const seller = fresh[k];
    const tokenId = 10001 + done + k;
    await (
      await dome
        .connect(seller)
        .transferFrom(seller.address, collector.address, tokenId)
    ).wait();
  }
  // 在**收来的**那一席上留字：一任只能题一次，收藏家自己那席早就刻过了，
  // 但每一席易主都会给新主人一次全新的机会。
  await (
    await dome
      .connect(collector)
      .carveWords(10001 + done + 1, "我把散落的都收回来了。它们本来就该在一起。")
  ).wait();

  const seats = Number(await dome.constellationBalance(collector.address));
  const title =
    seats >= 16 ? "司天监" : seats >= 8 ? "星域主" : seats >= 4 ? "星官" :
    seats >= 2 ? "巡天者" : "执灯人";
  console.log(`收藏家 ${collector.address}`);
  console.log(`  持 ${seats} 席 —— ${title}`);

  await report(dome, total);
}

async function report(dome, total) {
  console.log(`\n穹顶 ${await dome.constellationsInscribed()} / ${total}`);
  console.log(`星屑 ${await dome.embersDrifted()} / ${await dome.EMBER_SUPPLY()}`);
  console.log(`合约结余 ${ethers.formatEther(
    await ethers.provider.getBalance(dep.address)
  )} ETH`);
  console.log(`network: ${network.name}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
