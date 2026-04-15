const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

// Update both startPolling calls to include callback handler
content = content.replace(
  /startPolling\(telegramHandler\)/g,
  'startPolling(telegramHandler, telegramCallbackHandler)'
);

// Find where telegramHandler is defined and add callback handler after it
const marker = 'async function telegramHandler(msg) {';
const callbackHandler = `

async function telegramCallbackHandler(callback) {
  const data = callback.data;
  const callbackId = callback.id;
  const userId = String(callback.from?.id);
  
  try {
    if (data === 'menu') {
      await sendWithInlineMenu(callbackId);
    } else if (data === 'balance') {
      const { getWalletBalances } = await import('./tools/wallet.js');
      const bal = await getWalletBalances({ force: true });
      const sol = bal.sol.toFixed(3);
      const usdc = bal.usdc.toFixed(2);
      await sendMessage("💰 Balance\\n◎ " + sol + " SOL\\n$ " + usdc + " USDC");
      await answerCallback(callbackId);
    } else if (data === 'positions') {
      const { getMyPositions } = await import('./tools/dlmm.js');
      const { positions, total_positions } = await getMyPositions({ force: true });
      if (total_positions === 0) {
        await sendMessage('No open positions.');
      } else {
        const lines = positions.map((p, i) => {
          const pnl = p.pnl_usd >= 0 ? '+$'+p.pnl_usd.toFixed(2) : '-$'+Math.abs(p.pnl_usd).toFixed(2);
          const age = p.age_minutes != null ? p.age_minutes+'m' : '?';
          const oor = !p.in_range ? ' ⚠️OOR' : '';
          return (i+1)+'. '+p.pair+' | $'+p.total_value_usd.toFixed(2)+' | PnL: '+pnl+' | '+age+oor;
        });
        await sendMessage('📊 Open Positions ('+total_positions+'):\\n\\n'+lines.join('\\n'));
      }
      await answerCallback(callbackId);
    } else if (data === 'status') {
      const { getMyPositions } = await import('./tools/dlmm.js');
      const { getWalletBalances } = await import('./tools/wallet.js');
      const [bal, { total_positions }] = await Promise.all([getWalletBalances({ force: true }), getMyPositions({ force: true })]);
      await sendMessage('📊 Status\\n💰 '+bal.sol.toFixed(3)+' SOL | '+total_positions+' positions open');
      await answerCallback(callbackId);
    } else {
      await answerCallback(callbackId, 'Unknown option');
    }
  } catch(e) {
    await sendMessage('Error: '+e.message);
    await answerCallback(callbackId);
  }
}

async function sendWithInlineMenu(callbackId) {
  const text = '📋 Menu';
  const buttons = [
    [{ text: '💰 Balance', callback_data: 'balance' }, { text: '📊 Positions', callback_data: 'positions' }],
    [{ text: '📋 Status', callback_data: 'status' }, { text: 'ℹ️ Help', callback_data: 'help' }],
  ];
  await sendWithButtons(text, buttons);
}
`;

content = content.replace(marker, callbackHandler + marker);

fs.writeFileSync('index.js', content);
console.log('Done');
