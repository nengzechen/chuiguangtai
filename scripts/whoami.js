/** 打印当前网络下的部署者与余额。上线前用它确认钥匙和网络对不对。 */
const hre = require("hardhat");
async function main() {
  const [s] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  const bal = await hre.ethers.provider.getBalance(s.address);
  console.log(`网络     : ${hre.network.name} (chainId ${net.chainId})`);
  console.log(`部署者   : ${s.address}`);
  console.log(`余额     : ${hre.ethers.formatEther(bal)} ETH`);
  console.log(`金库     : ${process.env.TREASURY || "0xTREASURY_REDACTED"}`);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
