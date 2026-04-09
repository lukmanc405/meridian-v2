import { readFileSync, writeFileSync } from 'fs';

const content = readFileSync('/root/.openclaw/workspace/meridian/index.js', 'utf8');
const marker = 'log("startup", `Model: ${process.env.LLM_MODEL || "hermes-3-405b"}`);';

if (!content.includes(marker)) {
  console.log('Marker not found');
  process.exit(1);
}

const insert = `

// Load Darwinian signal weights
let _signalWeights = null;
try {
  _signalWeights = loadWeights();
  console.log(\`[startup] Signal weights loaded: \${Object.keys(_signalWeights.weights || {}).length} signals\`);
} catch(e) {
  console.log(\`[startup_warn] Could not load signal weights: \${e.message}\`);
  _signalWeights = { weights: {}, calibration: {} };
}
`;

const newContent = content.replace(marker, marker + insert);
writeFileSync('/root/.openclaw/workspace/meridian/index.js', newContent);
console.log('Done');
