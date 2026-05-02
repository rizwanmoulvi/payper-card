require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const { ethers } = require('ethers');

// x402 SDK
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { ExactEvmScheme } = require('@x402/evm/exact/server');
const { HTTPFacilitatorClient } = require('@x402/core/server');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from public folder
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/demo', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/demo.html'));
});

// 1. Initialize x402 Server & Facilitator Client
const facilitatorClient = new HTTPFacilitatorClient({
  url: process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator",
});

const x402Server = new x402ResourceServer(facilitatorClient)
  .register("eip155:84532", new ExactEvmScheme());

const provisionedCards = [];

async function provisionLithicCard(merchant, amount) {
  const lithicResponse = await axios.post(
    "https://sandbox.lithic.com/v1/cards",
    {
      type: "MERCHANT_LOCKED",
      spend_limit: Math.round(amount * 100),
      memo: merchant,
    },
    {
      headers: {
        Authorization: process.env.LITHIC_API_KEY,
        "Content-Type": "application/json",
      },
    }
  );

  const card = lithicResponse.data;
  provisionedCards.push({
    token: card.token,
    merchant,
    amount,
    timestamp: new Date().toISOString(),
    card,
  });

  return card;
}

const baseSepoliaProvider = new ethers.JsonRpcProvider('https://sepolia.base.org');
const usdcAbi = ['function transfer(address to, uint256 amount) returns (bool)'];

async function settleDemoPayment(merchant, amount) {
  const privateKey = process.env.FUNDED_WALLET_PRIVATE_KEY;
  const usdcAddress = process.env.USDC_SEP_ADDRESS;
  const payToAddress = process.env.X402_PAY_TO_ADDRESS;

  if (!privateKey) {
    throw new Error('Missing FUNDED_WALLET_PRIVATE_KEY for demo settlement.');
  }

  if (!usdcAddress || !payToAddress) {
    throw new Error('Missing USDC_SEP_ADDRESS or X402_PAY_TO_ADDRESS for demo settlement.');
  }

  const wallet = new ethers.Wallet(`0x${privateKey}`, baseSepoliaProvider);
  const usdc = new ethers.Contract(usdcAddress, usdcAbi, wallet);
  const amountInBaseUnits = ethers.parseUnits(String(amount), 6);

  const tx = await usdc.transfer(payToAddress, amountInBaseUnits);
  const receipt = await tx.wait();

  console.log(`💸 Demo settlement sent from ${wallet.address} to ${payToAddress} for ${amount} USDC (${merchant}). Tx: ${receipt.hash}`);

  return {
    from: wallet.address,
    to: payToAddress,
    amount,
    txHash: receipt.hash,
  };
}

app.post('/api/demo/create-agent', (req, res) => {
  return res.status(200).json({
    success: true,
    agentId: `agent_${Date.now()}`,
    walletAddress: process.env.FUNDED_WALLET_ADDRESS,
    network: 'eip155:84532',
    message: 'Demo uses the provided funded client account; wallet creation is skipped.',
  });
});

async function handleDemoRunAgent(req, res) {
  const { merchant, amount } = req.body;

  if (!merchant || !amount) {
    return res.status(400).json({ error: "Missing 'merchant' or 'amount' in request." });
  }

  console.log(`\n🎭 Demo provisioning for ${merchant} ($${amount}) using provided client funds...`);

  try {
    const settlement = await settleDemoPayment(merchant, amount);
    const card = await provisionLithicCard(merchant, amount);

    return res.status(200).json({
      success: true,
      message: 'Card provisioned successfully via demo.',
      fundingSource: process.env.FUNDED_WALLET_ADDRESS,
      merchant,
      amount,
      settlement,
      card,
    });
  } catch (error) {
    console.error('Demo settlement error:', error.response?.data || error.message);
    return res.status(500).json({
      error: 'Failed to provision card',
      details: error.response?.data || error.message,
    });
  }
}

app.post('/api/demo/run-agent', handleDemoRunAgent);
app.post('/api/run-agent', handleDemoRunAgent);

app.get('/api/cards', (req, res) => {
  return res.status(200).json({
    success: true,
    cards: provisionedCards,
    count: provisionedCards.length,
  });
});

// x402-protected programmatic endpoint
app.post('/api/provision', async (req, res) => {
  const { merchant, amount } = req.body;
  
  if (!merchant || !amount) {
    return res.status(400).json({ error: "Missing 'merchant' or 'amount' in request." });
  }

  console.log(`\n✅ Payment verified! Proceeding to provision card for ${merchant} ($${amount})...`);
  
  try {
    const realCard = await provisionLithicCard(merchant, amount);
    console.log(`💳 Virtual Visa generated via Lithic: ${realCard.token}`);
    
    return res.status(200).json({
      success: true,
      message: "Payment successfully settled via x402. Card provisioned.",
      card: realCard
    });
    
  } catch (error) {
    console.error("Lithic API Error:", error.message);
    return res.status(500).json({ error: "Failed to provision card with issuer." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 x402 Protected Provider Server listening on port ${PORT}`);
  console.log(`📱 Home UI: http://localhost:${PORT}/`);
  console.log(`📱 Demo UI: http://localhost:${PORT}/demo`);
  console.log(`Waiting for Agent provisioning requests...`);
});
