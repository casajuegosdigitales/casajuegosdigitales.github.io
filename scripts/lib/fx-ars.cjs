"use strict";

const MIN_GAME_USD = 20;
const MIN_ANCHORED_USD = 2.5;
const MIN_ACCOUNT_USD = 1.9;
const MIN_KEY_USD = 10;
const MIN_KEY_STEAM_RATIO = 0.06;
const MIN_ACCOUNT_STEAM_RATIO = 0.006;
const MIN_JSON_USD = 2.5;
const MIN_COMPRA_ARS_FALLBACK = 35000;
const PLUS_PAIR_RATIO_MIN = 0.8;
const PLUS_PAIR_RATIO_MAX = 0.97;

function isAccountItem(item) {
  const t = String(item?.tipo || item?.deliveryType || "").toLowerCase();
  return t === "cuenta" || t === "account";
}

function usdParseOptions(item) {
  if (isAccountItem(item)) return { minUsd: MIN_ACCOUNT_USD };
  const steam = Number(item?.precioSteamArs) || 0;
  if (steam > 0) return { minUsd: MIN_ANCHORED_USD };
  return { minUsd: MIN_KEY_USD };
}

function parseUsdToken(raw, minUsd = MIN_KEY_USD) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/\s/g, "");
  if (!cleaned) return null;
  let n;
  if (/,/.test(cleaned) && /\./.test(cleaned)) {
    n = Number(cleaned.replace(/\./g, "").replace(",", "."));
  } else if (/\.\d{1,2}$/.test(cleaned)) {
    n = Number(cleaned);
  } else if (/,/.test(cleaned)) {
    n = Number(cleaned.replace(",", "."));
  } else {
    n = Number(cleaned);
  }
  const floor = Number(minUsd) || MIN_KEY_USD;
  if (!n || Number.isNaN(n) || n < floor || n >= 5000) return null;
  return n;
}

function extractUsdPricesFromLine(line, minUsd = MIN_KEY_USD) {
  const prices = [];
  const text = String(line || "");
  for (const m of text.matchAll(/([\d]{1,4}(?:[.,]\d{1,2})?)\s*US\$/gi)) {
    const n = parseUsdToken(m[1], minUsd);
    if (n) prices.push(n);
  }
  for (const m of text.matchAll(/US\$\s*([\d]{1,4}(?:[.,]\d{1,2})?)/gi)) {
    const n = parseUsdToken(m[1], minUsd);
    if (n) prices.push(n);
  }
  for (const m of text.matchAll(/(?:^|[^\d])\$\s*([\d]{1,4}(?:[.,]\d{1,2})?)/g)) {
    const n = parseUsdToken(m[1], minUsd);
    if (n) prices.push(n);
  }
  return [...new Set(prices)].sort((a, b) => a - b);
}

function looksLikePlusPair(low, high) {
  if (!low || !high || low >= high) return false;
  const ratio = low / high;
  return ratio >= PLUS_PAIR_RATIO_MIN && ratio <= PLUS_PAIR_RATIO_MAX && high - low <= 20;
}

function publicUsdFromPriceGroup(prices, minUsd = MIN_KEY_USD) {
  const sorted = [...new Set((prices || []).map((p) => (typeof p === "number" ? p : parseUsdToken(p, minUsd))).filter(Boolean))].sort(
    (a, b) => a - b
  );
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];

  const publicPrices = [];
  let i = 0;
  while (i < sorted.length) {
    if (i + 1 < sorted.length && looksLikePlusPair(sorted[i], sorted[i + 1])) {
      publicPrices.push(sorted[i + 1]);
      i += 2;
      continue;
    }
    publicPrices.push(sorted[i]);
    i += 1;
  }
  return publicPrices.length ? Math.min(...publicPrices) : null;
}

function isSubscriptionBannerLine(line) {
  const t = String(line || "");
  if (!/\$|US\$/i.test(t)) return false;
  if (/safe_purchase|game zone|games queen|gamingworld|vendedor|seller|oferta destacada|recommended offer/i.test(t)) {
    return false;
  }
  return /el precio m[aá]s bajo|lowest price|king'?s pass|k plus|save \d+% with plus|ahorra con/i.test(t);
}

function isPlusDiscountLine(line) {
  const t = String(line || "");
  if (!/\$|US\$/i.test(t)) return false;
  return /king'?s pass|k plus|with plus|save.*plus|ahorra.*plus|-\s*\$[\d.,]+/i.test(t);
}

function pickPublicMinUsdFromText(text, options = {}) {
  const minUsd = options.minUsd ?? MIN_KEY_USD;
  const perLine = [];

  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    if (options.skipLine?.(line)) continue;
    if (isSubscriptionBannerLine(line)) continue;
    if (isPlusDiscountLine(line)) continue;

    const prices = extractUsdPricesFromLine(line, minUsd);
    if (!prices.length) continue;
    const pub = publicUsdFromPriceGroup(prices, minUsd);
    if (pub) perLine.push(pub);
  }

  if (!perLine.length) return null;
  return Math.min(...perLine);
}

