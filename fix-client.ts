import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

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

  const rawChallenge = 'eyJ4NDAyVmVyc2lvbiI6MiwicmVzb3VyY2UiOnsidXJsIjoiaHR0cDovL2xvY2FsaG9zdDozMDAwL2lzc3VlLWNhcmQiLCJkZXNjcmlwdGlvbiI6Iklzc3VlIGEgdmlydHVhbCBjYXJkIHdpdGggZHluYW1pYyBwcmljaW5nIiwibWltZVR5cGUiOiJhcHBsaWNhdGlvbi9qc29uIn0sImFjY2VwdHMiOlt7InNjaGVtZSI6ImV4YWN0IiwibmV0d29yayI6ImVpcDE1NTo1MDQyMDAyIiwiYW1vdW50IjoiNTA1MDAwMDAwMDAwMDAwMDAwMCIsImFzc2V0IjoiMHgxRjk4NDMxYzhhRDk4NTIzNjMxQUU0YTU5ZjI2NzM0NmVhMzFGOTg0IiwicGF5VG8iOiIweDk5MkI1Rjg0Q2I0YTljRUI3OGIyN0IzRDVjZUJiY0FEYTJFRkEyN0IiLCJtYXhUaW1lb3V0U2Vjb25kcyI6MzAwLCJleHRyYSI6eyJuYW1lIjoiTmF0aXZlVVNEQyIsInZlcnNpb24iOiIxIn19XX0=';

  try {
      const challengeParsed = JSON.parse(Buffer.from(rawChallenge, 'base64').toString('utf8'));
      console.log('challenge', challengeParsed)
      // core x402Client has method handlePaymentRequired? let's see its methods by forcing an error
      const hookHeaders = await client.authorize(challengeParsed);
      console.log("hookHeaders:", hookHeaders);
  } catch(e) {
      console.error("DEBUG ERROR:", e);
  }
}
run();
