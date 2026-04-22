# PayPer Card: Autonomous AI Agent Checkout

**PayPer Card** is an open-source application that bridges pure blockchain abstraction with the real-world fiat economy. It empowers autonomous AI agents to immediately provision fully-funded Lithic virtual credit cards to finish checkouts for users asynchronously.

To process the underlying cryptocurrency payments securely and seamlessly, PayPer Card integrates with our **Hosted x402 Facilitator Service** (available in the `facilitator` branch).

## How It Works

1.  **AI Invocation:** An AI agent attempts to hit our protected `/issue-card` endpoint to buy a virtual card for a user's subscription or e-commerce cart.
2.  **x402 Challenge:** The PayPer Card server rejects the request with a `402 Payment Required` challenge, demanding a specific USD amount (plus fee) via Arc Testnet USDC.
3.  **On-Chain Settlement (via Facilitator):** The agent automatically fulfills this challenge utilizing our custom **Hosted x402 Facilitator**. The facilitator handles the blockchain infrastructure, verifies the Arc Testnet Native USDC transaction, and guarantees settlement.
4.  **Card Provisioning:** Once the facilitator confirms the mathematical receipt on-chain, PayPer Card instantly provisions a funded, single-use **Lithic** Virtual Visa/Mastercard and returns the PAN/CVV directly to the agent.

---

## The x402 Facilitator

This application relies on our **Custom x402 Facilitator**, which handles the heavy lifting of blockchain infrastructure, transaction simulation, and high-performance settlement natively on the Arc EVM. 

For detailed documentation regarding the Facilitator's architecture, hosted endpoints, authentication, and pricing models, please see the `facilitator` branch of this repository.

---

## Quickstart (PayPer Card Deployment)

Deploy your own instance of the PayPer Card issuing server:

1. Connect this repository to your **Render** dashboard via GitHub.
2. Select **Web Service** (or use the included `render.yaml` Blueprint).
3. Use the following deployment configs:
   * **Set Build Command:** `npm install && npx tsc`
   * **Set Start Command:** `npm start`
   * **Environment Variables:**
     ```env
     PORT=3000
     USDC_ISSUER=native
     CLIENT_SECRET=0x<your_server_private_key>
     merchant_public_key=0x<merchant_destination_address>
     CIRCLE_API_KEY=<optional>
     CIRCLE_ENTITY_SECRET=<optional>
     LITHIC_API_KEY=<sandbox_key>
     ```

## Client AI Integration (Agent Code)

To deploy an AI Agent to execute virtual card payloads against your deployed PayPer Card app:

```typescript
import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client } from '@x402/core/client';

const fetchWithX402 = wrapFetchWithPayment(fetch as any, client);

// The AI Agent seamlessly executes the payload.
// If it receives a 402 Payment Required, our Facilitator intercepts, pays over Arc, and re-requests!
const response = await fetchWithX402(`https://your-render-url.onrender.com/issue-card`, {
      method: 'POST',
      headers: { 
         'Content-Type': 'application/json'
      },
      body: JSON.stringify({ merchant_name: 'Netflix', amount: 5.00 })
});
```

*Built on [Arc Network](https://arc.network/) & Designed against the [x402 Spec](https://x402.org)*.