const ANCHORED_PUBLIC_USD_PATTERNS = [
  /\+\d+\s+ofertas?\s+(?:starting at|desde)\s+US\$\s*([\d.,]+)/gi,
  /\+\d+\s+oferta\s+de\s+([\d.,]+)\s*US\$/gi,
  /\+\d+\s+offers?\s+(?:from|starting at)\s+([\d.,]+)\s*US\$/gi,
  /\+\d+\s+other\s+offers?\s+from\s+([\d.,]+)\s*US\$/gi,
  /offers?\s+starting\s+at\s+US\$\s*([\d.,]+)/gi,
  /starting\s+at\s+US\$\s*([\d.,]+)/gi,
  /(?:desde|from)\s+US\$\s*([\d.,]+)/gi,
  /\d+\s+m[aá]s\s+ofertas?[\s\S]{0,120}?a\s+partir\s+de\s*\$\s*([\d.,]+)/gi,
  /ofertas?\s+disponibles?\s+a\s+partir\s+de\s*\$\s*([\d.,]+)/gi,
  /a\s+partir\s+de\s*\$\s*([\d.,]+)/gi,
  /precio m[aá]s bajo[\s\S]{0,160}?([\d.,]+)\s*US\$/gi,
  /lowest price[\s\S]{0,160}?US\$\s*([\d.,]+)/gi,
];

function collectAnchoredPublicUsd(text) {
  const body = String(text || "");
  const found = [];
  for (const re of ANCHORED_PUBLIC_USD_PATTERNS) {
    for (const m of body.matchAll(re)) {
      const n = parseUsdToken(m[1], MIN_ANCHORED_USD);
      if (n) found.push(n);
    }
  }
  return [...new Set(found)];
}

function pickAnchoredPublicUsd(text) {
  const found = collectAnchoredPublicUsd(text);
  return found.length ? Math.min(...found) : null;
}

function collectPublicUsdFromText(text, options = {}) {
  const minUsd = options.minUsd ?? MIN_KEY_USD;
  const perLine = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    if (options.skipLine?.(line)) continue;
    if (isSubscriptionBannerLine(line)) continue;
    if (isPlusDiscountLine(line)) continue;
    const prices = extractUsdPricesFromLine(line, minUsd);
    if (!prices.length) continue;
    const pub = publicUsdFromPriceGroup(prices, minUsd);
    if (pub) perLine.push(pub);
  }
  return perLine;
}

function toArsFromUsd(amountUsd, rates) {
  const n = Number(amountUsd);
  if (!n || Number.isNaN(n)) return null;
  if (rates?.dolarDigitalVenta) {
    return Math.round(n * Number(rates.dolarDigitalVenta));
  }
  const eur = n / (rates.usdPerEur || 1.08);
  return Math.round(eur * rates.arsPerEur);
}

function toArsFromEur(amountEur, rates) {
  const n = Number(amountEur);
  if (!n || Number.isNaN(n)) return null;
  return Math.round(n * rates.arsPerEur);
}

function toArsFromForeign(amount, currency, rates) {
  const cur = String(currency || "USD").toUpperCase();
  if (cur === "ARS") return Math.round(Number(amount));
  if (cur === "EUR") return toArsFromEur(amount, rates);
  return toArsFromUsd(amount, rates);
}

function parseLoadedRawPrice(raw) {
  const n = Number(String(raw || "").replace(/,/g, ""));
  if (!n || Number.isNaN(n)) return null;
  return Math.round(n);
}

function kinguinEurToUsd(amountEur, rates) {
  const eur = Number(amountEur);
  const usdPerEur = Number(rates?.usdPerEur) || 0;
  if (!eur || !usdPerEur) return null;
  return eur * usdPerEur;
}

function kinguinPublicPriceArs(offer, rates) {
  if (!offer?.price) return null;
  const amount = Number(offer.price.amount) / 100;
  const cur = String(offer.price.currency || "EUR").toUpperCase();
  if (cur === "USD") return toArsFromUsd(amount, rates);
  if (cur === "ARS") return null;
  if (cur === "EUR") {
    const usd = kinguinEurToUsd(amount, rates);
    return usd ? toArsFromUsd(usd, rates) : null;
  }
  return null;
}

/** Compra valida solo si viene de USD publico x CriptoYa (no ARS de la pagina). */
function isUsdDerivedSource(source) {
  const s = String(source || "").toLowerCase();
  return s === "page_usd" || s === "api_usd" || s === "search" || s === "graphql";
}

function kinguinInStock(offer) {
  if (offer?.status && offer.status !== "ACTIVE") return false;
  const stock = offer?.buyableStock;
  if (stock == null) return true;
  return Number(stock) > 0;
}

