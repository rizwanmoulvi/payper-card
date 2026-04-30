# AI Agent Onchain Visa Provisioning via x402

This proof-of-concept demonstrates how an AI agent can autonomously provision a virtual Visa card via Lithic by fulfilling an [x402 payment agreement](https://docs.cdp.coinbase.com/x402/network-support) onchain (Base Sepolia).

We leverage the `@x402/express` middleware to protect the card-creation API and standard `@x402/evm` features to initiate an intent-based payment.

## Hackathon Architecture
1. **Agent Logic (`src/agent.js`)**: 
   - Requests a virtual card from the server (`/api/provision`).
   - Receives a `402 Payment Required` challenge.
   - Parses the challenge and construct an EIP-3009 transfer signature using its funded wallet.
   - Submits the signature and payload as a Proof-of-Payment back to the server.
2. **Provider Server (`src/server.js`)**:
   - Secures its API using `x402ResourceServer` and `paymentMiddleware`.
   - When a valid request (with verified Proof-of-Payment) clears their Facilitator/Settlement hook, it provisions the Virtual Visa Card via Lithic and returns it to the agent.

## How to test locally
1. Install dependencies:
   ```bash
   npm install
   ```
2. Setup environment variables:
   ```bash
   cp .env.example .env
   # Ensure your .env has FUNDED_WALLET_PRIVATE_KEY and X402_PAY_TO_ADDRESS
   ```
3. Start the protected API server:
   ```bash
   node src/server.js
   ```
4. In a new terminal, run the AI Agent to request the card automatically:
   ```bash
   node src/agent.js
   ```
