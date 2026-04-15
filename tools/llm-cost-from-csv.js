#!/usr/bin/env node
/**
 * Parse OpenRouter CSV and generate cost report
 * 
 * Usage:
 *   node tools/llm-cost-from-csv.js <csv-file>
 */

import fs from 'fs';

const MODEL_ALIASES = {
  'openai/gpt-4o-mini': 'GPT-4o Mini',
  'anthropic/claude-sonnet-4.5': 'Claude Sonnet 4.5',
  'anthropic/claude-sonnet-4.6': 'Claude Sonnet 4.6',
  'deepseek/deepseek-chat': 'DeepSeek Chat',
  'qwen/qwen-2.5-72b-instruct': 'Qwen 2.5-72B',
  'stepfun/step-3.5-flash': 'StepFun 3.5',
  'minimax/minimax-m2.7': 'MiniMax M2.7',
};

function parseCSV(csv) {
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  
  const data = {};
  let total = { cost: 0, requests: 0, promptTokens: 0, completionTokens: 0 };
  let byDate = {};
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
    const row = {};
    header.forEach((h, idx) => row[h] = values[idx]);
    
    const date = row['Date']?.slice(0, 10);
    const model = row['Slug'];
    const cost = parseFloat(row['Usage'] || 0);
    const requests = parseInt(row['Requests'] || 0);
    const promptTokens = parseInt(row['Prompt Tokens'] || 0);
    const completionTokens = parseInt(row['Completion Tokens'] || 0);
    
    if (!data[model]) {
      data[model] = { cost: 0, requests: 0, promptTokens: 0, completionTokens: 0 };
    }
    data[model].cost += cost;
    data[model].requests += requests;
    data[model].promptTokens += promptTokens;
    data[model].completionTokens += completionTokens;
    
    total.cost += cost;
    total.requests += requests;
    total.promptTokens += promptTokens;
    total.completionTokens += completionTokens;
    
    if (!byDate[date]) byDate[date] = { cost: 0 };
    byDate[date].cost += cost;
  }
  
  return { data, total, byDate };
}

function formatReport(parsed) {
  let report = '\n📊 OpenRouter LLM Cost Report\n';
  report += '═'.repeat(60) + '\n\n';
  
  const sorted = Object.entries(parsed.data).sort((a, b) => b[1].cost - a[1].cost);
  
  report += '┌' + '─'.repeat(50) + '┐\n';
  report += '│ MODEL BREAKDOWN                          Cost       │\n';
  report += '├' + '─'.repeat(50) + '┤\n';
  
  for (const [model, stats] of sorted) {
    const name = MODEL_ALIASES[model] || model;
    const shortName = name.length > 30 ? name.slice(0, 27) + '...' : name;
    report += `│ ${shortName.padEnd(31)} $${stats.cost.toFixed(4).padStart(8)} ${stats.requests.toString().padStart(4)} req │\n`;
  }
  
  report += '├' + ' '.repeat(50) + '┤\n';
  report += `│ ${'TOTAL'.padEnd(31)} $${parsed.total.cost.toFixed(4).padStart(8)} ${parsed.total.requests.toString().padStart(4)} req │\n';
  report += '└' + '─'.repeat(50) + '┘\n';
  
  report += '\n📈 TOKEN USAGE\n';
  report += '─'.repeat(40) + '\n';
  report += `  Prompt Tokens:     ${parsed.total.promptTokens.toLocaleString()}\n`;
  report += `  Completion Tokens:  ${parsed.total.completionTokens.toLocaleString()}\n`;
  report += `  Total Tokens:      ${(parsed.total.promptTokens + parsed.total.completionTokens).toLocaleString()}\n`;
  
  return report;
}

// Main
const input = process.argv[2] 
  ? fs.readFileSync(process.argv[2], 'utf8')
  : fs.readFileSync('/dev/stdin', 'utf8');

const parsed = parseCSV(input);
console.log(formatReport(parsed));

if (process.argv.includes('--json')) {
  console.log('\n---\n');
  console.log(JSON.stringify({
    models: parsed.data,
    total: parsed.total,
    byDate: parsed.byDate
  }, null, 2));
}
