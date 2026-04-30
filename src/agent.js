require('dotenv').config();
const axios = require('axios');
const { x402Client, wrapFetchWithPayment, x402HTTPClient } = require('@x402/fetch');
const { registerExactEvmScheme } = require('@x402/evm/exact/client');
const { privateKeyToAccount } = require('viem/accounts');

const SERVER_URL = "http://localhost:3001/api/provision";
const PRIVATE_KEY = process.env.FUNDED_WALLET_PRIVATE_KEY;

async function requestVisaCard() {
  if (!PRIVATE_KEY) {
    console.error("Missing FUNDED_WALLET_PRIVATE_KEY in .env");
    return;
  }

  // 1. Create EVM signer from private key
  const signer = privateKeyToAccount(`0x${PRIVATE_KEY}`);
  
  // 2. Initialize the x402 client and register EVM exact support
  const client = new x402Client();
  registerExactEvmScheme(client, { signer });
  
  // 3. Wrap the native fetch so it handles 402 challenges automatically
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  
  console.log(`🤖 Agent: Requesting virtual Visa card (merchant: Apple Inc) from ${SERVER_URL}...`);
  console.log(`   (The x402Client will automatically detect 402, pay 5 USDC, and retry!)`);
  
  try {
    // 4. Send request! The wrapFetchWithPayment helper will do all the heavy lifting.
    const response = await fetchWithPayment(SERVER_URL, { 
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ merchant: "Apple Inc", amount: 5.00 })
    });
    
    // We only get here once the payment is fulfilled successfully, or if there's a non-402 response
    const body = await response.json();
    console.log("\n🎉 Server accepted the payment and provisioned the card!");
    console.log(body);

    if (response.ok) {
      const httpClient = new x402HTTPClient(client);
      const paymentResponse = httpClient.getPaymentSettleResponse(
        (name) => response.headers.get(name)
      );
      console.log("\n🧾 Payment settled receipt:", paymentResponse);
    }
  } catch (err) {
    console.error("\n❌ Request failed:");
    console.error(err);
  }
}

requestVisaCard();
