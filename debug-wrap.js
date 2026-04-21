const { x402Client } = require('@x402/core/client');
const { ExactEvmScheme } = require('@x402/evm/exact/client');
const { toClientEvmSigner } = require('@x402/evm');
const { createPublicClient, createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

const arcTestnetDef = {
  id: 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { decimals: 18, name: 'USDC', symbol: 'USDC' },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] }, public: { http: ['https://rpc.testnet.arc.network'] } },
};

async function run() {
  const account = privateKeyToAccount('0x2695e6e10075fe791bdb2727abc5dd38ba4ef5ba39d05d6e065beac8e8650b9c');
  const publicClient = createPublicClient({ chain: arcTestnetDef, transport: http() });
  const walletClient = createWalletClient({ account, chain: arcTestnetDef, transport: http() });
  
  const signer = toClientEvmSigner(Object.assign({}, publicClient, walletClient, { address: account.address }));
  const client = new x402Client().register(
    "eip155:5042002",
    new ExactEvmScheme(signer)
  );

  let res1 = await fetch('http://localhost:3000/issue-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchant_name: 'test1' })
  });

  console.log("RES1 Status:", res1.status);
  let challengeStr = res1.headers.get("payment-required");

  if (challengeStr) {
      console.log("PAYMENT REQUIRED CAUGHT!");
      const chJson = JSON.parse(Buffer.from(challengeStr, 'base64').toString('utf8'));
      const payload = await client.createPaymentPayload(chJson);
      
      const sigHeader = Buffer.from(JSON.stringify(payload)).toString('base64');
      console.log("SENDING SECOND REQUEST...");
      
      let res2 = await fetch('http://localhost:3000/issue-card', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-payment': sigHeader 
          },
          body: JSON.stringify({ merchant_name: 'test1' })
      });
      console.log("RES2 Status:", res2.status);
      const text2 = await res2.text();
      console.log("RES2 Body:", text2);
  }
}
run();
