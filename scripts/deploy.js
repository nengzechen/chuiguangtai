/**
 * 部署垂光台，并把地址 + ABI 写进 web/deployment.json 供 mint 页面读取。
 *
 *   npx hardhat run scripts/deploy.js --network localhost
 *   npx hardhat run scripts/deploy.js --network robinhoodTestnet
 *   npx hardhat run scripts/deploy.js --network robinhood
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers, network } = hre;

const EXPLORERS = {
  robinhood: "https://robinhoodchain.blockscout.com",
  robinhoodTestnet: "https://explorer.testnet.chain.robinhood.com",
};

const PHASE = { Sealed: 0, Drifting: 1, Inscribing: 2 };

async function main() {
  const [deployer] = await ethers.getSigners();
  const base = process.env.BASE || "http://127.0.0.1:8080/metadata/";
  const price = ethers.parseEther(process.env.INSCRIPTION_PRICE || "0.0088");
  // 献纳的收款地址。写死进合约，部署之后谁也改不了 —— 包括我。
  const treasury = process.env.TREASURY || "0xTREASURY_REDACTED";
  const royaltyBps = BigInt(process.env.ROYALTY_BPS || 500);

  if (!ethers.isAddress(treasury)) {
    throw new Error(`TREASURY 不是合法地址：${treasury}`);
  }

  console.log(`network  : ${network.name}`);
  console.log(`deployer : ${deployer.address}`);
  console.log(
    `balance  : ${ethers.formatEther(
      await ethers.provider.getBalance(deployer.address)
    )} ETH`
  );

  console.log(`金库     : ${treasury}`);
  console.log(`baseURI  : ${base}`);

  const args = [base, base + "contract.json", price, treasury, royaltyBps];
  const dome = await ethers.deployContract("Observatory", args);
  await dome.waitForDeployment();
  const address = await dome.getAddress();

  console.log(`\n垂光台 deployed at ${address}`);
  console.log(`献纳全部流向 ${await dome.TREASURY()}（写死在合约里）`);
  console.log(`星屑     : 2048 枚 · 免费 · 每天 2 枚 · 每人累计 14`);
  console.log(
    `星座     : 88 个 · 每人 1 个 · ${ethers.formatEther(price)} ETH ` +
      `或交出 14 枚星屑（22 席）`
  );

  // 本地/测试网直接开到铭刻阶段，方便完整走流程。主网留在闭台。
  if (network.name === "robinhood") {
    console.log("\n阶段留在【闭台】—— 确认元数据无误后再 advancePhase(1) / (2)");
  } else {
    await (await dome.advancePhase(PHASE.Drifting)).wait();
    await (await dome.advancePhase(PHASE.Inscribing)).wait();
    console.log("\n阶段已推进到【铭刻】，两层均开放");
  }

  const artifact = await hre.artifacts.readArtifact("Observatory");
  const out = {
    address,
    treasury,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    network: network.name,
    explorer: EXPLORERS[network.name] || null,
    baseURI: base,
    abi: artifact.abi,
  };

  const file = path.join(__dirname, "..", "web", "deployment.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);

  if (EXPLORERS[network.name]) {
    console.log(`\n验证源码:`);
    console.log(
      `  npx hardhat verify --network ${network.name} ${address} ` +
        args.map((a) => `"${a}"`).join(" ")
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
