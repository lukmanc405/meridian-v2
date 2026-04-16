/**
 * GMGN.ai API wrapper for smart money and market data
 * Docs: https://github.com/GMGNAI/gmgn-skills
 */

const BASE = "https://api.gmgn.ai/v1";
const CHAIN = "sol";

export async function gmgnRequest(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 
      "Authorization": `Bearer ${process.env.GMGN_API_KEY || 'gmgn_solbscbaseethmonadtron'}`,
      "Accept": "application/json"
    }
  });
  if (!res.ok) throw new Error(`GMGN API error: ${res.status}`);
  return res.json();
}

/**
 * Get trending tokens on Solana
 */
export async function getTrending({ interval = "1h", limit = 20 } = {}) {
  return gmgnRequest(`/trending/${CHAIN}?interval=${interval}&limit=${limit}`);
}

/**
 * Get tokens in "Trenches" - new/live tokens
 */
export async function getTrenches({ type = "new_creation", limit = 50 } = {}) {
  return gmgnRequest(`/trenches/${CHAIN}?type=${type}&limit=${limit}`);
}

/**
 * Get detailed token info
 */
export async function getTokenInfo(address) {
  return gmgnRequest(`/token/${CHAIN}/${address}`);
}

/**
 * Get smart money / KOL trades for a token
 */
export async function getTokenTraders(address, { side = "buy", limit = 20 } = {}) {
  return gmgnRequest(`/traders/${CHAIN}/${address}?side=${side}&limit=${limit}`);
}

/**
 * Get wallets holdings for a given wallet
 */
export async function getWalletHoldings(address, { limit = 50 } = {}) {
  return gmgnRequest(`/wallet/${CHAIN}/${address}/holdings?limit=${limit}`);
}

/**
 * Get recent trades by smart money wallets
 */
export async function getSmartMoneyTrades({ side = "buy", limit = 20 } = {}) {
  return gmgnRequest(`/smartmoney/${CHAIN}/trades?side=${side}&limit=${limit}`);
}

/**
 * Get KOL trades
 */
export async function getKolTrades({ side = "buy", limit = 20 } = {}) {
  return gmgnRequest(`/kol/${CHAIN}/trades?side=${side}&limit=${limit}`);
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
        smart_degen_count: p.smart_degen_count,
        renowned_count: p.renowned_count,
        bundler_rate: p.bundler_rate,
        rug_ratio: p.rug_ratio,
        holder_count: p.holder_count,
        buys: p.buys,
        sells: p.sells,
        is_open_source: p.is_open_source,
        is_renounced: p.is_renounced,
        renounced_mint: p.renounced_mint,
        renounced_freeze: p.renounced_freeze_account,
      }));
  } catch (e) {
    log("gmgn", `getTrendingPools error: ${e.message}`);
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
  score += Math.min(pool.smart_degen_count * 10, 40);
  
  // Renowned/KOL count (max 30 points)
  score += Math.min(pool.renowned_count * 15, 30);
  
  // Low bundler rate = organic (max 20 points)
  if (pool.bundler_rate < 0.2) score += 20;
  else if (pool.bundler_rate < 0.4) score += 10;
  
  // Low rug ratio (max 10 points)
  score += Math.max(10 - pool.rug_ratio * 20, 0);
  
  return Math.min(score, 100);
}
