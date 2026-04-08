import "@solana/web3.js";
import "bs58";
import "dotenv/config";

console.log('KEY:', process.env.WALLET_PRIVATE_KEY ? 'SET' : 'NOT SET');
console.log('KEY_LEN:', (process.env.WALLET_PRIVATE_KEY || '').length);

try {
  const decoded = bs58.decode(process.env.WALLET_PRIVATE_KEY);
  console.log('DECODED_LEN:', decoded.length);
  const wallet = Keypair.fromSecretKey(decoded);
  console.log('WALLET_PUBKEY:', wallet.publicKey.toString());
} catch(e) {
  console.log('ERROR:', e.message);
}
