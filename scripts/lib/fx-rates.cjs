"use strict";

const STEAM_CURATOR =
  "https://store.steampowered.com/curator/45349538/ajaxgetfilteredrecommendations/?query&start=0&count=10";
const STEAMCITO_URL = "https://steamcito.com.ar/";
const DOLARHOY_DIGITAL_URL = "https://dolarhoy.com/cotizacion-dolar-digital";

let cache = null;

function parseArNumber(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().replace(/\s/g, "");
  if (!s) return null;
  if (/,/.test(s) && /\./.test(s)) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      return Number(s.replace(/\./g, "").replace(",", "."));
    }
    return Number(s.replace(/,/g, ""));
  }
  if (/,/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  return Number(s.replace(/,/g, ""));
}

async function fetchSteamcitoMetodoNormal() {
  try {
    const { chromium } = require("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(STEAMCITO_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3500);
    const text = await page.evaluate(() => document.body.innerText || "");
    await browser.close();
    const m = text.match(/D[oó]lar Oficial \+ IVA 21%:\s*([0-9.,]+)\s*ARS/i);
    const rate = m ? parseArNumber(m[1]) : null;
    if (rate && rate > 500) return { rate, source: "steamcito.com.ar", label: "metodo_normal" };
  } catch (_) {}

  try {
    const res = await fetch(STEAM_CURATOR, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      const json = await res.json();
      const html = json.results_html || "";
      const m = html.match(/([\d.]+)\|(\d+)\|D[oó]lar Tarjeta\|/i);
      if (m) {
        const rate = Number(m[1]);
        if (rate > 500) return { rate, source: "steam_curator_tarjeta", label: "metodo_normal" };
      }
    }
  } catch (_) {}

  return null;
}

async function fetchDolarDigitalVentaPlaywright() {
  try {
    const { chromium } = require("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(DOLARHOY_DIGITAL_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(12000);
    const parsed = await page.evaluate(() => {
      const text = document.body.innerText || "";
      const lines = text.split(/\n/).map((s) => s.trim()).filter(Boolean);

      const rowIdx = lines.findIndex((l) => /d[oó]lar\s+digital/i.test(l));
      if (rowIdx >= 0) {
        const nums = lines.slice(rowIdx, rowIdx + 6).map((l) => l.replace(/\$/g, "").trim())
          .filter((l) => /^[0-9]{3,4}(?:[.,][0-9]{1,2})?$/.test(l));
        if (nums.length >= 2) {
          return { compra: nums[0], venta: nums[1], method: "digital_row" };
        }
      }

      const digitalBlock = text.match(
        /D[oó]lar\s+Digital[\s\S]{0,120}?([0-9]{3,4}(?:[.,][0-9]{1,2})?)[\s\S]{0,60}?([0-9]{3,4}(?:[.,][0-9]{1,2})?)/i
      );
      if (digitalBlock) {
        return { compra: digitalBlock[1], venta: digitalBlock[2], method: "digital_block" };
      }

      const pairs = [];
      for (let i = 0; i < lines.length - 2; i++) {
        if (!/compra/i.test(lines[i]) || !/venta/i.test(lines[i + 1])) continue;
        const compra = lines[i + 2];
        const venta = lines[i + 3];
        if (/^[0-9]{3,4}(?:[.,][0-9]{1,2})?$/.test(compra) && /^[0-9]{3,4}(?:[.,][0-9]{1,2})?$/.test(venta)) {
          pairs.push({ compra, venta });
        }
      }
      if (pairs.length) return { ...pairs[0], method: "first_pair" };

      const venta = text.match(/Venta[\s\n]*\$?\s*([0-9]{3,4}(?:[.,][0-9]{1,2})?)/i);
      const compra = text.match(/Compra[\s\n]*\$?\s*([0-9]{3,4}(?:[.,][0-9]{1,2})?)/i);
      return { compra: compra ? compra[1] : null, venta: venta ? venta[1] : null, method: "generic" };
    });
    await browser.close();
    const venta = parseArNumber(parsed.venta);
    if (venta && venta > 500 && venta < 5000) {
      return { venta, compra: parseArNumber(parsed.compra), source: "dolarhoy.com", raw: parsed };
    }
  } catch (_) {}
  return null;
}

async function fetchDolarDigitalVenta() {
  const pw = await fetchDolarDigitalVentaPlaywright();
  if (pw?.venta) return pw;
  return null;
}

async function getFxRates(fallback) {
  if (cache) return cache;
  const fb = fallback || {};
  const steam = await fetchSteamcitoMetodoNormal();
  const digital = await fetchDolarDigitalVenta();

  const steamMetodoNormal = steam?.rate || fb.steamMetodoNormal || 1827.1;
  const dolarDigitalVenta = digital?.venta || fb.dolarDigitalVenta || Number(process.env.DOLAR_DIGITAL_VENTA) || 1561;
  const dolarDigitalCompra = digital?.compra || fb.dolarDigitalCompra || dolarDigitalVenta;

  cache = {
    steamMetodoNormal,
    dolarDigitalVenta,
    dolarDigitalCompra,
    steamSource: steam?.source || (fb.steamMetodoNormal ? "fallback" : "default"),
    digitalSource: digital?.source || (fb.dolarDigitalVenta ? "fallback" : process.env.DOLAR_DIGITAL_VENTA ? "env" : "default"),
    fetchedAt: new Date().toISOString(),
  };
  return cache;
}

function clearFxCache() {
  cache = null;
}

function steamUsdToArs(usd, fx) {
  const n = Number(usd);
  if (!n || Number.isNaN(n)) return null;
  const rate = Number(fx?.steamMetodoNormal) || 0;
  if (!rate) return null;
  return Math.round(n * rate);
}

function storeUsdToArs(usd, fx) {
  const n = Number(usd);
  if (!n || Number.isNaN(n)) return null;
  const rate = Number(fx?.dolarDigitalVenta) || 0;
  if (!rate) return null;
  return Math.round(n * rate);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ediciones que en Steam son la suma del juego base + DLC/addons (appIds). */
const STEAM_EDITION_BUNDLE_ADDONS = {
  "cyberpunk 2077 ultimate edition": ["2138330"],
};

const PREMIUM_EDITION_KEYWORDS = [
  "deluxe",
  "ultimate",
  "phantom",
  "vault",
  "gold",
  "premium",
  "collector",
  "special edition",
  "complete",
  "definitive",
  "extended",
  "enhanced",
  "goty",
  "game of the year",
  "anniversary",
  "legendary",
  "super deluxe",
  "mega",
  "bundle",
  "collection",
  "zombies chronicles",
];

function normalizeEditionText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPremiumKeywords(optionText) {
  const t = normalizeEditionText(stripHtml(optionText));
  return PREMIUM_EDITION_KEYWORDS.some((kw) => t.includes(kw));
}

function isStandardEdition(edition) {
  const e = normalizeEditionText(edition);
  if (!e) return true;
  if (/super\s+citizen/.test(e)) return true;
  return /^(edicion\s+)?estandar$|^standard$|^base$|^normal$/.test(e);
}

function isCommercialLicenseSub(optionText) {
  const t = normalizeEditionText(stripHtml(optionText));
  return /\bcommercial\s+license\b/.test(t);
}

function isMicrotransactionSub(optionText, priceCents) {
  const cents = Number(priceCents) || 0;
  const t = normalizeEditionText(stripHtml(optionText));
  if (!t) return true;
  if (isCommercialLicenseSub(optionText)) return true;
  if (cents === 0 && /\bfree\b/.test(t)) return true;
  if (/\b(cp|bfc|coins?|credits?|points?|v[\s-]?bucks|fc points|fifa points|robux|cells)\b/.test(t)) {
    return true;
  }
  if (/bonus\s+(cp|coins?|credits?|points?|currency)/.test(t)) return true;
  if (/\(\s*\+\s*\d+/.test(t) && /\b(cp|coins?|credits?|points?)\b/.test(t)) return true;
  if (/^\d[\d,.\s]*\s+(cp|bfc|coins?|credits?|points?)\b/.test(t)) return true;
  if (/\bfor\b/.test(t) && /\b(cp|bfc|coins?|credits?|points?)\b/.test(t) && !/\bedition\b/.test(t)) {
    return true;
  }
  return false;
}

function parseSubListPriceCents(sub) {
  const html = String(sub?.option_text || "");
  const origMatch = html.match(/discount_original_price[^>]*>\s*\$?\s*([\d.,]+)/i);
  if (origMatch) {
    const usd = Number(String(origMatch[1]).replace(/,/g, ""));
    if (usd > 0) return Math.round(usd * 100);
  }
  const text = stripHtml(html);
  const prices = [...text.matchAll(/\$\s*([\d.,]+)/g)]
    .map((m) => Number(String(m[1]).replace(/,/g, "")))
    .filter((n) => n > 0);
  if (prices.length >= 2) return Math.round(prices[0] * 100);
  if (prices.length === 1) return Math.round(prices[0] * 100);
  const fallback = Number(sub?.price_in_cents_with_discount);
  return fallback > 0 ? fallback : null;
}

function collectPackageSubs(data) {
  const subs = [];
  for (const group of data?.package_groups || []) {
    for (const sub of group?.subs || []) {
      const priceCents = parseSubListPriceCents(sub);
      if (priceCents == null) continue;
      if (isMicrotransactionSub(sub.option_text, priceCents)) continue;
      subs.push({
        optionText: stripHtml(sub.option_text || ""),
        optionTextNorm: normalizeEditionText(stripHtml(sub.option_text || "")),
        priceCents,
        raw: sub,
      });
    }
  }
  return subs;
}

function extractEditionKeywords(edition) {
  const e = normalizeEditionText(edition);
  const keywords = [];
  for (const kw of PREMIUM_EDITION_KEYWORDS) {
    if (e.includes(kw)) keywords.push(kw);
  }
  const words = e.split(/\s+/).filter(
    (w) => w.length > 3 && !/^(edition|edicion|estandar|standard|game|juego)$/.test(w)
  );
  for (const w of words) {
    if (!keywords.includes(w)) keywords.push(w);
  }
  return keywords;
}

function matchStandardSub(subs, basePriceCents) {
  let candidates = subs.filter((s) => !hasPremiumKeywords(s.optionText));
  if (!candidates.length) candidates = [...subs];
  if (!candidates.length) return null;
  if (basePriceCents) {
    const exact = candidates.find((s) => s.priceCents === basePriceCents);
    if (exact) return exact;
  }
  candidates.sort((a, b) => a.priceCents - b.priceCents);
  return candidates[0];
}

function scoreSubForEdition(sub, editionKeywords) {
  if (!editionKeywords.length) return 0;
  const text = sub.optionTextNorm;
  let score = 0;
  for (const kw of editionKeywords) {
    if (text.includes(kw)) score += kw.length + 10;
  }
  return score;
}

function matchNamedEditionSub(subs, edition) {
  const keywords = extractEditionKeywords(edition);
  if (!keywords.length) return null;
  let best = null;
  let bestScore = 0;
  for (const sub of subs) {
    const score = scoreSubForEdition(sub, keywords);
    if (score > bestScore) {
      bestScore = score;
      best = sub;
    }
  }
  return bestScore > 0 ? best : null;
}

function matchSubForEdition(edition, subs, basePriceCents) {
  if (!subs.length) return { sub: null, matched: false, note: "sin_subs" };
  if (isStandardEdition(edition)) {
    const sub = matchStandardSub(subs, basePriceCents);
    return sub
      ? { sub, matched: true, note: "standard" }
      : { sub: null, matched: false, note: "standard_sin_match" };
  }
  const sub = matchNamedEditionSub(subs, edition);
  return sub
    ? { sub, matched: true, note: "named" }
    : { sub: null, matched: false, note: "named_sin_match" };
}

function bundleEditionKey(game, edition) {
  return `${normalizeEditionText(game)} ${normalizeEditionText(edition)}`.trim();
}

function resolveBundleEditionPrice(game, edition, appPricing, byApp, fx) {
  const addonIds = STEAM_EDITION_BUNDLE_ADDONS[bundleEditionKey(game, edition)];
  if (!addonIds?.length || !appPricing?.basePriceCents || !byApp) return null;
  let totalCents = appPricing.basePriceCents;
  const parts = [appPricing.name || "base"];
  for (const addonId of addonIds) {
    const addon = byApp.get(String(addonId));
    if (!addon?.basePriceCents) return null;
    totalCents += addon.basePriceCents;
    parts.push(addon.name || addonId);
  }
  return {
    price: steamUsdToArs(totalCents / 100, fx),
    matched: true,
    note: "bundle_sum",
    usd: totalCents / 100,
    optionText: parts.join(" + "),
  };
}

function resolveSteamPriceArsForEdition(edition, appPricing, fx, opts = {}) {
  if (!appPricing) return { price: null, matched: false, note: "sin_app" };
  const subs = appPricing.subs || [];
  const basePriceCents = appPricing.basePriceCents;
  const { sub, matched, note } = matchSubForEdition(edition, subs, basePriceCents);
  if (sub) {
    return {
      price: steamUsdToArs(sub.priceCents / 100, fx),
      matched,
      note,
      usd: sub.priceCents / 100,
      optionText: sub.optionText,
    };
  }
  const bundle = resolveBundleEditionPrice(opts.game, edition, appPricing, opts.byApp, fx);
  if (bundle) return bundle;
  if (basePriceCents) {
    return {
      price: steamUsdToArs(basePriceCents / 100, fx),
      matched: false,
      note: note || "fallback_base",
      usd: basePriceCents / 100,
      optionText: appPricing.baseOptionText || "",
    };
  }
  return { price: null, matched: false, note: note || "sin_precio" };
}

async function fetchSteamAppPricingDetails(appId, fx) {
  const id = String(appId || "").trim();
  if (!id) return null;
  const countries = ["ar", "uy", "us", "gb"];
  for (const cc of countries) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(
          "https://store.steampowered.com/api/appdetails?appids=" + id + "&cc=" + cc + "&l=en",
          {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; CJD-price-sync/1.0)" },
            signal: AbortSignal.timeout(25000),
          }
        );
        if (res.status === 429) {
          await delay(2000 * (attempt + 1));
          continue;
        }
        if (!res.ok) break;
        const json = await res.json();
        const entry = json[id];
        if (!entry?.success || !entry.data) break;
        const data = entry.data;
        const po = data.price_overview;
        const basePriceCents = po?.initial ?? po?.final ?? null;
        const subs = collectPackageSubs(data);
        return {
          appId: id,
          name: data.name || "",
          basePriceCents,
          baseOptionText: po?.final_formatted || po?.initial_formatted || "",
          subs,
          cc,
        };
      } catch (_) {
        break;
      }
    }
  }
  return null;
}

