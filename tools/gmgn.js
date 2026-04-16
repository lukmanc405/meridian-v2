/**
 * GMGN.ai API wrapper for smart money and market data
 * Docs: https://github.com/GMGNAI/gmgn-skills
 * 
 * Uses curl to avoid IPv6 issues with GMGN API
 */

const BASE = "https://openapi.gmgn.ai";
const API_KEY = process.env.GMGN_API_KEY || 'gmgn_solbscbaseethmonadtron';

function gmgnLog(msg) { console.log(`[GMGN] ${msg}`); }

function buildAuthQuery() {
  const timestamp = Math.floor(Date.now() / 1000);
  const client_id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { timestamp, client_id };
}

function buildUrl(path, query) {
  const qs = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${BASE}${path}?${qs}`;
}

async function curlRequest(path, queryParams = {}) {
  const { timestamp, client_id } = buildAuthQuery();
  const query = { ...queryParams, timestamp, client_id };
  const url = buildUrl(path, query);
  
  // Use curl with -4 to force IPv4 (GMGN rejects IPv6)
  const cmd = `curl -4 -s "${url}" -H "X-APIKEY: ${API_KEY}"`;
  
  try {
    const { execSync } = await import('child_process');
    const result = execSync(cmd, { encoding: 'utf8', timeout: 10000 });
    const json = JSON.parse(result);
    // Handle nested response format: { code, data: { code, data: {...} } }
    if (json.data?.data) return json.data;
    return json;
  } catch (e) {
    throw new Error(`GMGN API error: ${e.message}`);
  }
}

/**
 * Get trending tokens on Solana
 */
export async function getTrending({ interval = "1h", limit = 20 } = {}) {
  return curlRequest("/v1/market/rank", { chain: "sol", interval, limit });
}

/**
 * Get tokens in "Trenches" - new/live tokens
 */
export async function getTrenches({ type = "new_creation", limit = 50 } = {}) {
  return curlRequest("/v1/trenches", { chain: "sol", type, limit });
}

/**
 * Get detailed token info
 */
export async function getTokenInfo(address) {
  return curlRequest("/v1/token/info", { chain: "sol", address });
}

/**
 * Get smart money / KOL trades for a token
 */
export async function getTokenTraders(address, { side = "buy", limit = 20 } = {}) {
  return curlRequest("/v1/market/token_top_traders", { chain: "sol", address, side, limit });
}

/**
 * Get wallets holdings for a given wallet
 */
export async function getWalletHoldings(address, { limit = 50 } = {}) {
  return curlRequest("/v1/user/wallet_holdings", { chain: "sol", wallet_address: address, limit });
}

/**
 * Get recent trades by smart money wallets
 */
export async function getSmartMoneyTrades({ side = "buy", limit = 20 } = {}) {
  return curlRequest("/v1/user/smartmoney", { chain: "sol", side, limit });
}

/**
 * Get KOL trades
 */
export async function getKolTrades({ side = "buy", limit = 20 } = {}) {
  return curlRequest("/v1/user/kol", { chain: "sol", side, limit });
}

/**
 * Parse trending response to get pool addresses useful for DLMM
 * Returns array of { address, symbol, name, volume, smart_degen_count, rug_ratio }
 */
export async function getTrendingPools({ interval = "1h", limit = 20, minSmartDegen = 1 } = {}) {
  try {
    const data = await getTrending({ interval, limit });
    const pools = data?.data?.rank || [];
    
    return pools
      .filter(p => 
        p.smart_degen_count >= minSmartDegen &&
        p.rug_ratio < 0.5 && // Not a rug
        !p.is_honeypot
      )
      .map(p => ({
        address: p.address,
        symbol: p.symbol,
        name: p.name,
        price: p.price,
        volume_1h: p.volume,
        market_cap: p.market_cap,
        liquidity: p.liquidity,
        smart_degen_count: p.smart_degen_count || 0,
        renowned_count: p.renowned_count || 0,
        bundler_rate: p.bundler_rate || 0,
        rug_ratio: p.rug_ratio || 0,
        holder_count: p.holder_count || 0,
        buys: p.buys || 0,
        sells: p.sells || 0,
        is_open_source: p.is_open_source || 0,
        is_renounced: p.is_renounced || 0,
        renounced_mint: p.renounced_mint || 0,
        renounced_freeze: p.renounced_freeze_account || 0,
      }));
  } catch (e) {
    gmgnLog(`getTrendingPools error: ${e.message}`);
    return [];
  }
}

/**
 * Get smart money signal score for a pool (0-100)
 * Higher = more smart money interest
 */
export function getSmartMoneyScore(pool) {
  let score = 0;
  
  // Smart degen count (max 40 points)
  score += Math.min((pool.smart_degen_count || 0) * 10, 40);
  
  // Renowned/KOL count (max 30 points)
  score += Math.min((pool.renowned_count || 0) * 15, 30);
  
  // Low bundler rate = organic (max 20 points)
  const bundlerRate = pool.bundler_rate || 0;
  if (bundlerRate < 0.2) score += 20;
  else if (bundlerRate < 0.4) score += 10;
  
  // Low rug ratio (max 10 points)
  score += Math.max(10 - (pool.rug_ratio || 0) * 20, 0);
  
  return Math.min(score, 100);
}
