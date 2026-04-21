import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';
dotenv.config();

const API_URL = process.env.API_URL || 'https://agc.rizzmo.site/issue-card';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '0x2695e6e10075fe791bdb2727abc5dd38ba4ef5ba39d05d6e065beac8e8650b9c';

async function main() {
    console.log(`[Client] Initializing x402 client with Arc Testnet...`);

    const arcTestnetDef = {
      id: 5042002,
      name: 'Arc Testnet',
      network: 'arc-testnet',
      nativeCurrency: { decimals: 18, name: 'USDC', symbol: 'USDC' },
      rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] }, public: { http: ['https://rpc.testnet.arc.network'] } },
    };
    
    // Create the x402 compatible signer using the client secret
    const formattedSecret = CLIENT_SECRET.startsWith('0x') ? CLIENT_SECRET : `0x${CLIENT_SECRET}`;
    const account = require('viem/accounts').privateKeyToAccount(formattedSecret as `0x${string}`);
    const publicClient = require('viem').createPublicClient({ chain: arcTestnetDef, transport: require('viem').http() });
    const walletClient = require('viem').createWalletClient({ account, chain: arcTestnetDef, transport: require('viem').http() });
    const signer = toClientEvmSigner(Object.assign({}, publicClient, walletClient, { address: account.address }));
    
    // Register the EVM exact scheme
    const client = new x402Client().register(
      "eip155:5042002",
      new ExactEvmScheme(signer) 
    );
    
    client.onPaymentCreationFailure(async (context) => {
        console.error('❌ Failed to create payment payload:', context.error);
    });

    // Wrap fetch automatically handles the 402 handshake!
    const fetchWithX402 = wrapFetchWithPayment(fetch, client);

    console.log('\n[Client] Sending request to issue card for netflix_india...');
    try {
        const response = await fetchWithX402(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ merchant_name: 'netflix_india' })
        });

        const cardDetails = await response.json();

        if (response.ok) {
            console.log('\n✅ SUCCESS - VIRTUAL CARD ISSUED!');
            console.log('Server verified payment seamlessly via x402 OpenZeppelin Facilitator!');
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
        console.error('❌ Client Error:', e.message || e);
    }
}

main();
