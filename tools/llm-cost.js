#!/usr/bin/env node
/**
 * LLM Cost Calculator for Meridian
 * Calculates token usage and cost from OpenRouter API or local logs
 * 
 * Usage:
 *   node tools/llm-cost.js                    # Today's summary
 *   node tools/llm-cost.js --date 2026-04-14  # Specific date
 *   node tools/llm-cost.js --model gpt-4o-mini # Filter by model
 *   node tools/llm-cost.js --json            # JSON output
 *   node tools/llm-cost.js --csv             # CSV output
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, '../logs');

// Model pricing (per 1M tokens) - OpenRouter standard rates
const MODEL_PRICING = {
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  'openai/gpt-4o': { input: 2.50, output: 10.00 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  'anthropic/claude-sonnet-4.5': { input: 3.00, output: 15.00 },
  'anthropic/claude-sonnet-4.6': { input: 3.00, output: 15.00 },
  'deepseek/deepseek-chat': { input: 0.14, output: 0.28 },
  'qwen/qwen-2.5-72b-instruct': { input: 0.50, output: 1.00 },
  'stepfun/step-3.5-flash': { input: 0.05, output: 0.10 },
  'stepfun/step-3.5-flash:free': { input: 0, output: 0 },
  'minimax/minimax-m2.7': { input: 0.10, output: 0.40 },
  'openrouter/healer-alpha': { input: 0.10, output: 0.40 },
  'openrouter/hunter-alpha': { input: 0.10, output: 0.40 },
  'z-ai/glm-5.1': { input: 0.10, output: 0.40 },
};

// Default pricing for unknown models
const DEFAULT_PRICING = { input: 0.10, output: 0.50 };

// Parse command line args
const args = process.argv.slice(2);
const options = {
  date: new Date().toISOString().slice(0, 10),
  model: null,
  json: args.includes('--json'),
  csv: args.includes('--csv'),
  help: args.includes('--help') || args.includes('-h'),
};

for (const arg of args) {
  if (arg.startsWith('--date=')) options.date = arg.split('=')[1];
  else if (arg.startsWith('--model=')) options.model = arg.split('=')[1];
}

// Parse action logs to extract token usage
function parseActionLogs(date) {
  const logFile = path.join(LOGS_DIR, `actions-${date}.jsonl`);
  if (!fs.existsSync(logFile)) {
    return { tokens: { input: 0, output: 0 }, cost: 0, requests: 0 };
  }

  const content = fs.readFileSync(logFile, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  
  let totalInput = 0;
  let totalOutput = 0;
  let requests = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      requests++;
      // Note: action logs may not have token info, this is for future expansion
    } catch (e) {}
  }

  return { tokens: { input: totalInput, output: totalOutput }, cost: 0, requests };
}

// Parse agent logs for model usage
function parseAgentLogs(date) {
  const logFile = path.join(LOGS_DIR, `agent-${date}.log`);
  if (!fs.existsSync(logFile)) {
    return [];
  }

  const content = fs.readFileSync(logFile, 'utf8');
  const lines = content.trim().split('\n');
  
  const usage = {};
  
  // Pattern: [model: model-name] or [CRON] Starting screening cycle [model: ...]
  const modelPattern = /\[model:\s*([^\]]+)\]/g;
  const stepPattern = /\[AGENT\]\s*Step\s+(\d+)\/(\d+)/g;
  
  let match;
  while ((match = modelPattern.exec(content)) !== null) {
    const model = match[1].trim();
    if (!usage[model]) {
      usage[model] = { requests: 0, steps: 0 };
    }
    usage[model].requests++;
  }
  
  // Count steps
  const stepMatches = content.matchAll(/\[AGENT\]\s*Step\s+(\d+)\//g);
  for (const m of stepMatches) {
    const step = parseInt(m[1]);
    for (const model in usage) {
      usage[model].steps += step;
    }
    break; // Just count total steps, not per model
  }

  return Object.entries(usage).map(([model, data]) => ({
    model,
    ...data
  }));
}

// Calculate cost from OpenRouter CSV data
function calculateCostFromCSV(csvContent, options = {}) {
  const lines = csvContent.trim().split('\n');
  const header = lines[0].split(',');
  
  const results = {};
  let grandTotal = { cost: 0, requests: 0, promptTokens: 0, completionTokens: 0 };
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.replace(/"/g, ''));
    const row = {};
    header.forEach((h, idx) => row[h.trim()] = values[idx]);
    
    const date = row['Date']?.slice(0, 10);
    const model = row['Slug'];
    const cost = parseFloat(row['Usage'] || 0);
    const requests = parseInt(row['Requests'] || 0);
    const promptTokens = parseInt(row['Prompt Tokens'] || 0);
    const completionTokens = parseInt(row['Completion Tokens'] || 0);
    
    if (options.date && date !== options.date) continue;
    if (options.model && !model.includes(options.model)) continue;
    
    if (!results[model]) {
      results[model] = { cost: 0, requests: 0, promptTokens: 0, completionTokens: 0 };
    }
    
    results[model].cost += cost;
    results[model].requests += requests;
    results[model].promptTokens += promptTokens;
    results[model].completionTokens += completionTokens;
    
    grandTotal.cost += cost;
    grandTotal.requests += requests;
    grandTotal.promptTokens += promptTokens;
    grandTotal.completionTokens += completionTokens;
  }
  
  return { models: results, total: grandTotal };
}

// Main execution
function main() {
  if (options.help) {
    console.log(`
LLM Cost Calculator

Usage:
  node tools/llm-cost.js [options]

Options:
  --date=YYYY-MM-DD    Filter by date (default: today)
  --model=NAME         Filter by model name
  --json               Output as JSON
  --csv                Output as CSV format
  --help, -h           Show this help

Examples:
  node tools/llm-cost.js                    # Today's summary
  node tools/llm-cost.js --date=2026-04-14  # Specific date
  node tools/llm-cost.js --model=gpt        # Filter by model
  node tools/llm-cost.js --json             # JSON output
`);
    return;
  }

  // Check for OpenRouter API key for live data
  const apiKey = process.env.OPENROUTER_API_KEY;
  
  if (options.csv) {
    // Read local CSV if provided via stdin or file
    console.log('CSV output mode - provide OpenRouter CSV file path');
    return;
  }

  // Use agent logs for estimation
  const agentUsage = parseAgentLogs(options.date);
  
  if (agentUsage.length === 0) {
    console.log(`No agent logs found for ${options.date}`);
    process.exit(0);
  }

  let grandTotal = 0;
  
  if (options.json) {
    const output = {
      date: options.date,
      models: {},
      totalCost: 0,
    };
    
    for (const usage of agentUsage) {
      const pricing = MODEL_PRICING[usage.model] || DEFAULT_PRICING;
      const estCost = (usage.steps * pricing.output / 1000000); // rough estimate
      output.models[usage.model] = {
        requests: usage.requests,
        steps: usage.steps,
        estimatedCost: estCost,
      };
      output.totalCost += estCost;
      grandTotal += estCost;
    }
    
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`\n📊 LLM Usage Summary - ${options.date}\n`);
    console.log('─'.repeat(60));
    
    for (const usage of agentUsage) {
      const pricing = MODEL_PRICING[usage.model] || DEFAULT_PRICING;
      const estCost = (usage.steps * pricing.output / 1000000);
      
      console.log(`\n${usage.model}`);
      console.log(`  Requests: ${usage.requests}`);
      console.log(`  Steps: ${usage.steps}`);
      console.log(`  Est. Cost: $${estCost.toFixed(4)}`);
      
      grandTotal += estCost;
    }
    
    console.log('\n' + '─'.repeat(60));
    console.log(`\n💰 Total Estimated Cost: $${grandTotal.toFixed(4)}\n`);
  }
}

// Run if called directly
main();

export { calculateCostFromCSV, MODEL_PRICING };
