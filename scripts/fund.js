/**
 * Sends test ETH from a Hardhat prefunded account to your own wallet, so you
 * can test the mint page with MetaMask instead of importing a shared key.
 *
 *   FUND_TO=0xYourMetaMaskAddress npm run fund
 *   FUND_TO=0x... AMOUNT=50 npm run fund
 *
 * Local networks only — refuses to run anywhere real.
 */
const { ethers, network } = require("hardhat");

const LOCAL_CHAIN_IDS = new Set([31337n, 1337n]);

async function main() {
  const to = process.env.FUND_TO;
  const amount = process.env.AMOUNT || "10";

  if (!to || !ethers.isAddress(to)) {
    throw new Error(
      "请提供地址：FUND_TO=0xYourAddress npm run fund"
    );
  }

  const { chainId } = await ethers.provider.getNetwork();
  if (!LOCAL_CHAIN_IDS.has(chainId)) {
    throw new Error(
      `拒绝执行：这个脚本只能在本地链上跑，当前 chainId=${chainId}（network=${network.name}）`
    );
  }

  const [faucet] = await ethers.getSigners();
  const before = await ethers.provider.getBalance(to);

  const tx = await faucet.sendTransaction({
    to,
    value: ethers.parseEther(amount),
  });
  await tx.wait();

  const after = await ethers.provider.getBalance(to);
  console.log(`from   : ${faucet.address}`);
  console.log(`to     : ${to}`);
  console.log(
    `balance: ${ethers.formatEther(before)} -> ${ethers.formatEther(after)} ETH`
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
