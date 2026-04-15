#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';

const INDEX = '/root/.openclaw/workspace/meridian/index.js';
let content = readFileSync(INDEX, 'utf8');

// 1. Add sendWithButtons import if not already there
if (!content.includes('sendWithButtons')) {
  content = content.replace(
    'import { startPolling, stopPolling, sendMessage, sendHTML, sendWithReplyKeyboard, answerCallback',
    'import { startPolling, stopPolling, sendMessage, sendHTML, sendWithReplyKeyboard, sendWithButtons, answerCallback'
  );
}

// 2. Update startPolling calls to include callback handler
content = content.replace(
  'startPolling(telegramHandler);',
  'startPolling(telegramHandler, telegramCallbackHandler);'
);

// 3. Add callback handler function after telegramHandler
const marker = 'async function telegramHandler(msg) {';
const callbackHandler = `
async function telegramCallbackHandler(callback) {
  const data = callback.data;
  const callbackId = callback.id;
  try {
    if (data === 'menu') {
      await sendWithInlineMenu();
    } else if (data === 'balance') {
      const { getWalletBalances } = await import('./tools/wallet.js');
      const bal = await getWalletBalances({ force: true });
      await sendMessage('Balance: ' + bal.sol.toFixed(3) + ' SOL | $' + bal.usdc.toFixed(2) + ' USDC');
      await answerCallback(callbackId);
    } else if (data === 'positions') {
      const { getMyPositions } = await import('./tools/dlmm.js');
      const { positions, total_positions } = await getMyPositions({ force: true });
      if (total_positions === 0) {
        await sendMessage('No open positions.');
      } else {
        const lines = positions.map((p, i) => {
          const pnl = p.pnl_usd >= 0 ? '+$' + p.pnl_usd.toFixed(2) : '-$' + Math.abs(p.pnl_usd).toFixed(2);
          return (i+1) + '. ' + p.pair + ' | $' + p.total_value_usd.toFixed(2) + ' | PnL: ' + pnl;
        });
        await sendMessage('Positions (' + total_positions + '):\\n' + lines.join('\\n'));
      }
      await answerCallback(callbackId);
    } else if (data === 'status') {
      const { getMyPositions } = await import('./tools/dlmm.js');
      const { getWalletBalances } = await import('./tools/wallet.js');
      const [bal, { total_positions }] = await Promise.all([getWalletBalances({ force: true }), getMyPositions({ force: true })]);
      await sendMessage('Status: ' + bal.sol.toFixed(3) + ' SOL | ' + total_positions + ' open positions');
      await answerCallback(callbackId);
    } else {
      await answerCallback(callbackId, 'Unknown');
    }
  } catch(e) {
    await sendMessage('Error: ' + e.message);
    await answerCallback(callbackId);
  }
}

async function sendWithInlineMenu() {
  const text = '📋 Menu';
  const buttons = [
    [{ text: '💰 Balance', callback_data: 'balance' }, { text: '📊 Positions', callback_data: 'positions' }],
    [{ text: '📋 Status', callback_data: 'status' }, { text: 'ℹ️ Help', callback_data: 'help' }],
  ];
  await sendWithButtons(text, buttons);
}
`;

if (!content.includes('telegramCallbackHandler')) {
  content = content.replace(marker, callbackHandler + '\\n' + marker);
}

writeFileSync(INDEX, content);
console.log('Done');
