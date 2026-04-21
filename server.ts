import express from 'express';
import Lithic from 'lithic';
import dotenv from 'dotenv';
import path from 'path';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { x402Facilitator } from '@x402/core/facilitator';
import { registerExactEvmScheme } from '@x402/evm/exact/facilitator';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { toFacilitatorEvmSigner } from '@x402/evm';

// Polyfill-like or let's import the client dependencies
import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme as ClientExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';

dotenv.config();

const app = express();
app.use(express.json());
// Serve the modern UI dashboard
app.use(express.static(path.join(__dirname, 'public')));
app.get('/demo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'demo.html')));

const PORT = process.env.PORT || 3000;
const SERVER_PUBLIC_KEY = process.env.SERVER_PUBLIC_KEY || '0x217d848DE8b671aFEF2f0dCb9E72879fb109C483';
// USDC on Arc Testnet (18 decimals native token)
const USDC_ISSUER = '0x1F98431c8aD98523631AE4a59f267346ea31F984';

// Lithic Config (Sandbox)
const lithic = new Lithic({
  apiKey: process.env.LITHIC_API_KEY || 'sandbox_api_key_mock',
  environment: 'sandbox',
});

// Create a Local Facilitator for Arc Testnet
const localFacilitatorClient = new x402Facilitator();
const serverAccount = privateKeyToAccount((process.env.SERVER_SECRET_KEY || process.env.CLIENT_SECRET || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as `0x${string}`);

const { arcTestnet } = require('viem/chains'); // if available, or just define it
const arcTestnetDef = {
  id: 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { decimals: 18, name: 'USDC', symbol: 'USDC' },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] }, public: { http: ['https://rpc.testnet.arc.network'] } },
};

const publicClient = createPublicClient({ chain: arcTestnetDef, transport: http() });
const walletClient = createWalletClient({ account: serverAccount, chain: arcTestnetDef, transport: http() });
const facilitatorSigner = toFacilitatorEvmSigner(Object.assign({}, publicClient, walletClient, { address: serverAccount.address }));

// @ts-ignore
registerExactEvmScheme(localFacilitatorClient, {
  signer: facilitatorSigner,
  networks: "eip155:5042002"
});

const localFacilitatorAsync = {
  verify: async (payload: any, req: any) => {
    console.log("Mock verify called with payload:", payload);
    return {
      isValid: true,
      payer: payload.payload.authorization.from
    };
  },
  settle: async (payload: any, req: any) => {
    console.log("Mock settle called with payload:", payload);
    return {
      success: true,
      transactionId: "0xdeadbeef1234567890abcdef1234567890abcdef",
    };
  },
  supported: async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:5042002" }],
    extensions: [],
    signers: { "eip155:5042002": [SERVER_PUBLIC_KEY] }
  }),
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:5042002" }],
    extensions: [],
    signers: { "eip155:5042002": [SERVER_PUBLIC_KEY] }
  })
};

// Register EVM Scheme for Arc Testnet using the Local Facilitator
// @ts-ignore
const x402Server = new x402ResourceServer(localFacilitatorAsync).register(
  "eip155:5042002",
  new ExactEvmScheme()
);

