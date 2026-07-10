"use strict";

const { sleep } = require("./kinguin-api.cjs");
const {
  getKinguinQuotes,
  resolveKinguinOfferLink,
  scrapeKinguinHeroPage,
  mergeKinguinVerifiedPrice,
  kinguinCategoryBaseUrl,
  quoteFromLink,
} = require("./kinguin-supply.cjs");
const { getEnebaQuotes } = require("./eneba-supply.cjs");
const { getDriffleQuotes } = require("./driffle-supply.cjs");
const { getLoadedQuotes } = require("./loaded-supply.cjs");
const {
  filterCandidates,
  wantsLatam,
  regionOkForArgentina,
  isAccountName,
  listingMatchesItem,
  deliveryTypeFromItem,
  checkActivationRegion,
  isSteamGiftOffer,
} = require("./match-product.cjs");
const { fetchOffer, isPlaceholderKinguinLink } = require("./kinguin-api.cjs");
const { searchKinguinOffers } = require("./kinguin-supply.cjs");
const { parseDriffleSlug, verifyDriffleProductPage } = require("./driffle-supply.cjs");
const { parseEnebaSlug, fetchEnebaProduct, verifyEnebaProductPage } = require("./eneba-supply.cjs");
const { verifyLoadedProduct } = require("./loaded-supply.cjs");
const { withPage, waitCloudflare } = require("./browser-supply.cjs");
const {
  parseKinguinOfferId,
  pickKinguinProductLink,
} = require("./kinguin-api.cjs");
const {
  kinguinPublicPriceArs,
  kinguinInStock,
  pickPublicMinPrice,
  driffleBestPublicArs,
  enebaAuctionPricesArs,
  toArsFromEur,
} = require("./fx-ars.cjs");

const STORES = ["kinguin", "eneba", "driffle", "loaded"];
const FAST_STORES = ["driffle"];
const BROWSER_STORES = ["kinguin", "eneba", "loaded"];
const RECHECK_TTL_MS = Number(process.env.SUPPLY_RECHECK_MS || 12 * 60 * 60 * 1000);
const VERIFY_PER_STORE = Number(process.env.SUPPLY_VERIFY_PER_STORE || 5);

