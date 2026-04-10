/**
 * Watchdog Agent — monitors Meridian main agent health
 * Runs via cron every 5 minutes
 * Spawns diagnosis sub-agent when issues detected
 */

import "dotenv/config";
import { readFileSync, appendFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { sendMessage, isEnabled as telegramEnabled } from "./telegram.js";
import { log } from "./logger.js";
import { agentLoop } from "./agent.js";

const PROCESS_NAME = "node index.js";
const LOG_FILE = process.env.LOG_FILE || "./agent.log";
const WATCHDOG_LOG = "./watchdog.log";

const ERRORS = {
  SCREENING_TIMEOUT: { pattern: /Screening timeout/i, severity: "high" },
  TI_NOT_DEFINED: { pattern: /ti is not defined/i, severity: "high" },
  UNHANDLED_REJECT: { pattern: /Unhandled Promise Rejection/i, severity: "high" },
  CRON_ERROR: { pattern: /CRON_ERROR/i, severity: "medium" },
  RATE_LIMIT: { pattern: /429 Too Many Requests/i, severity: "low" },
  LLM_TIMEOUT: { pattern: /timeout.*screening|screening.*timeout/i, severity: "medium" },
  POSITION_ERROR: { pattern: /Position.*error|position.*fail/i, severity: "medium" },
  SCREENING_BUSY: { pattern: /Screening skipped.*previous cycle still running/i, severity: "medium" },
};

function formatDate() {
  return new Date().toISOString().slice(0, 19);
}

function logWatch(msg) {
  const entry = `[${formatDate()}] ${msg}`;
  console.log(entry);
  try {
    
    appendFileSync(WATCHDOG_LOG, entry + "\n");
  } catch {}
}

async function getRecentLogs(lines = 100) {
  try {
    
    if (!existsSync(LOG_FILE)) return [];
    const content = readFileSync(LOG_FILE, "utf8");
    const allLines = content.split("\n").filter(Boolean);
    return allLines.slice(-lines);
  } catch {
    return [];
  }
}

async function getAgentStatus() {
  try {
    
    const out = execSync(`pgrep -f "${PROCESS_NAME}" | wc -l`, { encoding: "utf8" });
    const count = parseInt(out.trim()) || 0;
    return { running: count > 0, processCount: count };
  } catch {
    return { running: false, processCount: 0 };
  }
}

function detectErrors(logs) {
  const detected = [];
  for (const [name, info] of Object.entries(ERRORS)) {
    const matches = logs.filter(l => info.pattern.test(l));
    if (matches.length > 0) {
      detected.push({
        error: name,
        severity: info.severity,
        count: matches.length,
        lastOccurrence: matches[matches.length - 1],
      });
    }
  }
  return detected.sort((a, b) => {
    const sev = { high: 0, medium: 1, low: 2 };
    return sev[a.severity] - sev[b.severity];
  });
}

function buildDiagnosisPrompt(errors, logs) {
  return `You are a debugging agent. Analyze these Meridian agent logs and fix the issues.

## ERRORS DETECTED:
${errors.map(e => `- ${e.error} (${e.severity}): ${e.count} occurrences`).join("\n")}

## LAST 50 LOG LINES:
${logs.slice(-50).join("\n")}

## YOUR TASK:
1. Identify root cause of each error
2. Apply fixes to the codebase (index.js or tools/*.js)
3. If you modify files, run 'git add -f <files>' and 'git commit' with a descriptive message
4. Report what you fixed

## COMMON FIXES:
- "ti is not defined" → Declare 'ti' before using in stagedSignals, use tokenInfoResult variable
- "Screening timeout" → Clear _screeningBusy flag, reset screening state
- "429 rate limit" → Add delay/retry logic to API calls
- "Screening skipped previous cycle still running" → Reset _screeningBusy flag

If no errors to fix, report: "NO FIX NEEDED - system healthy"

Respond with your diagnosis and actions taken.`;
}

async function notifyLuke(message) {
  if (!telegramEnabled()) {
    console.log("[WATCHDOG] Telegram not enabled, skipping notify");
    return;
  }
  try {
    await sendMessage(`🐕 WATCHDOG ALERT\n\n${message}`);
  } catch (e) {
    console.log("[WATCHDOG] Notify failed:", e.message);
  }
}

export async function runWatchdog() {
  logWatch("Watchdog run starting...");

  // Check if agent process is running
  const status = await getAgentStatus();
  if (!status.running) {
    logWatch("Agent not running! Starting...");
    await notifyLuke("🔴 Agent DOWN - auto-restarting...");
    try {
      
      execSync("cd /root/.openclaw/workspace/meridian && bash start.sh &", {
        detached: true, stdio: "ignore"
      });
      logWatch("Agent restart initiated");
    } catch (e) {
      logWatch("Restart failed: " + e.message);
    }
    return;
  }

  // Get recent logs and detect errors
  const logs = await getRecentLogs(200);
  const errors = detectErrors(logs);

  if (errors.length === 0) {
    logWatch("No errors detected - system healthy");
    return;
  }

  logWatch(`Detected ${errors.length} error(s): ${errors.map(e => e.error).join(", ")}`);

  // Notify Luke of issue
  const errorSummary = errors.map(e => `${e.error} (${e.severity})`).join(", ");
  await notifyLuke(`⚠️ Watchdog detected:\n${errorSummary}\n\nDiagnosing...`);

  // Spawn diagnosis sub-agent
  try {
    const diagnosisPrompt = buildDiagnosisPrompt(errors, logs);
    const { content } = await agentLoop(
      diagnosisPrompt,
      10, // maxSteps
      [], // sessionHistory
      "WATCHDOG",
      "z-ai/glm-5.1",
      2048,
      { requireTool: true }
    );

    logWatch("Diagnosis result:\n" + content.slice(0, 500));

    // Notify Luke of result
    await notifyLuke(`🐕 WATCHDOG DIAGNOSIS\n\n${content.slice(0, 1000)}`);

    // If NO FIX NEEDED, we're done
    if (content.includes("NO FIX NEEDED")) {
      logWatch("System healthy - no fix needed");
      return;
    }

    // Restart agent if fixes were applied
    logWatch("Fixes may have been applied - restarting agent...");
    try {
      
      execSync("pkill -f 'node index.js' 2>/dev/null; sleep 2; cd /root/.openclaw/workspace/meridian && bash start.sh &", {
        stdio: "ignore"
      });
      logWatch("Agent restarted after fixes");
      await notifyLuke("✅ Watchdog applied fixes and restarted agent");
    } catch (e) {
      logWatch("Restart failed: " + e.message);
      await notifyLuke("❌ Watchdog fix attempted but restart failed");
    }
  } catch (e) {
    logWatch("Diagnosis sub-agent failed: " + e.message);
    await notifyLuke(`❌ Watchdog diagnosis failed:\n${e.message}`);
  }
}

// Run watchdog
runWatchdog().catch(e => {
  console.log("[WATCHDOG FATAL]", e.message);
  process.exit(1);
});
