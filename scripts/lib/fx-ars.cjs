"use strict";

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
  let eur = amount;
  if (offer.price.currency === "USD") eur = amount / (rates.usdPerEur || 1.08);
  else if (offer.price.currency !== "EUR") eur = amount;
  return Math.round(eur * rates.arsPerEur);
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

function isPaidExtraMerchant(name) {
  const merchant = String(name || "").toLowerCase();
  return /plus exclusive|eneba plus|driffle plus|kinguin smart|smart price|members? only|subscribers? only|subscription|requires? plus/.test(
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
      return true;
    })
    .map((n) => toArsFromForeign(n.price.amount / 100, n.price.currency, rates))
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
  driffleBestPublicArs,
  enebaAuctionPricesArs,
};