function pickPublicMinPrice(priceList) {
  const prices = [...new Set(priceList.map((p) => Math.round(Number(p))).filter((p) => p > 0))].sort(
    (a, b) => a - b
  );
  return prices[0] ?? null;
}

/** Minimo USD publico sin redondear a entero (Driffle muestra centavos). */
function pickPublicMinUsdExact(priceList) {
  const prices = [...new Set(priceList.map((p) => Math.round(Number(p) * 100) / 100).filter((p) => p > 0))].sort(
    (a, b) => a - b
  );
  return prices[0] ?? null;
}

function pickPublicMinUsd(text, options = {}) {
  const anchored = pickAnchoredPublicUsd(text);
  if (anchored != null) return anchored;
  return pickPublicMinUsdFromText(text, options);
}

function isPaidExtraMerchant(name) {
  const merchant = String(name || "").toLowerCase();
  return /plus exclusive|eneba plus|driffle plus|kinguin smart|king'?s pass|k plus|smart price|members? only|subscribers? only|subscription|requires? plus/.test(
    merchant
  );
}

function driffleBestPublicArs(offers, rates) {
  if (!Array.isArray(offers) || !offers.length) return null;
  const bySeller = new Map();
  for (const o of offers) {
    const price = Number(o?.price);
    if (!price || Number.isNaN(price)) continue;
    const sid = String(o.sellerId ?? o.storeName ?? o.offerId ?? price);
    const prev = bySeller.get(sid);
    if (prev == null || price > prev) bySeller.set(sid, price);
  }
  const ars = [...bySeller.values()].map((u) => toArsFromUsd(u, rates)).filter(Boolean);
  return pickPublicMinPrice(ars);
}

function minPlausibleCompraArs(rates, item) {
  const fx = Number(rates?.dolarDigitalVenta) || 0;
  const account = isAccountItem(item);
  const steam = Number(item?.precioSteamArs) || 0;
  const absMinUsd = account ? MIN_ACCOUNT_USD : steam > 0 ? MIN_ANCHORED_USD : MIN_KEY_USD;
  const fromUsd = fx ? Math.round(absMinUsd * fx) : account ? 4000 : MIN_COMPRA_ARS_FALLBACK;
  if (steam > 0) {
    const ratio = account ? MIN_ACCOUNT_STEAM_RATIO : MIN_KEY_STEAM_RATIO;
    return Math.max(fromUsd, Math.round(steam * ratio));
  }
  return fromUsd;
}

function maxPlausibleCompraArs(item) {
  const steam = Number(item?.precioSteamArs) || 0;
  if (steam <= 0) return Infinity;
  const t = `${item?.edition || ""} ${item?.variant || ""} ${item?.fullName || ""}`;
  if (/\b(deluxe|premium|ultimate|gold|phantom|vault|complete|goty)\b/i.test(t)) {
    return Math.round(steam * 1.4);
  }
  return Math.round(steam * 1.05);
}

function isPlausibleStoreCompraArs(priceArs, item, rates) {
  const n = Math.round(Number(priceArs) || 0);
  if (n < minPlausibleCompraArs(rates, item)) return false;
  const max = maxPlausibleCompraArs(item);
  if (max !== Infinity && n > max) return false;
  return true;
}

function enebaAuctionPricesArs(edges, rates, item) {
  const minUsd = item && isAccountItem(item) ? MIN_ACCOUNT_USD : MIN_KEY_USD;
  const prices = (edges || [])
    .map((e) => e?.node)
    .filter((n) => {
      if (!n || n.isInStock === false || !n.price) return false;
      if (isPaidExtraMerchant(n.merchant?.name)) return false;
      return String(n.price.currency || "USD").toUpperCase() === "USD";
    })
    .map((n) => {
      const usd = Number(n.price.amount) / 100;
      if (usd < minUsd) return null;
      return toArsFromUsd(usd, rates);
    })
    .filter((p) => p > 0);
  return pickPublicMinPrice(prices);
}

module.exports = {
  toArsFromUsd,
  toArsFromEur,
  toArsFromForeign,
  parseLoadedRawPrice,
  kinguinPublicPriceArs,
  kinguinEurToUsd,
  kinguinInStock,
  isUsdDerivedSource,
  pickPublicMinPrice,
  pickPublicMinUsdExact,
  pickPublicMinUsd,
  pickPublicMinUsdFromText,
  collectPublicUsdFromText,
  collectAnchoredPublicUsd,
  pickAnchoredPublicUsd,
  publicUsdFromPriceGroup,
  extractUsdPricesFromLine,
  parseUsdToken,
  minPlausibleCompraArs,
  isPlausibleStoreCompraArs,
  maxPlausibleCompraArs,
  isAccountItem,
  usdParseOptions,
  MIN_GAME_USD,
  MIN_ANCHORED_USD,
  MIN_ACCOUNT_USD,
  MIN_KEY_USD,
  MIN_JSON_USD,
  driffleBestPublicArs,
  enebaAuctionPricesArs,
};
