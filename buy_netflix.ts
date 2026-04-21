import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import dotenv from 'dotenv';
dotenv.config();

const arcTestnetDef = {
  id: 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { decimals: 18, name: 'USDC', symbol: 'USDC' },
  rpcUrls: { 
    default: { http: ['https://rpc.testnet.arc.network'] },
    public: { http: ['https://rpc.testnet.arc.network'] }
  },
};

async function main() {
  const publicClient = createPublicClient({ chain: arcTestnetDef, transport: http() });
  
  // 1. Source Account (CLIENT_SECRET)
  const clientSecret = process.env.CLIENT_SECRET || '0x2695e6e10075fe791bdb2727abc5dd38ba4ef5ba39d05d6e065beac8e8650b9c';
  const sourceAccount = privateKeyToAccount(clientSecret as `0x${string}`);
  const sourceWalletClient = createWalletClient({ account: sourceAccount, chain: arcTestnetDef, transport: http() });
  
  // 2. Generate Agent Wallet
  const agentPrivateKey = generatePrivateKey();
  const agentAccount = privateKeyToAccount(agentPrivateKey);
  console.log(`[Agent] Generated new agent wallet: ${agentAccount.address}`);
  
  // 3. Transfer 3 USDC (native gas token on Arc) to agent wallet
  console.log(`[Transfer] Sending 3 USDC from ${sourceAccount.address} to ${agentAccount.address}...`);
  const hash = await sourceWalletClient.sendTransaction({
    to: agentAccount.address,
    value: parseEther('3')
  });
  console.log(`[Transfer] Tx Hash: ${hash}`);
  
  console.log(`[Transfer] Waiting for confirmation...`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[Transfer] Confirmed in block ${receipt.blockNumber}`);
  
  // 4. Provision Card using the agent wallet via x402
  console.log(`\n[Agent] Initializing x402 payment scheme for Agent...`);
  const agentSigner = toClientEvmSigner(agentAccount, publicClient);
  const client = new x402Client().register("eip155:5042002", new ExactEvmScheme(agentSigner));
  
  client.onPaymentCreationFailure(async (context: any) => {
      console.error('❌ Failed to create x402 payment:', context.error);
  });
  
  const fetchWithX402 = wrapFetchWithPayment(fetch, client);
  
  // The user asked to provision a card for netflix 3 usdc
  // We'll hit the local or public endpoint. SKILL.md uses https://agc.rizzmo.site/api/run-agent 
  // Let's also try the local proxy if it fails, or just use the public one.
  const API_URL = process.env.API_URL || 'http://localhost:3000/issue-card';
  
  console.log(`[Agent] Provisioning virtual card for Netflix (3 USDC) via ${API_URL}...`);
  try {
      const proxyResponse = await fetchWithX402(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ merchant_name: 'Netflix', amount: 3 })
      });
      
      const result = await proxyResponse.json();
      if (proxyResponse.ok) {
          console.log('\n✅ SUCCESS - VIRTUAL CARD PROVISIONED!');
          console.log('Payment executed over Arc Testnet x402!');
          if (result.card) {
              console.table({
                  Pan: result.card.pan,
                  CVV: result.card.cvv,
                  Exp: `${result.card.exp_month}/${result.card.exp_year}`,
                  Token: result.card.token,
                  State: result.card.state
              });
          } else {
              console.log(result);
          }
      } else {
          console.error('\n❌ Request failed:', proxyResponse.status, result);
      }
  } catch (err: any) {
      console.error('❌ Error during provisioning:', err.message);
  }
}

main().catch(console.error);
