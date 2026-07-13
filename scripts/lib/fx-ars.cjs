"use strict";

const MIN_GAME_USD = 5;
const PLUS_PAIR_RATIO_MIN = 0.8;
const PLUS_PAIR_RATIO_MAX = 0.97;

function parseUsdToken(raw) {
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
  if (!n || Number.isNaN(n) || n < MIN_GAME_USD || n >= 5000) return null;
  return n;
}

function extractUsdPricesFromLine(line) {
  const prices = [];
  const text = String(line || "");
  for (const m of text.matchAll(/([\d]{1,4}(?:[.,]\d{1,2})?)\s*US\$/gi)) {
    const n = parseUsdToken(m[1]);
    if (n) prices.push(n);
  }
  for (const m of text.matchAll(/US\$\s*([\d]{1,4}(?:[.,]\d{1,2})?)/gi)) {
    const n = parseUsdToken(m[1]);
    if (n) prices.push(n);
  }
  for (const m of text.matchAll(/(?:^|[^\d])\$\s*([\d]{1,4}(?:[.,]\d{1,2})?)/g)) {
    const n = parseUsdToken(m[1]);
    if (n) prices.push(n);
  }
  return [...new Set(prices)].sort((a, b) => a - b);
}

function looksLikePlusPair(low, high) {
  if (!low || !high || low >= high) return false;
  const ratio = low / high;
  return ratio >= PLUS_PAIR_RATIO_MIN && ratio <= PLUS_PAIR_RATIO_MAX && high - low <= 20;
}

/** En filas con precio Plus + precio publico, quedarse con el publico (el mayor del par). */
function publicUsdFromPriceGroup(prices) {
  const sorted = [...new Set((prices || []).map((p) => parseUsdToken(p)).filter(Boolean))].sort((a, b) => a - b);
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

function pickPublicMinUsdFromText(text, options = {}) {
  const minUsd = options.minUsd ?? MIN_GAME_USD;
  const perLine = [];

  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    if (options.skipLine?.(line)) continue;
    if (isSubscriptionBannerLine(line)) continue;

    const prices = extractUsdPricesFromLine(line).filter((p) => p >= minUsd);
    if (!prices.length) continue;
    const pub = publicUsdFromPriceGroup(prices);
    if (pub) perLine.push(pub);
  }

  if (!perLine.length) return null;
  return Math.min(...perLine);
}

function pickAnchoredPublicUsd(text) {
  const body = String(text || "");
  const patterns = [
    /\+\d+\s+ofertas?\s+(?:starting at|desde)\s+US\$\s*([\d.,]+)/i,
    /\+\d+\s+oferta\s+de\s+([\d.,]+)\s*US\$/i,
    /offers?\s+starting\s+at\s+US\$\s*([\d.,]+)/i,
    /starting\s+at\s+US\$\s*([\d.,]+)/i,
    /precio m[aá]s bajo[\s\S]{0,160}?([\d.,]+)\s*US\$/i,
    /lowest price[\s\S]{0,160}?US\$\s*([\d.,]+)/i,
  ];
  const found = [];
  for (const re of patterns) {
    const m = body.match(re);
    if (!m) continue;
    const n = parseUsdToken(m[1]);
    if (n) found.push(n);
  }
  return found.length ? Math.min(...found) : null;
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

function kinguinPublicPriceArs(offer, rates) {
  if (!offer?.price) return null;
  const amount = Number(offer.price.amount) / 100;
  const cur = String(offer.price.currency || "EUR").toUpperCase();
  if (cur === "USD") return toArsFromUsd(amount, rates);
  if (cur === "ARS") return Math.round(amount);
  return Math.round(amount * rates.arsPerEur);
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

function pickPublicMinUsd(text, options = {}) {
  const anchored = pickAnchoredPublicUsd(text);
  const fromLines = pickPublicMinUsdFromText(text, options);
  if (anchored != null && fromLines != null) return Math.min(anchored, fromLines);
  return anchored ?? fromLines ?? null;
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

function enebaAuctionPricesArs(edges, rates) {
  const prices = (edges || [])
    .map((e) => e?.node)
    .filter((n) => {
      if (!n || n.isInStock === false || !n.price) return false;
      if (isPaidExtraMerchant(n.merchant?.name)) return false;
      return String(n.price.currency || "USD").toUpperCase() === "USD";
    })
    .map((n) => toArsFromUsd(n.price.amount / 100, rates))
    .filter((p) => p > 0);
  return pickPublicMinPrice(prices);
}

module.exports = {
  toArsFromUsd,
  toArsFromEur,
  toArsFromForeign,
  parseLoadedRawPrice,
  kinguinPublicPriceArs,
  kinguinInStock,
  pickPublicMinPrice,
  pickPublicMinUsd,
  pickPublicMinUsdFromText,
  pickAnchoredPublicUsd,
  publicUsdFromPriceGroup,
  extractUsdPricesFromLine,
  parseUsdToken,
  driffleBestPublicArs,
  enebaAuctionPricesArs,
};