# Meridian Code Review

**Reviewer:** Senior Security Auditor  
**Date:** 2026-04-06  
**Scope:** All `.js` files except `node_modules/` and `test/`  
**Model:** claude-opus-4-5 via Anthropic API

---

## CRITICAL Issues (Must Fix)

### 1. HARDCODED JUPITER API KEY 🔴

**File:** `tools/wallet.js`  
**Lines:** ~line with `const JUPITER_API_KEY = "b15d42e9-e0e4-4f90-a424-ae41ceeaa382";`

```javascript
const JUPITER_API_KEY = "b15d42e9-e0e4-4f90-a424-ae41ceeaa382";
```

This is a **live Jupiter API key hardcoded in source code**. It is not a placeholder — it is an actual key that works. This is a severe security violation:

- Key is visible in source code, commits, and any copy of the repo
- Cannot be rotated without modifying source
- Any person with repo access can use the key
- If key is rate-limited or quota-exhausted, all users of this code suffer

**Fix:** Use `process.env.JUPITER_API_KEY` and require the key via environment.

---

### 2. DRY_RUN BYPASS IN SAFETY CHECKS 🔴

**File:** `tools/executor.js`

The `runSafetyChecks()` function does NOT check `DRY_RUN` for `swap_token`. More critically, for `deploy_position`:

```javascript
// Check SOL balance
if (process.env.DRY_RUN !== "true") {
  const balance = await getWalletBalances();
  // ... validates balance
}
```

This means safety checks (max positions, duplicate pool, balance) run even in DRY_RUN mode. While `deployPosition` itself checks DRY_RUN later, there is an inconsistency: **the safety check validates real on-chain state (positions, balance) even when DRY_RUN is true**, which gives misleading feedback.

Additionally, `swap_token`'s DRY_RUN check in `wallet.js` is correctly placed inside the function, but `runSafetyChecks` for `swap_token` is a no-op and doesn't enforce DRY_RUN.

**Fix:** Add DRY_RUN check at the top of `runSafetyChecks()` for all write tools, or make the balance check conditional on DRY_RUN not being set.

---

### 3. AUTO-SWAP SWALLOWS ERRORS SILENTLY 🔴

**File:** `tools/executor.js`, `tools/dlmm.js`

In `executeTool()`, after `close_position` succeeds:
```javascript
} catch (e) {
  log("executor_warn", `Auto-swap after close failed: ${e.message}`);
}
```

