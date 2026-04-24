"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const node_fetch_1 = __importDefault(require("node-fetch"));
// Base URL for your deployed PayPer Card API
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api';
const server = new index_js_1.Server({
    name: "payper-card-mcp",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
// 1. Define the Tools
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "provision_card",
                description: "Instantly provision a virtual credit card for a specific merchant by negotiating an x402 crypto payment.",
                inputSchema: {
                    type: "object",
                    properties: {
                        merchant: { type: "string", description: "Name of the merchant" },
                        amount: { type: "number", description: "Dollar amount to authorize" },
                    },
                    required: ["merchant", "amount"],
                },
            },
            {
                name: "list_cards",
                description: "List all active provisioned virtual cards.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "get_card_details",
                description: "Reveal full card details (PAN, CVV, Expiry) for a specific card token.",
                inputSchema: {
                    type: "object",
                    properties: {
                        token: { type: "string", description: "The Lithic card token" },
                    },
                    required: ["token"],
                },
            }
        ],
    };
});
// 2. Handle Tool Execution
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    try {
        switch (request.params.name) {
            case "provision_card": {
                const args = request.params.arguments;
                const merchant = args?.merchant;
                const amount = args?.amount;
                const res = await (0, node_fetch_1.default)(`${API_BASE}/issue-card`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ merchant, amount }),
                });
                const data = await res.json();
                return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
            }
            case "list_cards": {
                const res = await (0, node_fetch_1.default)(`${API_BASE}/cards`);
                const data = await res.json();
                return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
            }
            case "get_card_details": {
                const args = request.params.arguments;
                const token = args?.token;
                const res = await (0, node_fetch_1.default)(`${API_BASE}/cards/${token}`);
                const data = await res.json();
                return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
            }
            default:
                throw new Error(`Unknown tool: ${request.params.name}`);
        }
    }
    catch (error) {
        return { content: [{ type: "text", text: `Error executing tool: ${error.message}` }] };
    }
});
// 3. Start the Server over Stdio
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error("PayPer Card MCP Server running on stdio");
}
main().catch(console.error);
