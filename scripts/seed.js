/**
 * 在本地链上演一段小历史，方便看刻痕志、传承和称号的效果。
 *
 *   npx hardhat run scripts/seed.js --network localhost
 */
const { ethers } = require("hardhat");
const dep = require("../web/deployment.json");

async function main() {
  const dome = await ethers.getContractAt("Observatory", dep.address);
  const signers = await ethers.getSigners();
  const price = await dome.INSCRIPTION_PRICE();

  // signers[1] 是页面的影子钱包，留给用户自己玩
  const cast = signers.slice(2, 10);

  const words = [
    "第一次抬头看见它，是在我母亲走的那年。",
    "献给还没出生的人。",
    "如果你读到这里，说明光还没走完。",
    "我不信永恒，但我信这块石头。",
    "替一个不会用钱包的人刻的。",
    "",
    "买它花掉了我三个月的房租。不后悔。",
    "看完这句就抬头。",
  ];

  console.log("铭刻中…");
  for (let i = 0; i < cast.length; i++) {
    const s = cast[i];
    // 每天只给 2 枚：种数据时每人拾 1–2 枚，够过铭刻的门槛
    await (await dome.connect(s).claimEmbers((i % 2) + 1)).wait();
    await (await dome.connect(s).inscribeConstellation({ value: price })).wait();
    if (words[i]) {
      await (await dome.connect(s).carveWords(10001 + i, words[i])).wait();
    }
  }

  // 一位收藏家把别人的刻位一个个买回来 —— 制造出高阶称号
  const collector = cast[0];
  console.log("收藏家收购刻位…");
  for (const i of [1, 2, 3, 4]) {
    const from = cast[i];
    await (
      await dome
        .connect(from)
        .transferFrom(from.address, collector.address, 10001 + i)
    ).wait();
  }
  // 收藏家在新收来的刻位上留字（前任的字仍在）
  await (await dome.connect(collector).carveWords(10002, "从别人手里接过来的。")).wait();

  const seats = await dome.constellationBalance(collector.address);
  const marks = await dome.chronicleOf(10002);

  console.log(`\n收藏家 ${collector.address} 现持 ${seats} 席`);
  console.log(`第 2 刻的刻痕志共 ${marks.length} 条：`);
  marks.forEach((m, i) =>
    console.log(`  ${i + 1}. ${m.keeper.slice(0, 10)}… 「${m.words || "（未题刻）"}」`)
  );
  console.log(`\n已铭刻 ${await dome.constellationsInscribed()} / 88`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
