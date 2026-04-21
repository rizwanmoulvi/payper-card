const { x402Client } = require('@x402/core/client');
const client = new x402Client();
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(client)));
