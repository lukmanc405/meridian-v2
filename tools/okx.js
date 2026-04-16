/**
 * OKX DEX API helpers — public endpoints (no API key required)
 * Uses Ok-Access-Client-type: agent-cli header for unauthenticated access.
 * Docs: https://web3.okx.com/build/dev-docs/
 */
import crypto from "crypto";

const BASE = "https://web3.okx.com";
const CHAIN_SOLANA = "501";
const PUBLIC_HEADERS = { "Ok-Access-Client-type": "agent-cli" };
const OKX_API_KEY = process.env.OKX_API_KEY || process.env.OK_ACCESS_KEY || "";
const OKX_SECRET_KEY = process.env.OKX_SECRET_KEY || process.env.OK_ACCESS_SECRET || "";
const OKX_PASSPHRASE = process.env.OKX_PASSPHRASE || process.env.OK_ACCESS_PASSPHRASE || "";
const OKX_PROJECT_ID = process.env.OKX_PROJECT_ID || process.env.OK_ACCESS_PROJECT || "";

function hasAuth() {
  return !!(OKX_API_KEY && OKX_SECRET_KEY && OKX_PASSPHRASE && !/enter your passphrase here/i.test(OKX_PASSPHRASE));
}

function buildAuthHeaders(method, path, body = "") {
  const timestamp = new Date().toISOString();
  const prehash = `${timestamp}${method.toUpperCase()}${path}${body}`;
  const sign = crypto
    .createHmac("sha256", OKX_SECRET_KEY)
    .update(prehash)
    .digest("base64");

  const headers = {
    "OK-ACCESS-KEY": OKX_API_KEY,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-PASSPHRASE": OKX_PASSPHRASE,
    "OK-ACCESS-TIMESTAMP": timestamp,
  };

  if (OKX_PROJECT_ID) headers["OK-ACCESS-PROJECT"] = OKX_PROJECT_ID;
  return headers;
}

async function okxRequest(method, path, body = null) {
  const bodyText = body == null ? "" : JSON.stringify(body);
  const headers = hasAuth()
    ? { ...buildAuthHeaders(method, path, bodyText), ...(body != null ? { "Content-Type": "application/json" } : {}) }
    : { ...PUBLIC_HEADERS, ...(body != null ? { "Content-Type": "application/json" } : {}) };

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body != null ? { body: bodyText } : {}),
  });
  if (!res.ok) throw new Error(`OKX API ${res.status}: ${path}`);
  const json = await res.json();
  if (json.code !== "0" && json.code !== 0) throw new Error(`OKX error ${json.code}: ${json.msg || json.message || "unknown"}`);
  return json.data;
}

async function okxGet(path) {
  return okxRequest("GET", path);
}

async function okxPost(path, body) {
  return okxRequest("POST", path, body);
}

const pct = (v) => v != null && v !== "" ? parseFloat(v) : null;
const int = (v) => v != null && v !== "" ? parseInt(v, 10) : null;

function isAffirmative(label) {
  return typeof label === "string" && label.trim().toLowerCase() === "yes";
}

function collectRiskEntries(section) {
  if (!section || typeof section !== "object") return [];
  return [
    ...(Array.isArray(section.highRiskList) ? section.highRiskList : []),
    ...(Array.isArray(section.middleRiskList) ? section.middleRiskList : []),
    ...(Array.isArray(section.lowRiskList) ? section.lowRiskList : []),
  ];
}

/**
 * Token risk flags from OKX's nested risk check endpoint.
 * Rugpull is informational only; wash trading is used as a hard filter upstream.
 */
export async function getRiskFlags(tokenAddress, chainId = CHAIN_SOLANA) {
  const ts = Date.now();
  const path = `/priapi/v1/dx/market/v2/risk/new/check?chainId=${chainId}&tokenContractAddress=${tokenAddress}&t=${ts}`;
  const data = await okxGet(path);

  const entries = [
    ...collectRiskEntries(data?.allAnalysis),
    ...collectRiskEntries(data?.swapAnalysis),
    ...collectRiskEntries(data?.contractAnalysis),
    ...collectRiskEntries(data?.extraAnalysis),
  ];

  const hasRisk = (riskKey) =>
    entries.some((entry) => entry?.riskKey === riskKey && isAffirmative(entry?.newRiskLabel));

  return {
    is_rugpull: hasRisk("isLiquidityRemoval"),
    is_wash: hasRisk("isWash"),
    risk_level: int(data?.riskLevel ?? data?.riskControlLevel),
    source: "okx-risk-check",
  };
}

