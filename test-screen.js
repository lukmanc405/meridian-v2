import "dotenv/config";
import { getTopCandidates } from "./tools/screening.js";

console.log('Testing candidates...');
try {
  const result = await getTopCandidates({ limit: 1 });
  console.log('RESULT:', JSON.stringify(result, null, 2));
} catch(e) {
  console.log('ERROR:', e.message);
  console.log('STACK:', e.stack);
}
