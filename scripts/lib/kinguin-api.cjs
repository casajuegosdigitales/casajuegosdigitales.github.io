"use strict";

const OFFER_API = "https://www.kinguin.net/services/offer-explorer/api/v2/public/offers";
const RATES_API = "https://www.kinguin.net/services/currency/api/v1/rates";
let ratesCache = null;

async function getRates() {
  if (ratesCache) return ratesCache;
  try {
    const res = await fetch(RATES_API, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error("Kinguin rates HTTP " + res.status);
    const list = await res.json();
    const arsPerEur = list.find((r) => r.code === "ARS")?.rate;
    const usdPerEur = list.find((r) => r.code === "USD")?.rate;
    if (!arsPerEur || !usdPerEur) throw new Error("Cotizacion ARS/USD no disponible");
    ratesCache = { arsPerEur, usdPerEur };
    return ratesCache;
  } catch (err) {
    if (ratesCache) return ratesCache;
    throw err;
  }
}

async function getRatesWithFallback(fallback) {
  try {
    return await getRates();
  } catch (err) {
    const fb =
      fallback?.arsPerEur && fallback?.usdPerEur
        ? fallback
        : { arsPerEur: 1750, usdPerEur: 1.08 };
    console.warn("AVISO: cotizacion Kinguin sin red, usando:", fb.arsPerEur);
    return fb;
  }
}

function toKinguinArs(price, rates) {
  if (!price || price.amount == null) return null;
  const amount = Number(price.amount) / 100;
  let eur = amount;
  if (price.currency === "USD") eur = amount / rates.usdPerEur;
  else if (price.currency !== "EUR") eur = amount;
  return Math.round(eur * rates.arsPerEur);
}

async function fetchOffer(offerId) {
  const res = await fetch(OFFER_API + "/" + offerId, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) return null;
  return res.json();
}

async function fetchCheapestOfferByName(name) {
  const url = OFFER_API + "?name=" + encodeURIComponent(name) + "&page=0&size=50";
  const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) return null;
  const data = await res.json();
  const offers = (data.content || [])
    .filter((o) => o.name === name && o.status === "ACTIVE")
    .sort((a, b) => a.price.amount - b.price.amount);
  return offers[0] || null;
}

async function getKinguinPriceArs(name, link, rates) {
  const offerMatch = String(link || "").match(/o=([a-f0-9]+)/i);
  if (offerMatch) {
    const offer = await fetchOffer(offerMatch[1]);
    if (offer && offer.price) return toKinguinArs(offer.price, rates);
  }
  const offer = await fetchCheapestOfferByName(name);
  if (offer && offer.price) return toKinguinArs(offer.price, rates);
  return null;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function parseKinguinOfferId(linkOrId) {
  const raw = String(linkOrId || "").trim();
  if (!raw) return "";
  if (/^[a-f0-9]{24}$/i.test(raw)) return raw;
  return raw.match(/[?&]o=([a-f0-9]+)/i)?.[1] || "";
}

function isPlaceholderKinguinLink(link) {
  const u = String(link || "").trim();
  if (!u || !/kinguin\.net/i.test(u)) return false;
  return /\/category\/0(?:\/|$|\?)/i.test(u);
}

function isValidKinguinProductLink(link) {
  const u = String(link || "").trim();
  if (!u || !/kinguin\.net/i.test(u)) return false;
  if (isPlaceholderKinguinLink(u)) return false;
  return /\/category\/[1-9]\d+\/[^/?#]+/i.test(u) || /[?&]o=[a-f0-9]+/i.test(u);
}

function pickKinguinProductLink({ candidateLink, pageUrl, offerId, categoryLink }) {
  const oid = parseKinguinOfferId(offerId || candidateLink || pageUrl);
  const candidates = [pageUrl, candidateLink, categoryLink].filter(Boolean);
  for (const raw of candidates) {
    const u = String(raw).split("#")[0].trim();
    if (!isValidKinguinProductLink(u)) continue;
    if (oid && !/[?&]o=/.test(u) && /\/category\/[1-9]\d+\//i.test(u)) {
      return u + (u.includes("?") ? "&" : "?") + "o=" + oid;
    }
    return u;
  }
  return "";
}

module.exports = {
  getRates,
  getRatesWithFallback,
  getKinguinPriceArs,
  toKinguinArs,
  fetchOffer,
  sleep,
  parseKinguinOfferId,
  isPlaceholderKinguinLink,
  isValidKinguinProductLink,
  pickKinguinProductLink,
};