/**
 * Advanced token info — risk level, bundle/sniper/suspicious %, dev rug history, token tags.
 */
export async function getAdvancedInfo(tokenAddress, chainIndex = CHAIN_SOLANA) {
  const path = `/api/v6/dex/market/token/advanced-info?chainIndex=${chainIndex}&tokenContractAddress=${tokenAddress}`;
  const data = await okxGet(path);
  const d = Array.isArray(data) ? data[0] : data;
  if (!d) return null;

  const tags = d.tokenTags || [];
  return {
    risk_level:       int(d.riskControlLevel),
    bundle_pct:       pct(d.bundleHoldingPercent),
    sniper_pct:       pct(d.sniperHoldingPercent),
    suspicious_pct:   pct(d.suspiciousHoldingPercent),
    dev_holding_pct:  pct(d.devHoldingPercent),
    top10_pct:        pct(d.top10HoldPercent),
    lp_burned_pct:    pct(d.lpBurnedPercent),
    total_fee_sol:    pct(d.totalFee),
    dev_rug_count:    int(d.devRugPullTokenCount),
    dev_token_count:  int(d.devCreateTokenCount),
    creator:          d.creatorAddress || null,
    tags,
    is_honeypot:          tags.includes("honeypot"),
    smart_money_buy:      tags.includes("smartMoneyBuy"),
    dev_sold_all:         tags.includes("devHoldingStatusSellAll"),
    dev_buying_more:      tags.includes("devHoldingStatusBuy"),
    low_liquidity:        tags.includes("lowLiquidity"),
    dex_boost:            tags.includes("dexBoost"),
    dex_screener_paid:    tags.includes("dexScreenerPaid") || tags.includes("dsPaid"),
  };
}

/**
 * Top holder clusters — trend direction, holding period, KOL presence, PnL.
 * Condenses to top N clusters for LLM consumption.
 */
export async function getClusterList(tokenAddress, chainIndex = CHAIN_SOLANA, limit = 5) {
  const path = `/api/v6/dex/market/token/cluster/list?chainIndex=${chainIndex}&tokenContractAddress=${tokenAddress}`;
  const data = await okxGet(path);
  // Public endpoint returns data.clusterList (not data[0].clustList)
  const raw = data?.clusterList ?? (Array.isArray(data) ? data[0]?.clustList ?? [] : []);
  if (!raw.length) return [];

  return raw.slice(0, limit).map((c) => {
    const hasKol = (c.clusterAddressList || []).some((a) => a.isKol);
    return {
      holding_pct:   pct(c.holdingPercent),
      trend:         c.trendType?.trendType || c.trendType || null,
      avg_hold_days: c.averageHoldingPeriod ? Math.round(parseFloat(c.averageHoldingPeriod) / 86400) : null,
      pnl_pct:       pct(c.pnlPercent),
      buy_vol_usd:   pct(c.buyVolume),
      sell_vol_usd:  pct(c.sellVolume),
      avg_buy_price: pct(c.averageBuyPriceUsd),
      has_kol:       hasKol,
      address_count: (c.clusterAddressList || []).length,
    };
  });
}

/**
 * Price info — current price, ATH (maxPrice), ATL, multi-timeframe volume + price change.
 * Also returns holders, marketCap, liquidity from this endpoint.
 */
export async function getPriceInfo(tokenAddress, chainIndex = CHAIN_SOLANA) {
  const data = await okxPost("/api/v6/dex/market/price-info", [
    { chainIndex, tokenContractAddress: tokenAddress },
  ]);
  const d = Array.isArray(data) ? data[0] : data;
  if (!d) return null;
  const price    = parseFloat(d.price    || 0);
  const maxPrice = parseFloat(d.maxPrice || 0);
  return {
    price,
    ath:              maxPrice,
    atl:              parseFloat(d.minPrice || 0),
    price_vs_ath_pct: maxPrice > 0 ? parseFloat(((price / maxPrice) * 100).toFixed(1)) : null,
    price_change_5m:  pct(d.priceChange5M),
    price_change_1h:  pct(d.priceChange1H),
    volume_5m:        pct(d.volume5M),
    volume_1h:        pct(d.volume1H),
    holders:          int(d.holders),
    market_cap:       pct(d.marketCap),
    liquidity:        pct(d.liquidity),
  };
}

/**
 * Fetch all three in parallel — use this during screening enrichment.
 */
