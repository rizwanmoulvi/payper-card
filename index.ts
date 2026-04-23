import express from 'express';
import Lithic from 'lithic';
import dotenv from 'dotenv';
import path from 'path';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';

// Client dependencies
import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme as ClientExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { registerAgent } from './register_agent';
import { parseEther } from 'viem';

dotenv.config();

const app = express();
app.use(express.json());
// Serve the modern UI dashboard
app.use(express.static(path.join(__dirname, 'public')));
app.get('/demo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'demo.html')));

const PORT = process.env.PORT || 3000;
const SERVER_PUBLIC_KEY = process.env.SERVER_PUBLIC_KEY || '0x217d848DE8b671aFEF2f0dCb9E72879fb109C483';
// Arc testnet USDC ERC-20 interface for x402 permit-based settlement (6 decimals)
const USDC_ISSUER = process.env.USDC_ISSUER || '0x3600000000000000000000000000000000000000';

// Lithic Config (Sandbox)
const lithic = new Lithic({
  apiKey: process.env.LITHIC_API_KEY || 'sandbox_api_key_mock',
  environment: 'sandbox',
});

// Connect to the Independent Hosted x402 Facilitator
const HTTP_FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://arc-testnet-x402-facilitator.onrender.com';
const HTTP_FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY || '21d44887-28ed-43ab-abce-c2352fd24ad0'; 

const hostedFacilitatorClient = new HTTPFacilitatorClient({
  url: HTTP_FACILITATOR_URL,
  createAuthHeaders: async () => {
    const headers = { Authorization: `Bearer ${HTTP_FACILITATOR_API_KEY}` };
    return { verify: headers, settle: headers, supported: headers };
  }
});

const x402Server = new x402ResourceServer(hostedFacilitatorClient).register(
  "eip155:5042002",
  new ExactEvmScheme()
);

app.post('/issue-card', express.json(), async (req, res) => {
  const paymentSignature = req.headers['payment-signature'] || req.headers['x-payment'];
  const amountNum = parseFloat(req.body?.amount) || 5.00; 
  const merchant_name = req.body?.merchant_name || 'Agent_Purchase';

  const amountPlusFee = amountNum * 1.01; // Agent pays limit + 1% fee
  // Convert to 6 decimals for USDC
  const baseUnits = (Math.round(amountPlusFee * 1_000_000)).toString();

  const MERCHANT_CRYPTO_WALLET = process.env.merchant_public_key || '0xcc631cf60652f2849abA5d5A94534eB50506Ff0C';

  const paymentRequiredObj = {
    x402Version: 2,
    error: paymentSignature ? "Payment invalid" : "Payment required",
    accepts: [
      {
        scheme: "exact",
        network: "eip155:5042002",
        payTo: MERCHANT_CRYPTO_WALLET,
        amount: baseUnits,
        asset: USDC_ISSUER,
        maxTimeoutSeconds: 3600,
        extra: {
          name: "USDC",
          version: "2"
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
    const isSimulationFailure =
      !verifyResult.isValid &&
      verifyResult.invalidReason === 'invalid_exact_evm_transaction_simulation_failed';

    if (!verifyResult.isValid && !isSimulationFailure) {
      console.error('[x402 verify] invalid reason:', verifyResult.invalidReason);
      const errObj = { ...paymentRequiredObj, error: verifyResult.invalidReason };
      const encoded = Buffer.from(JSON.stringify(errObj)).toString('base64');
      return res.status(402).set('payment-required', encoded).json({ error: verifyResult.invalidReason });
    }

    if (isSimulationFailure) {
      console.warn('[x402 verify] simulation failed; attempting direct settlement fallback');
    }

    console.log(`[Server] Payment signature verified! Settling USDC transaction on-chain to Merchant (${MERCHANT_CRYPTO_WALLET})...`);
    
    // Call Settle / Actually execute the viem transaction FIRST
    try {
      await x402Server.settlePayment(paymentPayload as any, matchingReq as any);
      console.log(`[Server] On-chain ERC20 USDC settlement confirmed!`);
    } catch(e) {
      console.error("Local settlement hook failed", e);
      return res.status(402).json({ error: "On-chain settlement failed. Your agent's USDC authorization was rejected or insufficient funds." });
    }

    console.log(`[Server] Issuing ${amountNum} USD card for ${merchant_name}...`);
    
    // Generating a card via lithic sandbox
    const card = await lithic.cards.create({
      type: 'SINGLE_USE',
      spend_limit: Math.round(amountNum * 100), // Spend limits are in cents
      memo: `AgentCard: ${merchant_name}`,
    });

    console.log(`[Server] Lithic card created:`, card.token);

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


// ==========================================
// DEMO ENDPOINTS (Agent Wallet creation & funding)
// ==========================================
const demoAgents = new Map<string, any>();

app.post('/api/demo/create-agent', async (req, res) => {
  try {
    const agent = await registerAgent();
    demoAgents.set(agent.agentId, agent);
    res.json({
      agentId: agent.agentId,
      walletAddress: agent.walletAddress,
      registration: agent.registration
    });
  } catch (err: any) {
    res.status(500).json({ error: (err as Error).message || 'Failed to create agent' });
  }
});

app.post('/api/demo/fund-agent', async (req, res) => {
  try {
    const { agentId } = req.body;
    const agent = demoAgents.get(agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    
    // Instead of auto-funding from the client wallet, we just return the address 
    // so the user can manually fund it or rely on existing faucet funds.
    res.json({
      success: true,
      agentId: agent.agentId,
      walletAddress: agent.walletAddress,
      message: "Please fund this agent address manually."
    });
  } catch (err: any) {
    res.status(500).json({ error: (err as Error).message || 'Failed to check agent' });
  }
});

app.post('/api/demo/run-agent', async (req, res) => {
  try {
    const { agentId, merchant, amount } = req.body;
    const amountNum = parseFloat(amount) || 5.00;
    const amountPlusFee = amountNum * 1.01;
    const baseUnits = BigInt(Math.round(amountPlusFee * 1_000_000));
    const MERCHANT_CRYPTO_WALLET = process.env.merchant_public_key || '0xcc631cf60652f2849abA5d5A94534eB50506Ff0C';

    const erc20TransferAbi = [
      {
        type: 'function',
        name: 'transfer',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
      },
    ] as const;
    
    // If agentId provided, use it for demo identity only; payment still comes from CLIENT_SECRET
    let fetchWithX402;
    if (agentId && demoAgents.has(agentId)) {
        console.log(`[Demo] Running fetch using MPC Agent ${agentId}...`);
    }

    const CLIENT_SECRET = process.env.CLIENT_SECRET || '';
    if (!CLIENT_SECRET) {
        return res.status(500).json({ error: 'Client secret not configured' });
    }
    const formattedSecret = CLIENT_SECRET.startsWith('0x') ? CLIENT_SECRET : `0x${CLIENT_SECRET}`;
    const account = require('viem/accounts').privateKeyToAccount(formattedSecret);
    const signer = require('@x402/evm').toClientEvmSigner(account);
    const client = new (require('@x402/core/client')).x402Client().register(
      "eip155:5042002",
      new (require('@x402/evm/exact/client')).ExactEvmScheme(signer)
    );
    fetchWithX402 = require('@x402/fetch').wrapFetchWithPayment(globalThis.fetch || fetch, client);

    const { createPublicClient, createWalletClient, http } = require('viem');
    const transferWalletClient = createWalletClient({
      account,
      chain: {
        id: 5042002,
        name: 'Arc Testnet',
        network: 'arc-testnet',
        nativeCurrency: { decimals: 18, name: 'USDC', symbol: 'USDC' },
        rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] }, public: { http: ['https://rpc.testnet.arc.network'] } },
      },
      transport: http('https://rpc.testnet.arc.network'),
    });
    const transferPublicClient = createPublicClient({
      chain: {
        id: 5042002,
        name: 'Arc Testnet',
        network: 'arc-testnet',
        nativeCurrency: { decimals: 18, name: 'USDC', symbol: 'USDC' },
        rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] }, public: { http: ['https://rpc.testnet.arc.network'] } },
      },
      transport: http('https://rpc.testnet.arc.network'),
    });

    console.log(`[Demo] Transferring ${baseUnits.toString()} USDC from client wallet to merchant ${MERCHANT_CRYPTO_WALLET}...`);
    const transferHash = await transferWalletClient.writeContract({
      address: USDC_ISSUER as `0x${string}`,
      abi: erc20TransferAbi,
      functionName: 'transfer',
      args: [MERCHANT_CRYPTO_WALLET as `0x${string}`, baseUnits],
    });
    await transferPublicClient.waitForTransactionReceipt({ hash: transferHash });
    console.log(`[Demo] Client-funded USDC transfer confirmed: ${transferHash}`);

    const agentResponse = await fetchWithX402(`http://127.0.0.1:${process.env.PORT || 3000}/issue-card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchant_name: merchant, amount: amountNum })
    });

    const agentData = await agentResponse.json();
    return res.status(agentResponse.status).json(agentData);
  } catch (err: any) {
    console.error('Agent runner error:', err);
    return res.status(500).json({ error: (err as Error).message || 'Internal failure in agent client' });
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
    return res.status(500).json({ error: (err as Error).message || 'Internal failure in agent client' });
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
    return res.status(500).json({ error: (err as Error).message });
  }
});

// Get a specific card by token
app.get('/api/cards/:token', async (req, res) => {
  try {
    const card = await lithic.cards.retrieve(req.params.token);
    return res.status(200).json(card);
  } catch (err: any) {
    console.error('Error retrieving card:', err);
    return res.status(500).json({ error: (err as Error).message });
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
    return res.status(500).json({ error: (err as Error).message });
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
    return res.status(500).json({ error: (err as Error).message });
  }
});

app.listen(PORT, () => {
    console.log(`\n=========================================`);
    console.log(`🚀 Card For Agent Dash running at: `);
    console.log(`👉 https://agc.rizzmo.site`);
    console.log(`=========================================\n`);
    console.log(`[Server] x402 protected endpoint at POST /issue-card`);
});
