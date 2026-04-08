import "dotenv/config";
import { getWalletBalances } from "./tools/wallet.js";

console.log('ENV_WALLET:', !!process.env.WALLET_PRIVATE_KEY);
console.log('ENV_KEY_START:', (process.env.WALLET_PRIVATE_KEY || 'NONE').substring(0, 10));

const result = await getWalletBalances();
console.log('RESULT:', JSON.stringify(result, null, 2));
