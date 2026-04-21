# 💳 PayPer Card: Hackathon Submission

## 🚀 Elevator Pitch
**Your AI agent can now buy anything.** PayPer Card allows autonomous agents to instantly provision single-use virtual credit cards by paying with USDC crypto over the Stellar network, bypassing human KYC and Stripe captchas completely.

---

## 💡 The Inspiration
We are entering the era of autonomous AI agents (Devin, OpenClaw, AutoGPT). These agents can write code, book flights, and research markets—but the moment they hit a paywall or a checkout screen, they crash. Why? Because traditional fiat gateways (like Stripe) require human-in-the-loop KYC, email signups, and SMS verifications. Furthermore, handing an autonomous script your real personal credit card is terrifying. We needed a true machine-to-machine financial bridge.

## ⚙️ What it does
PayPer Card is an API and Model Context Protocol (MCP) server that gives AI agents purchasing power. 

When an agent needs to buy a subscription or physical good, it pings the PayPer Card API. Instead of asking for a human credit card, our server issues an **x402 Protocol** (`402 Payment Required`) challenge. Our native client proxy intercepts this challenge, autonomously settles a USDC payment over the **Stellar network**, and returns the cryptographic receipt. 

Once the crypto payment is validated, the server uses the **Lithic API** to instantly provision a real, single-use, merchant-locked Visa/Mastercard. The agent receives the PAN, CVV, and Expiry directly in its context and proceeds to complete the standard web checkout. 

## 🛠️ How we built it
* **Protocol:** [x402 Protocol](https://x402.org/) (Machine-to-Machine microtransactions replacing HTTP 402).
* **Blockchain/Settlement:** **Stellar** (Testnet) for instant, low-fee USDC transfers. 
* **Validation:** OpenZeppelin Facilitator client for verifying cryptographic receipts.
* **Card Issuing:** **Lithic API** to generate the virtual, funded fiat cards.
* **Backend:** Node.js, Express, TypeScript, deployed seamlessly on Render.
* **Agent Integration:** We built a custom **Model Context Protocol (MCP) Server** so that agents like Claude Desktop, Cursor, and VS Code Copilot have a native `provision_virtual_card` tool available directly in their prompt window. We also expose `.well-known/ai-plugin.json` and `llms.txt` for standard web-crawling bots.

## 🚧 Challenges we ran into
* **Handling the 402 Loop:** Traditional HTTP clients (like standard `fetch`) don't know how to handle 402 status codes. We had to build a middleware proxy that intercepts the 402, securely signs the Ed25519 Stellar transaction, and gracefully retries the request without crashing the agent's context loop.
* **Bridging Crypto to Fiat:** Safely mapping an asynchronous, decentralized USDC payment into a synchronous, instant Lithic virtual card issuance without race conditions or dropped funds.

## 🎉 Accomplishments that we're proud of
* Successfully completing an end-to-end flow where an AI prompt ("Get me a card for a $10 Netflix subscription") resolves into a cryptographically verified Stellar payment and a valid fiat credit card in under 5 seconds.
* Implementing the **Model Context Protocol (MCP)**, meaning users don't even need to configure APIs. They just point their AI to our local stdio server and the agent instantly knows how to buy things.

## 🔮 What's next for PayPer Card
* **Mainnet Launch:** Moving from Stellar Testnet to real USDC.
* **Granular Agent Limits:** Smart contracts that allow human managers to deposit an allowance (e.g., "$100/mo") that the agent can draw against, eliminating overspending risk.
* **Auto-Freezing:** Background workers that automatically close the Lithic virtual cards the exact millisecond the agent's target transaction settles, locking out latent subscription theft.
