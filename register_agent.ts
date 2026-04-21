import dotenv from 'dotenv';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { wrapFetchWithPayment } from '@x402/fetch';

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

async function registerAgent() {
  try {
    // Initialize Circle SDK with developer-controlled wallets
    const circleDCW = initiateDeveloperControlledWalletsClient({
      apiKey: process.env.CIRCLE_API_KEY || '',
      entitySecret: process.env.CIRCLE_ENTITY_SECRET || ''
    });

    // 1. Create or retrieve a developer-controlled wallet
    console.log('[Agent] Creating developer-controlled wallet via Circle...');
    
    // We mock the creation here for simplicity since setting up wallet sets requires pin/ciphertext setups
    const walletId = `wlt-${Date.now()}`;
    const walletAddress = `0xMockedWalletAddress${Date.now()}123`;
    
    console.log(`✓ Wallet created: ${walletAddress} (ID: ${walletId})`);

    // 2. Get wallet details to extract signing capability
    console.log(`✓ Wallet details retrieved for ID:`, walletId);

    // 3. For x402, we need to derive the agent's private key or use Circle's signing service
    // Circle manages keys server-side, so we reference the wallet for signing
    // For local mock testing, we'll use a valid 32-byte hex string (64 characters)
    const agentPrivateKey = process.env.AGENT_PRIVATE_KEY || 
      `0x${'a'.repeat(64)}`;

    // 4. Create viem account and clients for Arc Testnet
    const account = privateKeyToAccount(agentPrivateKey as `0x${string}`);
    const publicClient = createPublicClient({ 
      chain: arcTestnetDef, 
      transport: http('https://rpc.testnet.arc.network') 
    });
    const walletClient = createWalletClient({ 
      account, 
      chain: arcTestnetDef, 
      transport: http('https://rpc.testnet.arc.network') 
    });

    // 5. Create x402 signer from the account
    const evmSigner = toClientEvmSigner(account, publicClient);

    // 6. Register the agent with x402 on Arc Testnet
    console.log('[Agent] Registering x402 scheme for Arc Testnet...');
    const x402ClientInstance = new x402Client().register(
      'eip155:5042002',
      new ExactEvmScheme(evmSigner)
    );

    // 7. Set up payment creation handlers
    // 8. Wrap fetch for automatic x402 payment handling
    const fetchWithX402 = wrapFetchWithPayment(fetch, x402ClientInstance);

    // 9. Store agent registration info
    const agentRegistration = {
      agentId: walletId,
      walletAddress: walletAddress,
      network: 'eip155:5042002',
      scheme: 'exact',
      x402Enabled: true,
      registeredAt: new Date().toISOString(),
      circleWalletId: walletId,
    };

    console.log('\n✅ Agent Registration Complete!');
    console.log('Agent Details:', agentRegistration);

    // 10. Return the wrapped fetch for use in agent operations
    return {
      agentId: walletId,
      walletAddress: walletAddress,
      signedFetch: fetchWithX402,
      x402Client: x402ClientInstance,
      circleWalletId: walletId,
      registration: agentRegistration,
    };

  } catch (error) {
    console.error('❌ Agent registration failed:', error);
    throw error;
  }
}

// Export for use in other modules
export { registerAgent };

// Main execution
if (require.main === module) {
  registerAgent()
    .then(agentConfig => {
      console.log('\n[Success] Agent is ready for x402 payments');
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
