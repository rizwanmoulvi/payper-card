const { ethers } = require("ethers");
require("dotenv").config();

async function sweepToKeeperHub() {
  const KEEPERHUB_ADDRESS = process.env.KEEPERHUB_TURNKEY_ADDRESS;
  const PRIVATE_KEY = process.env.FUNDED_WALLET_PRIVATE_KEY;
  const USDC_ADDRESS = process.env.USDC_SEP_ADDRESS;

  if (!KEEPERHUB_ADDRESS || KEEPERHUB_ADDRESS === "0x...") {
    console.error("❌ Please set KEEPERHUB_TURNKEY_ADDRESS in your .env file to your KeeperHub wallet address!");
    return;
  }

  // Base Sepolia standard public RPC
  const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`🏦 Found Funded Wallet: ${wallet.address}`);
  console.log(`➡️  Target KeeperHub Wallet: ${KEEPERHUB_ADDRESS}`);

  // 1. Sweep USDC
  const usdcAbi = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address account) view returns (uint256)"
  ];
  const usdcContract = new ethers.Contract(USDC_ADDRESS, usdcAbi, wallet);

  const usdcBalance = await usdcContract.balanceOf(wallet.address);
  if (usdcBalance > 0n) {
    console.log(`\n⏳ Sweeping ${ethers.formatUnits(usdcBalance, 6)} USDC...`);
    const tzUsdc = await usdcContract.transfer(KEEPERHUB_ADDRESS, usdcBalance);
    await tzUsdc.wait();
    console.log(`✅ USDC transferred! Tx Hash: ${tzUsdc.hash}`);
  } else {
    console.log("\n⚠️ No USDC balance found in funded wallet.");
  }

  // 2. Sweep remaining Base Sepolia ETH
  const ethBalance = await provider.getBalance(wallet.address);
  // Estimate gas cost for simple transfer (~21k gas limit * current gas price)
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits("0.1", "gwei");
  const gasCost = 21000n * gasPrice;

  if (ethBalance > gasCost) {
    const amountToSend = ethBalance - gasCost - ethers.parseEther("0.0001"); // Leaving tiny buffer
    console.log(`\n⏳ Sweeping ${ethers.formatEther(amountToSend)} ETH for gas fees...`);
    
    const tzEth = await wallet.sendTransaction({
      to: KEEPERHUB_ADDRESS,
      value: amountToSend
    });
    await tzEth.wait();
    console.log(`✅ ETH transferred! Tx Hash: ${tzEth.hash}`);
  } else {
    console.log("\n⚠️ Not enough ETH in funded wallet to cover sweep gas fees.");
  }

  console.log("\n🚀 All done! Your KeeperHub Turnkey wallet is now fully funded for the demo.");
}

sweepToKeeperHub().catch((error) => {
  console.error("Sweep failed:");
  console.error(error);
});