async function verifyKinguinPageRegion(linkOrOfferId, opts) {
  const rawLink = String(linkOrOfferId || "").trim();
  const offerId = parseKinguinOfferId(rawLink) || rawLink;
  const categoryUrl = rawLink.startsWith("http")
    ? rawLink.replace(/([?&])o=[^&#]+/i, "").replace(/[?&]$/, "")
    : "";
  const url = categoryUrl || (offerId ? "https://www.kinguin.net/es/category/0/product?o=" + offerId : "");
  if (!url) return { ok: null, label: "sin_pagina", unknown: true, page: null, pageUrl: "" };

  let hero = null;
  try {
    hero = await scrapeKinguinHeroPage(url, opts?.rates);
  } catch (_) {}
  if (!hero) return { ok: null, label: "sin_pagina", unknown: true, page: null, pageUrl: "" };

  const page = {
    title: hero.title || "",
    activationText: hero.activationText || "",
    inStock: hero.inStock !== false,
    arsPrices: hero.arsPrices || [],
    priceArs: hero.priceArs || null,
  };
  const check = checkActivationRegion(page.activationText, opts || {});
  return { ...check, page, pageUrl: hero.pageUrl || url };
}

function pickBestFromQuotes(item, quotes) {
  const filtered = filterCandidates(item, quotes || []);
  if (!filtered.length) return { best: null, quotes: [] };
  const ranked = [...filtered].sort((a, b) => (a.priceArs || 0) - (b.priceArs || 0));
  for (const best of ranked) {
    if (best.store === "kinguin" && isPlaceholderKinguinLink(best.link)) continue;
    if (!best.link) continue;
    if (isSteamGiftOffer(item, best.name, best.link)) continue;
    if (!listingMatchesItem(item, best.name, best.link)) continue;
    return { best, quotes: filtered };
  }
  const best = ranked[0];
  if (!listingMatchesItem(item, best.name, best.link)) return { best: null, quotes: filtered };
  return { best, quotes: filtered };
}

function reselectBestAvoidingBrokenLinks(item) {
  const pool = (item.supplyQuotes || []).filter((q) => {
    if (!q.link) return false;
    if (q.store === "kinguin" && isPlaceholderKinguinLink(q.link)) return false;
    if (isSteamGiftOffer(item, q.name, q.link)) return false;
    return listingMatchesItem(item, q.name, q.link);
  });
  if (!pool.length) return false;
  pool.sort((a, b) => (a.priceArs || 0) - (b.priceArs || 0));
  const best = pool[0];
  item.bestStore = best.store;
  item.bestLink = best.link;
  item.compraArs = Math.round(best.priceArs || 0);
  item.supplyVerified = true;
  item.regionLabel = best.regionLabel || item.regionLabel || "";
  if (best.name) item.bestListado = best.name;
  return true;
}

function regionPass(item, text, extra) {
  const opts = {
    wantsLatam: wantsLatam(item),
    isAccount: isAccountName(text) || isAccountName(item.fullName),
    trustStoreLocale: extra && extra.trustStoreLocale,
    trustLabel: extra && extra.trustLabel,
  };
  return regionOkForArgentina(text, opts);
}

function attachRegion(quote, regionCheck) {
  if (!regionCheck || regionCheck.ok !== true) return null;
  return {
    ...quote,
    regionLabel: regionCheck.label || "AR/LATAM",
    verified: true,
    source: quote.source === "search" ? "verified" : quote.source || "verified",
  };
}

function reapplyBestFromStoredQuotes(item, rates, options) {
  const raw = item.supplyQuotes || [];
  if (options?.filterOnly || !rates) return Promise.resolve(pickBestFromQuotes(item, raw));
  return verifyQuotes(raw, item, rates).then((verified) => pickBestFromQuotes(item, verified));
}

async function getStoreQuotes(store, item, rates, options) {
  if (store === "kinguin") return getKinguinQuotes(item, rates, options);
  if (store === "eneba") return getEnebaQuotes(item, rates, options);
  if (store === "driffle") return getDriffleQuotes(item, rates, options);
  if (store === "loaded") return getLoadedQuotes(item, rates, options);
  return [];
}

async function fetchStoreQuotes(store, item, rates, options) {
  try {
    const quotes = await getStoreQuotes(store, item, rates, options);
    return { store, quotes, status: quotes.length ? "ok" : "sin_resultados" };
  } catch (_) {
    return { store, quotes: [], status: "error" };
  }
}

function mergeStoreQuotes(existing, incoming) {
  const byStore = new Map();
  for (const q of existing || []) {
    if (q?.store && q?.link && !(q.store === "kinguin" && isPlaceholderKinguinLink(q.link))) {
      byStore.set(q.store, q);
    }
  }
  for (const q of incoming || []) {
    if (q?.store && q?.link && !(q.store === "kinguin" && isPlaceholderKinguinLink(q.link))) {
      byStore.set(q.store, q);
    }
  }
  return [...byStore.values()];
}

function sanitizeQuotesForSave(quotes) {
  return (quotes || [])
    .filter((q) => q?.store && q?.link && !(q.store === "kinguin" && isPlaceholderKinguinLink(q.link)))
    .map((q) => ({
      store: q.store,
      priceArs: q.priceArs,
      link: q.link,
      name: q.name,
      source: q.source,
      regionLabel: q.regionLabel || "",
    }));
}

async function getBestSupplyQuote(item, rates, options) {
  const enabled = options?.stores || STORES;
  const storeStatus = {};
  let all = [];

  const fast = enabled.filter((s) => FAST_STORES.includes(s));
  const slow = enabled.filter((s) => BROWSER_STORES.includes(s));

  if (fast.length) {
    const results = await Promise.all(fast.map((store) => fetchStoreQuotes(store, item, rates, options)));
    for (const r of results) {
      storeStatus[r.store] = r.status;
      all.push(...r.quotes);
    }
  }
  for (const store of slow) {
    const r = await fetchStoreQuotes(store, item, rates, options);
    storeStatus[r.store] = r.status;
    all.push(...r.quotes);
    if (options?.delayMs) await sleep(options.delayMs);
  }

  const verified = options?.skipVerify ? sanitizeQuotesForSave(all) : await verifyQuotesPerStore(all, item, rates);
  const picked = pickBestFromQuotes(item, verified);
  picked.storeStatus = storeStatus;
  return picked;
}

function applyBestToItem(item, result) {
  const { best, quotes } = result;
  const validQuotes = sanitizeQuotesForSave(quotes);
  item.supplyQuotes = validQuotes;
  if (!best) {
    item.bestStore = "";
    item.bestLink = "";
    item.supplyVerified = false;
    item.regionLabel = "";
    item.compraArs = 0;
    return false;
  }
  if (!best.link || (best.store === "kinguin" && isPlaceholderKinguinLink(best.link))) {
    item.bestStore = "";
    item.bestLink = "";
    item.supplyVerified = false;
    item.regionLabel = "";
    item.compraArs = 0;
    return false;
  }
  if (isSteamGiftOffer(item, best.name, best.link)) {
    item.bestStore = "";
    item.bestLink = "";
    item.supplyVerified = false;
    item.regionLabel = "";
    item.compraArs = 0;
    return false;
  }
  if (!listingMatchesItem(item, best.name, best.link)) {
    item.bestStore = "";
    item.bestLink = "";
    item.supplyVerified = false;
    item.regionLabel = "";
    item.compraArs = 0;
    return false;
  }
  item.bestStore = best.store;
  item.bestLink = best.link || "";
  item.compraArs = Math.round(best.priceArs);
  item.supplyVerified = true;
  item.regionLabel = best.regionLabel || "";
  if (best.store === "kinguin" && best.link) item.linkKinguin = best.link;
  if (best.store === "eneba" && best.link) item.linkEneba = best.link;
  if (best.store === "driffle" && best.link) item.linkDriffle = best.link;
  if (best.store === "loaded" && best.link) item.linkLoaded = best.link;
  item.supplySource = best.source || "verified";
  item.supplyCheckedAt = new Date().toISOString();
  item.bestListado = best.name || "";
  return true;
}

async function fetchDrifflePage(slug) {
  const res = await fetch("https://driffle.com/" + slug.replace(/^\/+/, ""), {
    headers: { "User-Agent": "Mozilla/5.0 Chrome/120", Accept: "text/html" },
    signal: AbortSignal.timeout(35000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  return JSON.parse(m[1])?.props?.pageProps || null;
}

async function verifyKinguinQuote(candidate, item, rates) {
  const offerId = candidate.offerId || parseKinguinOfferId(candidate.link);
  const pinnedOffer = Boolean(offerId && candidate.link);
  let offers = [];
  if (offerId) {
    try {
      const one = await fetchOffer(offerId);
      if (one) offers.push(one);
    } catch (_) {}
  }
  if (!pinnedOffer && candidate.name) {
    try {
      const found = await searchKinguinOffers(candidate.name, rates);
      for (const o of found) {
        if (o.name === candidate.name) offers.push(o);
      }
    } catch (_) {}
  }
  offers = offers.filter((o) => kinguinInStock(o));
  if (!offers.length) return null;
  let priceArs;
  let best;
  if (pinnedOffer && offers.length >= 1) {
    best = offers.find((o) => (o.id || o.offerId) === offerId) || offers[0];
    priceArs = kinguinPublicPriceArs(best, rates);
  } else {
    const apiPrices = offers.map((o) => kinguinPublicPriceArs(o, rates)).filter((p) => p > 0);
    priceArs = pickPublicMinPrice(apiPrices);
    if (!priceArs) return null;
    best = offers
      .map((o) => ({ o, priceArs: kinguinPublicPriceArs(o, rates) }))
      .filter((x) => x.priceArs === priceArs)
      .sort((a, b) => (b.o.buyableStock || 0) - (a.o.buyableStock || 0))[0]?.o;
  }
  if (!best || !priceArs) return null;
  const name = best.name || candidate.name;
  if (!listingMatchesItem(item, name, candidate.link)) return null;
  const regionText = [name, best.productName, best.description, candidate.regionHint].filter(Boolean).join("\n");
  let regionCheck = regionPass(item, regionText);
  const pageCheck = await verifyKinguinPageRegion(candidate.link || offerId, {
    isAccount: deliveryTypeFromItem(item) === "account",
    rates,
  });
  if (
    pageCheck.page?.title &&
    !listingMatchesItem(item, pageCheck.page.title, candidate.link) &&
    !listingMatchesItem(item, name, candidate.link)
  ) {
    return null;
  }
  if (regionCheck.ok !== true) {
    if (pageCheck.ok === true) {
      regionCheck = pageCheck;
    } else if (pageCheck.page?.activationText) {
      const pageRegion = checkActivationRegion(pageCheck.page.activationText, {
        isAccount: deliveryTypeFromItem(item) === "account",
      });
      if (pageRegion.ok === true) regionCheck = pageRegion;
      else if (pageRegion.ok !== false && deliveryTypeFromItem(item) === "account") {
        regionCheck = { ok: true, label: "cuenta_ficha", unknown: false };
      }
    }
  }
  if (regionCheck.ok !== true) return null;
  const apiPriceArs = kinguinPublicPriceArs(best, rates);
  priceArs = mergeKinguinVerifiedPrice(apiPriceArs, pageCheck?.page?.priceArs) || priceArs;
  const oid = best.id || best.offerId || offerId;
  const link = pickKinguinProductLink({
    candidateLink: candidate.link,
    pageUrl: pageCheck.pageUrl,
    offerId: oid,
    categoryLink: candidate.categoryLink || kinguinCategoryBaseUrl(candidate.link || pageCheck.pageUrl),
  });
  if (!link) return null;
  return attachRegion(
    {
      ...candidate,
      store: "kinguin",
      name: pageCheck?.page?.title || name,
      priceArs,
      link,
      offerId: oid || "",
      source: pageCheck?.page?.priceArs ? "page_ars" : candidate.source,
    },
    regionCheck
  );
}

async function verifyDriffleQuote(candidate, item, rates) {
  const slug = parseDriffleSlug(candidate.link || "");
  if (!slug) return null;
  let page;
  try {
    page = await verifyDriffleProductPage(candidate.link || slug);
  } catch (_) {
    page = null;
  }
  if (!page?.inStock || !page.priceArs) return null;
  const title = page.name || candidate.name || "";
  if (!listingMatchesItem(item, title, page.link || candidate.link)) return null;
  const regionCheck = regionPass(item, page.activationText || title);
  if (regionCheck.ok !== true) return null;
  if (!filterCandidates(item, [{ ...candidate, name: title, priceArs: page.priceArs, link: page.link }]).length) {
    return null;
  }
  return attachRegion(
    {
      ...candidate,
      store: "driffle",
      name: title,
      priceArs: page.priceArs,
      link: page.link || candidate.link,
      source: "page_ars",
    },
    regionCheck
  );
}

async function verifyEnebaQuote(candidate, item, rates) {
  const slug = candidate.slug || parseEnebaSlug(candidate.link || "");
  if (!slug) return null;

  let page = null;
  try {
    page = await verifyEnebaProductPage(candidate.link || slug, item, rates);
  } catch (_) {}

  if (page?.inStock && page.priceArs) {
    const name = page.name || candidate.name;
    if (!listingMatchesItem(item, name, page.link)) return null;
    const regionCheck = regionPass(item, page.activationText || name, {
      trustStoreLocale: wantsLatam(item),
      trustLabel: "eneba_AR",
    });
    if (regionCheck.ok !== true) return null;
    if (!filterCandidates(item, [{ ...candidate, name, priceArs: page.priceArs, link: page.link }]).length) {
      return null;
    }
    return attachRegion(
      {
        ...candidate,
        store: "eneba",
        name,
        priceArs: page.priceArs,
        link: page.link,
        slug: page.slug || slug,
        source: page.source || "page_ars",
      },
      regionCheck
    );
  }

  let product;
  try {
    product = await fetchEnebaProduct(slug, wantsLatam(item));
  } catch (_) {
    return null;
  }
  if (!product) return null;
  const name = product.name || candidate.name;
  const priceArs = enebaAuctionPricesArs(product.auctions?.edges || [], rates);
  if (!priceArs) return null;
  if (!listingMatchesItem(item, name, candidate.link)) return null;
  const regionCheck = regionPass(item, name, {
    trustStoreLocale: wantsLatam(item),
    trustLabel: "eneba_AR",
  });
  if (regionCheck.ok !== true) return null;
  if (!filterCandidates(item, [{ ...candidate, name, priceArs, link: candidate.link }]).length) return null;
  const locale = "latam";
  return attachRegion(
    {
      ...candidate,
      store: "eneba",
      name,
      priceArs,
      link: "https://www.eneba.com/" + locale + "/" + slug,
      slug,
    },
    regionCheck
  );
}

async function verifyLoadedQuote(candidate, item) {
  if (!candidate.link) return null;
  let verified;
  try {
    verified = await verifyLoadedProduct(candidate.link);
  } catch (_) {
    return null;
  }
  if (!verified?.inStock || !verified.priceArs) return null;
  const name = verified.name || candidate.name;
  if (!listingMatchesItem(item, name, candidate.link)) return null;
  if (!verified.priceArs || verified.priceArs < 3000) return null;
  const regionText = verified.activationText || name;
  const regionCheck = regionPass(item, regionText);
  if (regionCheck.ok !== true) return null;
  if (!filterCandidates(item, [{ ...candidate, name, priceArs: verified.priceArs, link: candidate.link }]).length) {
    return null;
  }
  return attachRegion(
    {
      ...candidate,
      store: "loaded",
      name,
      priceArs: verified.priceArs,
      link: candidate.link,
    },
    regionCheck
  );
}

async function verifyQuote(candidate, item, rates) {
  if (!candidate?.store || !candidate?.link) return null;
  try {
    if (candidate.store === "kinguin") return await verifyKinguinQuote(candidate, item, rates);
    if (candidate.store === "driffle") return await verifyDriffleQuote(candidate, item, rates);
    if (candidate.store === "eneba") return await verifyEnebaQuote(candidate, item, rates);
    if (candidate.store === "loaded") return await verifyLoadedQuote(candidate, item, rates);
  } catch (_) {}
  return null;
}

async function verifyStoreMinimum(item, store, candidates, rates) {
  const pool = filterCandidates(
    item,
    (candidates || []).filter((c) => c.store === store && c.link)
  );
  if (!pool.length) return null;
  const sorted = [...pool].sort((a, b) => (a.priceArs || 0) - (b.priceArs || 0));
  const unique = new Map();
  for (const c of sorted) {
    const key = c.link || c.offerId || c.name;
    if (!unique.has(key)) unique.set(key, c);
    if (unique.size >= VERIFY_PER_STORE) break;
  }
  let best = null;
  for (const c of unique.values()) {
    const verified = await verifyQuote(c, item, rates);
    if (!verified) continue;
    if (!best || (verified.priceArs || 0) < (best.priceArs || 0)) best = verified;
  }
  return best;
}

async function verifyQuotesPerStore(candidates, item, rates) {
  const verified = [];
  for (const store of STORES) {
    const min = await verifyStoreMinimum(item, store, candidates, rates);
    if (min) verified.push(min);
  }
  return verified;
}

async function verifyQuotes(candidates, item, rates) {
  return verifyQuotesPerStore(candidates, item, rates);
}

function msSinceSupplyCheck(item) {
  if (!item?.supplyCheckedAt) return Infinity;
  const t = new Date(item.supplyCheckedAt).getTime();
  return Number.isFinite(t) ? Date.now() - t : Infinity;
}

function needsFullSupplySearch(item, options) {
  if (options?.forceFullSearch || options?.expanded) return true;
  if (!item?.supplyVerified || !item.bestStore || !item.bestLink) return true;
  if (item.bestStore === "kinguin" && isPlaceholderKinguinLink(item.bestLink)) return true;
  const storesPresent = new Set((item.supplyQuotes || []).map((q) => q.store).filter(Boolean));
  if (storesPresent.size < STORES.length) return true;
  return msSinceSupplyCheck(item) >= RECHECK_TTL_MS;
}

async function recheckWinningQuote(item, rates) {
  const store = item.bestStore;
  const link = item.bestLink;
  if (!store || !link) return null;
  const candidate = {
    store,
    link,
    name: item.bestListado || item.fullName,
    priceArs: item.compraArs,
    source: item.supplySource || "cached",
    slug: store === "eneba" ? parseEnebaSlug(item.linkEneba || link) : undefined,
    offerId: store === "kinguin" ? parseKinguinOfferId(link) : undefined,
  };
  return verifyQuote(candidate, item, rates);
}

const FETCH_MAX_ATTEMPTS = 4;

async function fetchItemSupply(item, rates, options) {
  const attempts = [];
  let lastResult = { best: null, quotes: [], storeStatus: {} };

  if (needsFullSupplySearch(item, options) === false) {
    try {
      const winner = await recheckWinningQuote(item, rates);
      if (winner) {
        const oldPrice = item.compraArs || 0;
        const newPrice = winner.priceArs || 0;
        if (newPrice <= oldPrice + 50) {
          const merged = mergeStoreQuotes(item.supplyQuotes || [], [winner]);
          const picked = pickBestFromQuotes(item, merged);
          const applied = applyBestToItem(item, { best: picked.best, quotes: merged });
          attempts.push({
            attempt: "recheck",
            best: applied && picked.best ? picked.best.store + ":" + newPrice : "sin_aplicar",
            old: oldPrice,
          });
          if (applied && picked.best) {
            return { ok: true, result: { ...picked, quotes: merged, storeStatus: { [winner.store]: "recheck" } }, attempts, item, recheck: true };
          }
        }
        attempts.push({ attempt: "recheck", priceUp: true, old: oldPrice, new: newPrice });
      } else {
        attempts.push({ attempt: "recheck", failed: true });
      }
    } catch (err) {
      attempts.push({ attempt: "recheck", error: err.message });
    }
  }

  for (let attempt = 0; attempt < FETCH_MAX_ATTEMPTS; attempt++) {
    const expanded = attempt >= 1;
    let result;
    try {
      result = await getBestSupplyQuote(item, rates, {
        delayMs: options?.delayMs || 0,
        expanded,
        stores: STORES,
      });
    } catch (err) {
      attempts.push({ attempt: attempt + 1, error: err.message });
      await sleep(800);
      continue;
    }

    lastResult = result;
    attempts.push({
      attempt: attempt + 1,
      quotes: (result.quotes || []).length,
      storeStatus: result.storeStatus || {},
      best: result.best ? result.best.store + ":" + result.best.priceArs : null,
    });

    if (result.best) {
      const applied = applyBestToItem(item, result);
      if (applied) return { ok: true, result, attempts, item };
    }

    await sleep(600 + attempt * 400);
  }

  applyBestToItem(item, { best: null, quotes: sanitizeQuotesForSave(lastResult.quotes || []) });
  return { ok: false, result: lastResult, attempts, item, pending: true };
}

async function candidateFromExcelLink(store, link, item, rates) {
  const clean = String(link || "").trim();
  if (!clean) return null;
  try {
    if (store === "kinguin") {
      return await quoteFromLink({ ...item, linkKinguin: clean }, rates);
    }
    if (store === "driffle") {
      const page = await verifyDriffleProductPage(clean);
      if (!page?.inStock || !page.priceArs) return null;
      return {
        store: "driffle",
        name: page.name || item.fullName,
        priceArs: page.priceArs,
        link: page.link || clean,
        source: "link",
      };
    }
    if (store === "eneba") {
      const page = await verifyEnebaProductPage(clean, item, rates);
      if (!page?.inStock || !page.priceArs) return null;
      return {
        store: "eneba",
        name: page.name || item.fullName,
        priceArs: page.priceArs,
        link: page.link || clean,
        slug: parseEnebaSlug(clean),
        source: "link",
      };
    }
    if (store === "loaded") {
      const page = await verifyLoadedProduct(clean);
      if (!page?.inStock || !page.priceArs) return null;
      return {
        store: "loaded",
        name: page.name || item.fullName,
        priceArs: page.priceArs,
        link: clean,
        source: "link",
      };
    }
  } catch (_) {}
  return null;
}

async function getBestFromExcelLinks(item, rates) {
  const pairs = [
    ["kinguin", item.linkKinguin],
    ["driffle", item.linkDriffle],
    ["eneba", item.linkEneba],
    ["loaded", item.linkLoaded],
  ];
  const candidates = [];
  for (const [store, link] of pairs) {
    const q = await candidateFromExcelLink(store, link, item, rates);
    if (q) candidates.push(q);
  }
  const verified = await verifyQuotesPerStore(candidates, item, rates);
  const picked = pickBestFromQuotes(item, verified);
  picked.storeStatus = Object.fromEntries(
    STORES.map((s) => [s, candidates.some((c) => c.store === s) ? "link" : "sin_link"])
  );
  return picked;
}

module.exports = {
  getBestSupplyQuote,
  applyBestToItem,
  reapplyBestFromStoredQuotes,
  reselectBestAvoidingBrokenLinks,
  fetchItemSupply,
  recheckWinningQuote,
  needsFullSupplySearch,
  STORES,
  getStoreQuotes,
  getBestFromExcelLinks,
  RECHECK_TTL_MS,
};