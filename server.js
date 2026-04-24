"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const lithic_1 = __importDefault(require("lithic"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const express_2 = require("@x402/express");
const server_1 = require("@x402/evm/exact/server");
const server_2 = require("@x402/core/server");
// Client dependencies
const fetch_1 = require("@x402/fetch");
const client_1 = require("@x402/core/client");
const client_2 = require("@x402/evm/exact/client");
const evm_1 = require("@x402/evm");
const register_agent_1 = require("./register_agent");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use(express_1.default.json());
// Serve the modern UI dashboard
app.use(express_1.default.static(path_1.default.join(__dirname, 'public')));
app.get('/demo', (req, res) => res.sendFile(path_1.default.join(__dirname, 'public', 'demo.html')));
const PORT = process.env.PORT || 3000;
const SERVER_PUBLIC_KEY = process.env.SERVER_PUBLIC_KEY || '0x217d848DE8b671aFEF2f0dCb9E72879fb109C483';
// USDC on Arc Testnet (18 decimals native token)
const USDC_ISSUER = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
// Lithic Config (Sandbox)
const lithic = new lithic_1.default({
    apiKey: process.env.LITHIC_API_KEY || 'sandbox_api_key_mock',
    environment: 'sandbox',
});
// Connect to the Independent Hosted x402 Facilitator
const HTTP_FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://arc-testnet-x402-facilitator.onrender.com';
const HTTP_FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY || '21d44887-28ed-43ab-abce-c2352fd24ad0';
const hostedFacilitatorClient = new server_2.HTTPFacilitatorClient({
    url: HTTP_FACILITATOR_URL,
    createAuthHeaders: async () => {
        const headers = { Authorization: `Bearer ${HTTP_FACILITATOR_API_KEY}` };
        return { verify: headers, settle: headers, supported: headers };
    }
});
const x402Server = new express_2.x402ResourceServer(hostedFacilitatorClient).register("eip155:5042002", new server_1.ExactEvmScheme());
app.post('/issue-card', express_1.default.json(), async (req, res) => {
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
        const payloadStr = Buffer.from(paymentSignature, 'base64').toString('utf8');
        const paymentPayload = JSON.parse(payloadStr);
        const matchingReq = x402Server.findMatchingRequirements(paymentRequiredObj.accepts, paymentPayload);
        if (!matchingReq) {
            const encoded = Buffer.from(JSON.stringify(paymentRequiredObj)).toString('base64');
            return res.status(402).set('payment-required', encoded).json({ error: "No matching requirement" });
        }
        const verifyResult = await x402Server.verifyPayment(paymentPayload, matchingReq);
        if (!verifyResult.isValid) {
            const errObj = { ...paymentRequiredObj, error: verifyResult.invalidReason };
            const encoded = Buffer.from(JSON.stringify(errObj)).toString('base64');
            return res.status(402).set('payment-required', encoded).json({ error: verifyResult.invalidReason });
        }
        console.log(`[Server] Payment signature verified! Settling USDC transaction on-chain to Merchant (${MERCHANT_CRYPTO_WALLET})...`);
        // Call Settle / Actually execute the viem transaction FIRST
        try {
            if (process.env.USDC_ISSUER === 'native') {
                console.log("[Server] Native payment was settled up-front by the Agent. Skipping EIP-3009 relay logic.");
            }
            else {
                await x402Server.settlePayment(paymentPayload, matchingReq);
                console.log(`[Server] On-chain ERC20 USDC settlement confirmed!`);
            }
        }
        catch (e) {
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
    }
    catch (err) {
        console.error('Error issuing card:', err);
        return res.status(500).json({ error: 'Internal server error while issuing card' });
    }
});
// ==========================================
// DEMO ENDPOINTS (Agent Wallet creation & funding)
// ==========================================
const demoAgents = new Map();
app.post('/api/demo/create-agent', async (req, res) => {
    try {
        const agent = await (0, register_agent_1.registerAgent)();
        demoAgents.set(agent.agentId, agent);
        res.json({
            agentId: agent.agentId,
            walletAddress: agent.walletAddress,
            registration: agent.registration
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message || 'Failed to create agent' });
    }
});
app.post('/api/demo/fund-agent', async (req, res) => {
    try {
        const { agentId } = req.body;
        const agent = demoAgents.get(agentId);
        if (!agent)
            return res.status(404).json({ error: 'Agent not found' });
        // Instead of auto-funding from the client wallet, we just return the address 
        // so the user can manually fund it or rely on existing faucet funds.
        res.json({
            success: true,
            agentId: agent.agentId,
            walletAddress: agent.walletAddress,
            message: "Please fund this agent address manually."
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message || 'Failed to check agent' });
    }
});
app.post('/api/demo/issue-card', async (req, res) => {
    try {
        const { agentId, merchant, amount } = req.body;
        const amountNum = parseFloat(amount) || 5.00;
        // If agentId provided, use the Circle wallet mapped agent
        let fetchWithX402;
        if (agentId && demoAgents.has(agentId)) {
            console.log(`[Demo] Running fetch using MPC Agent ${agentId}...`);
            const agent = demoAgents.get(agentId);
            fetchWithX402 = agent.signedFetch;
        }
        else {
            // Fallback to default local client if no agentId
            const CLIENT_SECRET = process.env.CLIENT_SECRET || '';
            const formattedSecret = CLIENT_SECRET.startsWith('0x') ? CLIENT_SECRET : `0x${CLIENT_SECRET}`;
            const account = require('viem/accounts').privateKeyToAccount(formattedSecret);
            const signer = require('@x402/evm').toClientEvmSigner(account);
            const client = new (require('@x402/core/client')).x402Client().register("eip155:5042002", new (require('@x402/evm/exact/client')).ExactEvmScheme(signer));
            fetchWithX402 = require('@x402/fetch').wrapFetchWithPayment(globalThis.fetch || fetch, client);
        }
        const MERCHANT_CRYPTO_WALLET = process.env.merchant_public_key || '0xcc631cf60652f2849abA5d5A94534eB50506Ff0C';
        // Native token deduction via Agent wallet (Circle or Viem)
        try {
            const baseUnitsObject = (BigInt(Math.round((parseFloat(amount) * 1.01) * 1000000)) * BigInt("1000000000000")).toString(); // Shift from 6 to 18 decimals!
            // Since we don't have Circle MPC natively integrated to handle random demo wallets in this test, we execute a viem transaction 
            // to move the funds from the fallback client secret (which is meant to represent the agent wallet that was funded).
            const fallbackSecret = process.env.CLIENT_SECRET || process.env.SERVER_SECRET_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
            const formattedSecret = fallbackSecret.startsWith('0x') ? fallbackSecret : `0x${fallbackSecret}`;
            const account = require('viem/accounts').privateKeyToAccount(formattedSecret);
            const walletClient = require('viem').createWalletClient({
                account,
                chain: { id: 5042002, name: 'Arc', nativeCurrency: { decimals: 6, name: 'USDC', symbol: 'USDC' }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } },
                transport: require('viem').http()
            });
            const publicClient = require('viem').createPublicClient({
                chain: { id: 5042002, name: 'Arc', nativeCurrency: { decimals: 6, name: 'USDC', symbol: 'USDC' }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } },
                transport: require('viem').http()
            });
            console.log(`[Agent] Initiating native deduction of ${baseUnitsObject} USDC directly to Merchant...`);
            const hash = await walletClient.sendTransaction({
                to: MERCHANT_CRYPTO_WALLET,
                value: BigInt(baseUnitsObject)
            });
            console.log(`[Agent] Broadcasted native transfer - Hash: ${hash}`);
            await publicClient.waitForTransactionReceipt({ hash });
            console.log(`[Agent] Transfer receipt confirmed!`);
        }
        catch (err) {
            console.error("Agent balance insufficient for native deduction:", err.message);
            return res.status(400).json({ error: "Insufficient Agent Funds or Native gas required. Please send more USDC to the Agent Address." });
        }
        const agentResponse = await fetchWithX402(`http://127.0.0.1:${process.env.PORT || 3000}/issue-card`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ merchant_name: merchant, amount: amountNum })
        });
        const agentData = await agentResponse.json();
        return res.status(agentResponse.status).json(agentData);
    }
    catch (err) {
        console.error('Agent runner error:', err);
        return res.status(500).json({ error: err.message || 'Internal failure in agent client' });
    }
});
app.post('/api/issue-card', async (req, res) => {
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
        const signer = (0, evm_1.toClientEvmSigner)(account);
        const client = new client_1.x402Client().register("eip155:5042002", new client_2.ExactEvmScheme(signer));
        const fetchWithX402 = (0, fetch_1.wrapFetchWithPayment)(fetch, client);
        // AI Agent explicitly runs the 402 negotiation against our server
        const agentResponse = await fetchWithX402(`http://127.0.0.1:${PORT}/issue-card`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ merchant_name, amount: amountNum })
        });
        const agentData = await agentResponse.json();
        return res.status(agentResponse.status).json(agentData);
    }
    catch (err) {
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
    }
    catch (err) {
        console.error('Error listing cards:', err);
        return res.status(500).json({ error: err.message });
    }
});
// Get a specific card by token
app.get('/api/cards/:token', async (req, res) => {
    try {
        const card = await lithic.cards.retrieve(req.params.token);
        return res.status(200).json(card);
    }
    catch (err) {
        console.error('Error retrieving card:', err);
        return res.status(500).json({ error: err.message });
    }
});
// Update a card (e.g. pause, close, or update spend limit)
app.patch('/api/cards/:token', async (req, res) => {
    try {
        const { state, spend_limit } = req.body;
        const updatePayload = {};
        if (state)
            updatePayload.state = state;
        if (spend_limit)
            updatePayload.spend_limit = Math.round(parseFloat(spend_limit) * 100);
        const card = await lithic.cards.update(req.params.token, updatePayload);
        return res.status(200).json(card);
    }
    catch (err) {
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
    }
    catch (err) {
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
