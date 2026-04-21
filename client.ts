import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { registerAgent } from './register_agent';
import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import dotenv from 'dotenv';
dotenv.config();

const API_URL = process.env.API_URL || 'http://localhost:3000/issue-card';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '0x2695e6e10075fe791bdb2727abc5dd38ba4ef5ba39d05d6e065beac8e8650b9c';

async function main() {
    console.log(`[Client] Initializing...`);

    const arcTestnetDef = {
      id: 5042002,
      name: 'Arc Testnet',
      network: 'arc-testnet',
      nativeCurrency: { decimals: 18, name: 'ARC', symbol: 'ARC' },
      rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] }, public: { http: ['https://rpc.testnet.arc.network'] } },
    };
    
    const formattedSecret = CLIENT_SECRET.startsWith('0x') ? CLIENT_SECRET : `0x${CLIENT_SECRET}`;
    const account = privateKeyToAccount(formattedSecret as `0x${string}`);
    const publicClient = createPublicClient({ chain: arcTestnetDef, transport: http() });
    const walletClient = createWalletClient({ account, chain: arcTestnetDef, transport: http() });
    
    // 1. Register the AI Agent which will provision a Circle Multi-chain wallet
    const agent = await registerAgent();
    
    // 2. Fund the newly minted Agent Circle wallet with native value from Client
    console.log(`\n[Client] Funding Agent wallet (${agent.walletAddress}) with 10 ARC for card payments...`);
    const fundingHash = await walletClient.sendTransaction({
        to: agent.walletAddress as `0x${string}`,
        value: parseEther('10') // Give the agent 10 native ARC Testnet USDC equivalent
    });
    console.log(`✓ Agent Funded! Transaction sent (Hash: ${fundingHash})`);
    
    // Wait for the block to settle quickly
    await publicClient.waitForTransactionReceipt({ hash: fundingHash });
    console.log(`✓ Agent Wallet successfully received protocol funds on-chain.`);

    const agentBal = await publicClient.getBalance({ address: agent.walletAddress as `0x${string}` });
    console.log(`Agent Native Balance: ${agentBal.toString()}`);

    // 3. Delegate the purchase action to the newly registered Agent (acting as the buyer)
    console.log('\n[Agent] Initiating Agent purchase to issue virtual card for netflix_india...');
    try {
        const response = await agent.signedFetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ merchant_name: 'netflix_india' })
        });

        const cardDetails = await response.json();

        if (response.ok) {
            console.log('\n✅ SUCCESS - VIRTUAL CARD ISSUED!');
            console.log('Server verified payment from Agent seamlessly via x402!');
            if (cardDetails.card) {
                console.table({
                    Pan: cardDetails.card.pan,
                    CVV: cardDetails.card.cvv,
                    Exp: `${cardDetails.card.exp_month}/${cardDetails.card.exp_year}`,
                    Token: cardDetails.card.token,
                    Limit: cardDetails.card.spend_limit,
                    State: cardDetails.card.state
                });
            } else {
                console.log(cardDetails);
            }
        } else {
            console.error('\n❌ Request failed after x402 attempt.');
            console.error('Status:', response.status);
            console.error('Body:', cardDetails);
            console.error('Headers:', Array.from(response.headers.entries()));
        }

    } catch (e: any) {
        console.error('❌ Agent Execution Error:', e.message || e);
    }
}

main();
