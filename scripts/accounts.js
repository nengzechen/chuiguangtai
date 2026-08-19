/**
 * Lists the local chain's prefunded accounts.
 *
 *   npm run accounts
 */
const { ethers } = require("hardhat");

async function main() {
  const signers = await ethers.getSigners();
  for (const [i, s] of signers.slice(0, 5).entries()) {
    const bal = await ethers.provider.getBalance(s.address);
    console.log(`#${i}  ${s.address}  ${ethers.formatEther(bal)} ETH`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