The error is logged but **not returned to the LLM**. The LLM assumes the swap happened and won't retry. If auto-swap fails:
- User loses potential SOL recovery
- LLM has incorrect state (thinks it swapped, but didn't)
- No retry mechanism

Same pattern in `dlmm.js` `claimFees` → auto-swap:
```javascript
} catch (e) {
  log("executor_warn", `Auto-swap after claim failed: ${e.message}`);
}
```

**Fix:** Return a `warning` field in the result so the LLM knows the auto-swap failed and can decide whether to retry.

---

## WARNINGS (Should Fix)

### 4. INCONSISTENT DRY_RUN HANDLING ACROSS TOOLS

**Files:** `tools/dlmm.js`, `tools/wallet.js`

- `deployPosition`: checks DRY_RUN and returns `{ dry_run: true }` ✅
- `closePosition`: checks DRY_RUN and returns `{ dry_run: true }` ✅
- `claimFees`: checks DRY_RUN and returns `{ dry_run: true }` ✅
- `swapToken`: checks DRY_RUN and returns `{ dry_run: true }` ✅

All write tools handle DRY_RUN. However, the safety checks (`runSafetyChecks`) do not account for DRY_RUN, creating the issue noted above.

**Fix:** Make safety checks DRY_RUN-aware.

---

### 5. POSITIONS CACHE STALENESS RISK

**File:** `tools/dlmm.js`

```javascript
const POSITIONS_CACHE_TTL = 5 * 60_000; // 5 minutes
```

If DRY_RUN is toggled, or if on-chain state changes, the cache could mislead the agent:
- `getMyPositions({ force: true })` in safety checks bypasses cache TTL but...
- The safety check in `deploy_position` does `getMyPositions({ force: true })` which refreshes the cache
- But `_positionsCacheAt` is reset after deploy/close, not before safety checks

**Fix:** Ensure safety checks get fresh data, not just `force: true`.

---

### 6. OKX AUTH CHECK HAS WEAK PLACEHOLDER DETECTION

**File:** `tools/okx.js`

```javascript
function hasAuth() {
  return !!(OKX_API_KEY && OKX_SECRET_KEY && OKX_PASSPHRASE && !/enter your passphrase here/i.test(OKX_PASSPHRASE));
}
```

The regex `!/enter your passphrase here/i` is a weak placeholder detector. If someone sets `OKX_PASSPHRASE="Enter your passphrase here"` (capitalization differs), the check passes incorrectly. More importantly, having a passphrase that looks like a placeholder is treated as authenticated, which is wrong.

**Fix:** Use a stronger pattern or require that the passphrase environment variable is explicitly set and non-empty.

---

### 7. SWAP_TOKEN SAFETY CHECK IS A NO-OP

**File:** `tools/executor.js`

```javascript
case "swap_token": {
  // Basic check — prevent swapping when DRY_RUN is true
  // (handled inside swapToken itself, but belt-and-suspenders)
  return { pass: true };
}
```

The comment admits this is belt-and-suspenders, but it means the DRY_RUN enforcement for `swap_token` relies entirely on the implementation in `wallet.js`. If that implementation changes, there's no guardrail.

**Fix:** Either remove the comment/no-op and rely solely on `wallet.js`, or actually enforce DRY_RUN here.

---

### 8. TRAILING TP CONFIRMATION — STATE NOT SAVED ON EARLY RETURN

**File:** `state.js` → `updatePnlAndCheckExits()`

```javascript
if (new Date(pos.confirmed_trailing_exit_until).getTime() > Date.now() && pos.confirmed_trailing_exit_reason) {
  const reason = pos.confirmed_trailing_exit_reason;
  pos.confirmed_trailing_exit_reason = null;
  pos.confirmed_trailing_exit_until = null;
  save(state);  // ✅ saved
  return { action: "TRAILING_TP", reason, confirmed_recheck: true };
}
```

This is actually fine — it does save. But I initially misread the flow. However, there is a subtle issue: the 15-second recheck confirmation uses `setTimeout` but if the process crashes between confirmation and the actual close action, the trailing exit state is lost. The cron PnL poller would need to re-trigger it.

**Severity:** Low — race condition, not a common path.

---

### 9. MODEL CONFIGURATION — SHALLOW MERGE FOR SCREENING OBJECT

**File:** `config.js`

```javascript
screening: {
  ...DEFAULT_CONFIG.screening,
  ...userScreening,
}
```

This is a shallow spread. If `userScreening` has any key at the top level of `screening`, it replaces the entire nested structure. For example, if `user-config.json` has:
```json
{
  "screening": {
    "minFeeActiveTvlRatio": 0.05
  }
}
```

Then all other screening defaults (like `avoidPvpSymbols`, `athFilterPct`, `blockedLaunchpads`, etc.) would be lost because only `minFeeActiveTvlRatio` is specified.

**Fix:** Use deep merge (e.g., `deepmerge` library or recursive merge) for nested config objects, or document that users must provide complete nested objects.

---

### 10. get_my_positions TOOL IGNORES CALLER ARGS

**File:** `tools/executor.js`

```javascript
get_my_positions: getMyPositions,  // getMyPositions takes args but this passes nothing
```

`getMyPositions({ force: true })` is registered directly. When the LLM calls `get_my_positions({ force: false })`, the `false` is ignored because the tool map entry doesn't pass through args. This is actually **correct behavior** for this codebase (you always want fresh data for position management), but it's implicit and not obvious.

**Fix:** Document this behavior or wrap it: `get_my_positions: (args) => getMyPositions({ force: true })`.

---

## INFO Notes

### 11. WALLET PRIVATE KEY HANDLING ✅

**File:** `tools/wallet.js`, `tools/dlmm.js`

Private key handling is reasonably secure:
- Read from `WALLET_PRIVATE_KEY` env var only
- Decoded with `bs58.decode()` and converted to Keypair at runtime
- Never written to disk
- Lazy initialization avoids crash if key not set

**Note:** The key is in memory as a Uint8Array. If the process is compromised, the key could be extracted from memory. This is inherent to software wallets and not a bug here.

---

### 12. TP/SL LOGIC IMPLEMENTATION ✅

**Files:** `state.js`, `index.js`

Stop loss and take profit are implemented with appropriate guards:
- `pnl_pct_suspicious` check prevents bad API data from triggering exits
- 15-second confirmation delay for trailing TP prevents false signals
- `trailingTriggerPct` and `trailingDropPct` null checks are correct (comparisons with null return false)
- OOR checks include age/time conditions to avoid premature closes

The trailing TP confirmation system is sophisticated:
- `queuePeakConfirmation` → `schedulePeakConfirmation` (15s timer)
- `resolvePendingPeak` confirms peak after recheck
- `queueTrailingDropConfirmation` → `scheduleTrailingDropConfirmation`
- `resolvePendingTrailingDrop` validates drop is sustained

---

### 13. ERROR HANDLING — GENERALLY GOOD

**Files:** Throughout

Most async operations have `.catch()` handlers:
- `getMyPositions` wrapped in try/catch with fallback
- PnL poller has `finally { _pnlPollBusy = false }` 
- Telegram handlers wrapped in try/catch
- Tool executions wrapped in try/catch in `executeTool`

**Minor concern:** The fire-and-forget pattern in several places:
```javascript
runManagementCycle().catch((e) => log("cron_error", `...`));
```
If the cron system is misconfigured, these errors could accumulate silently.

---

### 14. SELF_UPDATE SAFETY ✅

**File:** `tools/executor.js`

`self_update` has strong guards:
- Requires `ALLOW_SELF_UPDATE=true` env var
- Requires `stdin.isTTY` (local interactive session only)
- Not callable from Telegram or automation

This is well-designed.

---

### 15. TELEGRAM AUTHORIZATION ✅

**File:** `telegram.js`

- `TELEGRAM_ALLOWED_USER_IDS` for group chats
- `TELEGRAM_CHAT_ID` for the specific authorized chat
- Both guards must pass for any command to execute
- Clear warning logs when messages are ignored

---

### 16. BLACKLIST/COOLDOWN SYSTEM ✅

**Files:** `token-blacklist.js`, `pool-memory.js`, `dev-blocklist.js`

Good defense-in-depth:
- Token blacklist filters before LLM sees pools
- Pool cooldowns prevent rapid re-deployment after losses
- Base mint cooldowns prevent hopping across pools with same token
- Dev blocklist filters by deployer
- All cooldowns have time limits

---

### 17. LOGGING AND AUDIT TRAIL ✅

**File:** `logger.js`

- Daily rotating log files
- JSONL format for action logs (machine-parseable)
- Separate log levels (debug, info, warn, error)
- Action hints provide human-readable summaries

---

### 18. JUPITER API KEY (SEPARATE FROM #1)

Note: The Jupiter key `b15d42e9-e0e4-4f90-a424-ae41ceeaa382` appears to be a legitimate API key from Jupiter's infrastructure. If this is a shared/integration key (not a personal one), it might be intended for public use. However, hardcoding any credential is still bad practice.

---

## Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| CRITICAL | 3 | Hardcoded API key, DRY_RUN bypass, silent auto-swap failures |
| WARNING | 6 | DRY_RUN inconsistency, cache staleness, weak placeholder detection, no-op safety check, shallow config merge, tool arg passthrough |
| INFO | 8 | Generally good: wallet security, TP/SL logic, error handling, self-update safety, Telegram auth, blacklist system |

**Priority Actions:**
1. Move Jupiter API key to environment variable
2. Make DRY_RUN consistent across all safety checks and tools
3. Return auto-swap errors to the LLM instead of swallowing them
4. Use deep merge for config objects
5. Remove or fix the `swap_token` safety check no-op