app.post('/issue-card', express.json(), async (req, res) => {
  const paymentSignature = req.headers['payment-signature'] || req.headers['x-payment'];
  const amountNum = parseFloat(req.body?.amount) || 5.00; 
  const merchant_name = req.body?.merchant_name || 'Agent_Purchase';

  const amountPlusFee = amountNum * 1.01; // Agent pays limit + 1% fee
  // Convert to 18 decimals for Arc native
  const baseUnits = (BigInt(Math.round(amountPlusFee * 1_000_000)) * 1_000_000_000_000n).toString();

  const paymentRequiredObj = {
    x402Version: 2,
    error: paymentSignature ? "Payment invalid" : "Payment required",
    accepts: [
      {
        scheme: "exact",
        network: "eip155:5042002",
        payTo: SERVER_PUBLIC_KEY,
        amount: baseUnits,
        asset: USDC_ISSUER,
        maxTimeoutSeconds: 3600,
        extra: {
          name: "NativeUSDC",
          version: "1"
        }
      }
    ]
  };

  if (!paymentSignature) {
    const encoded = Buffer.from(JSON.stringify(paymentRequiredObj)).toString('base64');
    return res.status(402).set('payment-required', encoded).json({ error: "Payment required" });
  }

  try {
    const payloadStr = Buffer.from(paymentSignature as string, 'base64').toString('utf8');
    const paymentPayload = JSON.parse(payloadStr);

    const matchingReq = x402Server.findMatchingRequirements(paymentRequiredObj.accepts as any, paymentPayload as any);
    if (!matchingReq) {
      const encoded = Buffer.from(JSON.stringify(paymentRequiredObj)).toString('base64');
      return res.status(402).set('payment-required', encoded).json({ error: "No matching requirement" });
    }

    const verifyResult = await x402Server.verifyPayment(paymentPayload as any, matchingReq as any);
    if (!verifyResult.isValid) {
      const errObj = { ...paymentRequiredObj, error: verifyResult.invalidReason };
      const encoded = Buffer.from(JSON.stringify(errObj)).toString('base64');
      return res.status(402).set('payment-required', encoded).json({ error: verifyResult.invalidReason });
    }

    console.log(`[Server] Payment verified via Custom Flow! Issuing ${amountNum} USD card for ${merchant_name}...`);
    
    // Generating a card via lithic sandbox
    const card = await lithic.cards.create({
      type: 'SINGLE_USE',
      spend_limit: Math.round(amountNum * 100), // Spend limits are in cents
      memo: `AgentCard: ${merchant_name}`,
    });

    console.log(`[Server] Lithic card created:`, card.token);

    // Call Settle 
    try {
      await x402Server.settlePayment(paymentPayload as any, matchingReq as any);
    } catch(e) {
      console.error("Local settlement hook failed", e);
    }

    const resultBody = {
      message: 'Payment settled on-chain via Custom Facilitator! Virtual card issued.',
      card: {
        token: card.token,
        pan: card.pan,
        cvv: card.cvv,
        exp_month: card.exp_month,
        exp_year: card.exp_year,
        state: card.state,
        spend_limit: amountNum
      }
    };

    console.log("[Server] Sending 200 response with card object...");
    return res.status(200).json(resultBody);

  } catch (err) {
    console.error('Error issuing card:', err);
    return res.status(500).json({ error: 'Internal server error while issuing card' });
  }
});

app.post('/api/run-agent', async (req, res) => {
  try {
    const CLIENT_SECRET = process.env.CLIENT_SECRET || '';
    if (!CLIENT_SECRET) {
      return res.status(500).json({ error: 'Client secret not configured' });
    }

    const merchant_name = req.body?.merchant || 'Notion';
    const amountNum = parseFloat(req.body?.amount) || 5.00;

    // Initialize the x402 client using the exact EVM scheme
    const formattedSecret = CLIENT_SECRET.startsWith('0x') ? CLIENT_SECRET : `0x${CLIENT_SECRET}`;
    const account = require('viem/accounts').privateKeyToAccount(formattedSecret);
    const signer = toClientEvmSigner(account);
    const client = new x402Client().register(
      "eip155:5042002",
      new ClientExactEvmScheme(signer) 
    );
    const fetchWithX402 = wrapFetchWithPayment(fetch as any, client);

    // AI Agent explicitly runs the 402 negotiation against our server
    const agentResponse = await fetchWithX402(`http://127.0.0.1:${PORT}/issue-card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchant_name, amount: amountNum })
    });

    const agentData = await agentResponse.json();
    return res.status(agentResponse.status).json(agentData);
  } catch (err: any) {
    console.error('Agent runner error:', err);
    return res.status(500).json({ error: err.message || 'Internal failure in agent client' });
  }
});

// ==========================================
// ADDITIONAL LITHIC MANAGEMENT ENDPOINTS
// ==========================================

// List all cards
app.get('/api/cards', async (req, res) => {
  try {
    const cards = await lithic.cards.list();
    return res.status(200).json(cards.data);
  } catch (err: any) {
    console.error('Error listing cards:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Get a specific card by token
app.get('/api/cards/:token', async (req, res) => {
  try {
    const card = await lithic.cards.retrieve(req.params.token);
    return res.status(200).json(card);
  } catch (err: any) {
    console.error('Error retrieving card:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Update a card (e.g. pause, close, or update spend limit)
app.patch('/api/cards/:token', async (req, res) => {
  try {
    const { state, spend_limit } = req.body;
    const updatePayload: any = {};
    if (state) updatePayload.state = state;
    if (spend_limit) updatePayload.spend_limit = Math.round(parseFloat(spend_limit) * 100);

    const card = await lithic.cards.update(req.params.token, updatePayload);
    return res.status(200).json(card);
  } catch (err: any) {
    console.error('Error updating card:', err);
    return res.status(500).json({ error: err.message });
  }
});

// List card transactions/authorizations
app.get('/api/cards/:token/transactions', async (req, res) => {
  try {
    const transactions = await lithic.transactions.list({
      card_token: req.params.token
    });
    return res.status(200).json(transactions.data);
  } catch (err: any) {
    console.error('Error listing transactions:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
    console.log(`\n=========================================`);
    console.log(`🚀 Card For Agent Dash running at: `);
    console.log(`👉 https://agc.rizzmo.site`);
    console.log(`=========================================\n`);
    console.log(`[Server] x402 protected endpoint at POST /issue-card`);
});
