require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

// x402 SDK
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { ExactEvmScheme } = require('@x402/evm/exact/server');
const { HTTPFacilitatorClient } = require('@x402/core/server');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Initialize x402 Server & Facilitator Client
const facilitatorClient = new HTTPFacilitatorClient({
  url: process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator",
});

const x402Server = new x402ResourceServer(facilitatorClient)
  .register("eip155:84532", new ExactEvmScheme());

// 2. Protect endpoint showing dynamic/static prices
// For hackathon, any virtual card costs 1 USDC to provision
app.use(
  paymentMiddleware(
    {
      "POST /api/provision": {
        accepts: [
          {
            scheme: "exact",
            price: "$5.00", // $5 USDC 
            network: "eip155:84532",
            payTo: process.env.X402_PAY_TO_ADDRESS,
            asset: process.env.USDC_SEP_ADDRESS
          },
        ],
        description: "Provision a Virtual Visa Card using USDC via x402",
      },
    },
    x402Server
  )
);

// 3. Issue Card via Lithic API once payment clears
app.post('/api/provision', async (req, res) => {
  const { merchant, amount } = req.body;
  
  if (!merchant || !amount) {
    return res.status(400).json({ error: "Missing 'merchant' or 'amount' in request." });
  }

  console.log(`\n✅ Payment verified! Proceeding to provision card for ${merchant} ($${amount})...`);
  
  try {
    // Call to Lithic Sandbox API
    const lithicResponse = await axios.post("https://sandbox.lithic.com/v1/cards", {
      type: "MERCHANT_LOCKED",
      spend_limit: Math.round(amount * 100), // Lithic uses cents
      memo: merchant
    }, {
      headers: {
        "Authorization": process.env.LITHIC_API_KEY || "YOUR_LITHIC_API_KEY",
        "Content-Type": "application/json"
      }
    });

    const realCard = lithicResponse.data;
    console.log(`💳 Virtual Visa generated via Lithic: ${realCard.token}`);
    
    return res.status(200).json({
      success: true,
      message: "Payment successfully settled via x402. Card provisioned.",
      card: realCard
    });
    
  } catch (error) {
    console.error("Lithic API Error:", error.message);
    return res.status(500).json({ error: "Failed to provision card with issuer." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 x402 Protected Provider Server listening on port ${PORT}`);
  console.log(`Waiting for Agent provisioning requests...`);
});