async function fetchSteamPriceArs(linkSteam, fx) {
  const link = String(linkSteam || "").trim();
  const appId = link.match(/\/app\/(\d+)/)?.[1];
  if (!appId) return null;
  const countries = ["ar", "uy", "us", "gb"];
  for (const cc of countries) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(
          "https://store.steampowered.com/api/appdetails?appids=" + appId + "&cc=" + cc + "&l=en",
          {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; CJD-price-sync/1.0)" },
            signal: AbortSignal.timeout(25000),
          }
        );
        if (res.status === 429) {
          await delay(2000 * (attempt + 1));
          continue;
        }
        if (!res.ok) break;
        const json = await res.json();
        const entry = json[appId];
        if (!entry?.success || !entry.data) break;
        const po = entry.data.price_overview;
        if (!po) break;
        const cents = po.initial ?? po.final;
        if (cents == null) break;
        return steamUsdToArs(Number(cents) / 100, fx);
      } catch (_) {
        break;
      }
    }
  }
  return null;
}

async function fetchSteamPriceBreakdown(linkSteam, fx) {
  const link = String(linkSteam || "").trim();
  const appId = link.match(/\/app\/(\d+)/)?.[1];
  if (!appId) return null;
  try {
    const res = await fetch(
      "https://store.steampowered.com/api/appdetails?appids=" + appId + "&cc=us&l=en",
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(25000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const data = json[appId]?.data;
    const po = data?.price_overview;
    if (!po) return { appId, name: data?.name || "", listUsd: null, saleUsd: null, listArs: null, saleArs: null };
    const listUsd = po.initial != null ? Number(po.initial) / 100 : null;
    const saleUsd = po.final != null ? Number(po.final) / 100 : null;
    return {
      appId,
      name: data?.name || "",
      listUsd,
      saleUsd,
      listArs: listUsd != null ? steamUsdToArs(listUsd, fx) : null,
      saleArs: saleUsd != null ? steamUsdToArs(saleUsd, fx) : null,
    };
  } catch (_) {
    return null;
  }
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchSteamAppDetails(steamId) {
  const id = String(steamId || "").trim();
  if (!id) return null;
  const url = "https://store.steampowered.com/api/appdetails?appids=" + encodeURIComponent(id) + "&l=spanish&cc=ar";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CJD-price-sync/1.0)" },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const entry = json[id];
    if (!entry?.success || !entry.data) return null;
    const data = entry.data;
    const pc = data.pc_requirements || {};
    const screenshots = (data.screenshots || [])
      .map((s) => s.path_full || s.path_thumbnail)
      .filter(Boolean);
    if (!screenshots.length && data.header_image) screenshots.push(data.header_image);
    return {
      description: stripHtml(data.short_description || data.about_the_game || ""),
      min: stripHtml(pc.minimum || ""),
      rec: stripHtml(pc.recommended || ""),
      screenshots,
    };
  } catch (_) {
    return null;
  }
}

module.exports = {
  getFxRates,
  clearFxCache,
  fetchSteamcitoMetodoNormal,
  fetchDolarDigitalVenta,
  steamUsdToArs,
  storeUsdToArs,
  fetchSteamPriceArs,
  fetchSteamPriceBreakdown,
  fetchSteamAppDetails,
  fetchSteamAppPricingDetails,
  resolveSteamPriceArsForEdition,
  resolveBundleEditionPrice,
  matchSubForEdition,
  collectPackageSubs,
  isMicrotransactionSub,
  isCommercialLicenseSub,
  isStandardEdition,
  parseSubListPriceCents,
  parseArNumber,
  STEAM_EDITION_BUNDLE_ADDONS,
  bundleEditionKey,
};