export async function getFullTokenAnalysis(tokenAddress, chainIndex = CHAIN_SOLANA) {
  const [advanced, clusters, price] = await Promise.allSettled([
    getAdvancedInfo(tokenAddress, chainIndex),
    getClusterList(tokenAddress, chainIndex),
    getPriceInfo(tokenAddress, chainIndex),
  ]);
  return {
    advanced: advanced.status === "fulfilled" ? advanced.value : null,
    clusters: clusters.status === "fulfilled" ? clusters.value : [],
    price:    price.status    === "fulfilled" ? price.value    : null,
  };
}

/**
 * Evil Panda Technical Indicators
 * RSI(2), MACD, Bollinger Bands, Supertrend
 */

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const result = [];
  let ema = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      result.push(null);
      continue;
    }
    if (ema === null) {
      ema = sma(values.slice(i - period, i), period);
    }
    ema = values[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function rsi(values, period = 2) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function macd(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return null;
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const macdLine = closes.map((_, i) =>
    fastEma[i] != null && slowEma[i] != null ? fastEma[i] - slowEma[i] : null
  );
  const compact = macdLine.filter((value) => value != null);
  if (compact.length < signal) return null;
  const signalCompact = emaSeries(compact, signal);
  const hist = compact.map((value, i) =>
    signalCompact[i] != null ? value - signalCompact[i] : null
  ).filter((value) => value != null);
  const latestHist = hist.at(-1);
  const prevHist = hist.at(-2);
  return {
    line: roundTo(compact.at(-1), 10),
    signal: roundTo(signalCompact.filter((value) => value != null).at(-1), 10),
    histogram: roundTo(latestHist, 10),
    first_green_histogram: prevHist != null && prevHist <= 0 && latestHist > 0,
  };
}

function averageTrueRange(candles, period = 10) {
  if (candles.length <= period) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose)
    ));
  }
  return sma(trs, period);
}

function supertrend(candles, period = 10, multiplier = 3) {
  if (candles.length <= period + 1) return null;
  const states = [];

  for (let i = period; i < candles.length; i++) {
    const window = candles.slice(0, i + 1);
    const atr = averageTrueRange(window, period);
    if (atr == null) continue;

    const candle = candles[i];
    const hl2 = (candle.high + candle.low) / 2;
    const basicUpper = hl2 + multiplier * atr;
    const basicLower = hl2 - multiplier * atr;
    const prev = states.at(-1);

    const finalUpper = !prev || basicUpper < prev.finalUpper || candles[i - 1].close > prev.finalUpper
      ? basicUpper
      : prev.finalUpper;
    const finalLower = !prev || basicLower > prev.finalLower || candles[i - 1].close < prev.finalLower
      ? basicLower
      : prev.finalLower;

    let direction = "green";
    let value = finalLower;
    if (prev?.direction === "green") {
      direction = candle.close < finalLower ? "red" : "green";
    } else if (prev?.direction === "red") {
      direction = candle.close > finalUpper ? "green" : "red";
    }
    if (direction === "red") value = finalUpper;

    states.push({
      i,
      direction,
      value: roundTo(value, 10),
      finalUpper: roundTo(finalUpper, 10),
      finalLower: roundTo(finalLower, 10),
      price_above: candle.close > value,
    });
  }

  const last = states.at(-1);
  return last || null;
}

/**
 * Get Evil Panda indicators for a token on OKX exchange
 */
export async function getEvilPandaIndicators(tokenAddress) {
  try {
    const parsed = await fetchOHLCV(tokenAddress, "sol", "5m", 500);
    if (!parsed || parsed.length < 50) {
      return { error: "Insufficient candle data" };
    }

    const allCloses = parsed.map((c) => c.close);
    const latestRsi2 = rsi(allCloses, 2);
    const macdResult = macd(allCloses);
    const supertrendResult = supertrend(parsed, 10, 3);

    const rsi2Above90 = latestRsi2 != null && latestRsi2 > 90;
    const macdFirstGreen = !!macdResult?.first_green_histogram;

    return {
      rsi_2: roundTo(latestRsi2, 2),
      rsi_2_above_90: rsi2Above90,
      macd: macdResult,
      macd_first_green_histogram: macdFirstGreen,
      supertrend: supertrendResult,
      supertrend_direction: supertrendResult?.direction || null,
      supertrend_green: supertrendResult?.direction === "green",
      supertrend_price_above: !!supertrendResult?.price_above,
      evil_panda_entry_ok: supertrendResult?.direction === "green" && !!supertrendResult?.price_above,
      candles_used: parsed.length,
    };
  } catch (e) {
    return { error: e.message };
  }
}
