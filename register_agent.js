"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAgent = registerAgent;
const dotenv_1 = __importDefault(require("dotenv"));
const developer_controlled_wallets_1 = require("@circle-fin/developer-controlled-wallets");
const viem_1 = require("viem");
const accounts_1 = require("viem/accounts");
const client_1 = require("@x402/core/client");
const client_2 = require("@x402/evm/exact/client");
const evm_1 = require("@x402/evm");
const fetch_1 = require("@x402/fetch");
dotenv_1.default.config();
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
        const circleDCW = (0, developer_controlled_wallets_1.initiateDeveloperControlledWalletsClient)({
            apiKey: process.env.CIRCLE_API_KEY || '',
            entitySecret: process.env.CIRCLE_ENTITY_SECRET || ''
        });
        let walletId = `wlt-${Date.now()}`;
        let walletAddress;
        let customAccount;
        let localPvtKey;
        if (process.env.CIRCLE_API_KEY && process.env.CIRCLE_ENTITY_SECRET) {
            console.log('[Agent] Creating developer-controlled wallet via Circle MPC...');
            const walletSetRes = await circleDCW.createWalletSet({
                name: `AgentWalletSet-${Date.now()}`
            });
            const walletSetId = walletSetRes.data?.walletSet?.id || process.env.CIRCLE_WALLET_SET_ID || '';
            const walletsRes = await circleDCW.createWallets({
                blockchains: ['ETH-SEPOLIA'],
                walletSetId: walletSetId,
                count: 1,
            });
            const wallet = walletsRes.data?.wallets?.[0];
            if (!wallet)
                throw new Error("Failed to create Circle wallet");
            walletId = wallet.id;
            walletAddress = wallet.address;
            customAccount = require('viem/accounts').toAccount({
                address: walletAddress,
                async signMessage({ message }) {
                    console.log('[Circle MPC] Signing Message');
                    const res = await circleDCW.signMessage({
                        walletId: walletId,
                        message: Buffer.from(typeof message === 'string' ? message : message.raw).toString('base64'),
                    });
                    return `0x${res.data?.signature}`;
                },
                async signTypedData(typedData) {
                    console.log('[Circle MPC] Signing Typed Data for x402');
                    const res = await circleDCW.signTypedData({
                        walletId: walletId,
                        typedData: typedData
                    });
                    return `0x${res.data?.signature}`;
                }
            });
        }
        else {
            console.log('[Agent] No Circle API Keys found. Falling back to local dynamically generated agent wallet for testnet execution...');
            localPvtKey = require('viem/accounts').generatePrivateKey();
            customAccount = (0, accounts_1.privateKeyToAccount)(localPvtKey);
            walletAddress = customAccount.address;
        }
        console.log(`✓ Agent Wallet created: ${walletAddress} (ID: ${walletId})`);
        // 2. Get wallet details to extract signing capability
        console.log(`✓ Wallet details retrieved for ID:`, walletId);
        // 4. Create viem clients using the agent's account
        const account = customAccount;
        const publicClient = (0, viem_1.createPublicClient)({
            chain: arcTestnetDef,
            transport: (0, viem_1.http)('https://rpc.testnet.arc.network')
        });
        const walletClient = (0, viem_1.createWalletClient)({
            account,
            chain: arcTestnetDef,
            transport: (0, viem_1.http)('https://rpc.testnet.arc.network')
        });
        // 5. Create x402 signer from the account
        const evmSigner = (0, evm_1.toClientEvmSigner)(account, publicClient);
        // 6. Register the agent with x402 on Arc Testnet
        console.log('[Agent] Registering x402 scheme for Arc Testnet...');
        const x402ClientInstance = new client_1.x402Client().register('eip155:5042002', new client_2.ExactEvmScheme(evmSigner));
        // 7. Set up payment creation handlers
        // 8. Wrap fetch for automatic x402 payment handling
        const fetchWithX402 = (0, fetch_1.wrapFetchWithPayment)(fetch, x402ClientInstance);
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
            privateKey: localPvtKey,
            signedFetch: fetchWithX402,
            x402Client: x402ClientInstance,
            circleWalletId: walletId,
            registration: agentRegistration,
        };
    }
    catch (error) {
        console.error('❌ Agent registration failed:', error);
        throw error;
    }
}
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
