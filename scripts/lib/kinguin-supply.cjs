"use strict";

const OFFER_API = "https://www.kinguin.net/services/offer-explorer/api/v2/public/offers";
const {
  buildSearchQueries,
  buildExpandedSearchQueries,
  filterCandidates,
  deliveryTypeFromItem,
  editionFromVariant,
  normalizeForStoreQuery,
  stripSubscriptionSections,
  isSubscriptionListing,
} = require("./match-product.cjs");
const { fetchOffer } = require("./kinguin-api.cjs");
const { kinguinPublicPriceArs, kinguinInStock, pickPublicMinPrice, toArsFromUsd, pickPublicMinUsd, pickAnchoredPublicUsd, usdParseOptions } = require("./fx-ars.cjs");
const { withPage, waitCloudflare, browserAllowed } = require("./browser-supply.cjs");
const {
  parseKinguinOfferId,
  isPlaceholderKinguinLink,
  pickKinguinProductLink,
} = require("./kinguin-api.cjs");

function kinguinDeliverySuffix(item) {
  return deliveryTypeFromItem(item) === "account" ? "PC Steam Account" : "PC Steam CD Key";
}

function buildKinguinSearchQueries(item, options) {
  const base = options?.expanded ? buildExpandedSearchQueries(item) : buildSearchQueries(item);
  const game = normalizeForStoreQuery(item.game || "");
  const edition = editionFromVariant(item);
  const suffix = kinguinDeliverySuffix(item);
  const parts = game.split(/\s+/).filter((p) => p.length > 0);
  const tailQueries = [];
  const headQueries = [...base];

  if (edition) {
    for (let n = 1; n <= Math.min(3, parts.length); n++) {
      const tail = parts.slice(-n).join(" ");
      if (tail.length >= 3) tailQueries.push(`${tail} ${edition} ${suffix}`);
    }
  }

  if (game) {
    headQueries.push(`${game} ${suffix}`);
    if (edition) headQueries.push(`${game} ${edition}`);
  }

  const seen = new Set();
  const ordered = [];
  for (const q of [...tailQueries, ...headQueries]) {
    if (!q || seen.has(q)) continue;
    seen.add(q);
    ordered.push(q);
  }
  return ordered;
}

async function searchKinguinOffers(query, rates) {
  const url = OFFER_API + "?name=" + encodeURIComponent(query) + "&page=0&size=50";
  const res = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.content || []).filter(
    (o) => o.status === "ACTIVE" && kinguinInStock(o) && !isSubscriptionListing(o.name, o.url)
  );
}

function offerToCandidate(offer, rates, linkOverride) {
  if (isSubscriptionListing(offer.name, offer.url || linkOverride)) return null;
  const priceArs = kinguinPublicPriceArs(offer, rates);
  if (!priceArs) return null;
  const offerId = offer.id || offer.offerId;
  let link = linkOverride || offer.url || "";
  if (isPlaceholderKinguinLink(link)) link = "";
  return {
    store: "kinguin",
    name: offer.name,
    priceArs,
    link,
    offerId: offerId || "",
    source: "search",
  };
}

function parseKinguinArsToken(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/,/.test(s) && /\./.test(s)) {
    return Math.round(Number(s.replace(/\./g, "").replace(",", ".")));
  }
  if (/\.\d{1,2}$/.test(s)) {
    return Math.round(Number(s));
  }
  if (/,/.test(s)) {
    return Math.round(Number(s.replace(",", ".")));
  }
  return Math.round(Number(s.replace(/\./g, "")));
}

function parseKinguinArsPrices(text, minArs = 3000) {
  const prices = [];
  for (const m of String(text || "").matchAll(/AR\$\s*([\d.,]+)/gi)) {
    const n = parseKinguinArsToken(m[1]);
    if (n >= minArs && n < 5000000) prices.push(n);
  }
  for (const m of String(text || "").matchAll(/(?:ARS|\$)\s*([\d.,]+)/gi)) {
    const n = parseKinguinArsToken(m[1]);
    if (n >= minArs && n < 5000000) prices.push(n);
  }
  return [...new Set(prices)].sort((a, b) => a - b);
}

function parseKinguinUsdPrices(text, item) {
  const anchored = pickAnchoredPublicUsd(text);
  if (anchored != null) return anchored;
  return pickPublicMinUsd(stripSubscriptionSections(text), item ? usdParseOptions(item) : undefined);
}

function pickKinguinPublicBuyPrice(heroText, rates, item) {
  const usd = parseKinguinUsdPrices(heroText, item);
  if (usd && rates) {
    return toArsFromUsd(usd, rates);
  }
  return null;
}

function pickKinguinDisplayedPrice(arsPrices, apiPriceArs, heroText, rates, item) {
  const pub = pickKinguinPublicBuyPrice(heroText, rates, item);
  if (pub) return pub;
  if (apiPriceArs) return apiPriceArs;
  return null;
}

const KINGUIN_USD_COOKIES = [
  { name: "currency", value: "USD", domain: ".kinguin.net", path: "/" },
  { name: "currencyCode", value: "USD", domain: ".kinguin.net", path: "/" },
  { name: "selectedCurrency", value: "USD", domain: ".kinguin.net", path: "/" },
];

const KINGUIN_USD_INIT = () => {
  const keys = ["currency", "currencyCode", "selectedCurrency", "preferredCurrency", "userCurrency"];
  for (const k of keys) {
    try {
      localStorage.setItem(k, "USD");
      sessionStorage.setItem(k, "USD");
    } catch (_) {}
  }
};

function kinguinUrlWithUsd(url) {
  const base = kinguinCategoryBaseUrl(url) || String(url || "").split("?")[0].split("#")[0];
  if (!base) return "";
  const u = new URL(base);
  u.searchParams.set("currency", "USD");
  return u.toString();
}

async function ensureKinguinUsdCurrency(page) {
  const before = await page.evaluate(() => {
    const hero = document.body?.innerText?.slice(0, 4000) || "";
    const hasUsd =
      /\bUS\$\s*[\d.,]+\b/i.test(hero) ||
      /\bUSD\s*[\d.,]+\b/i.test(hero) ||
      /Moneda:\s*USD/i.test(hero);
    const hasEur = /\b€\s*[\d.,]+\b/.test(hero) || /\bEUR\s*[\d.,]+\b/i.test(hero);
    return { hasUsd, hasEur, hero: hero.slice(0, 800) };
  });
  if (before.hasUsd && !before.hasEur) return true;

  const settingsSelectors = [
    "button[aria-label*='currency' i]",
    "button[aria-label*='moneda' i]",
    "[data-test*='currency' i]",
    "[class*='currency' i] button",
    "button:has-text('Moneda')",
    "button:has-text('Currency')",
  ];
  for (const sel of settingsSelectors) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 2500 });
        await page.waitForTimeout(800);
        break;
      }
    } catch (_) {}
  }

  const usdSelectors = [
    "button:has-text('USD')",
    "[role='button']:has-text('USD')",
    "a:has-text('USD')",
    "li:has-text('USD')",
    "[data-currency='USD']",
    "[data-value='USD']",
  ];
  for (const sel of usdSelectors) {
    try {
      const opt = page.locator(sel).first();
      if ((await opt.count()) > 0) {
        await opt.click({ timeout: 2500 });
        await page.waitForTimeout(1200);
        break;
      }
    } catch (_) {}
  }

  await page.evaluate(() => {
    const keys = ["currency", "currencyCode", "selectedCurrency", "preferredCurrency", "userCurrency"];
    for (const k of keys) {
      try {
        localStorage.setItem(k, "USD");
        sessionStorage.setItem(k, "USD");
      } catch (_) {}
    }
  });

  try {
    const url = new URL(page.url());
    if (url.searchParams.get("currency") !== "USD") {
      url.searchParams.set("currency", "USD");
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 90000 });
      await waitCloudflare(page, 15);
      await page.waitForTimeout(2000);
    }
  } catch (_) {}

  const after = await page.evaluate(() => {
    const hero = document.body?.innerText?.slice(0, 4000) || "";
    const hasUsd =
      /\bUS\$\s*[\d.,]+\b/i.test(hero) ||
      /\bUSD\s*[\d.,]+\b/i.test(hero) ||
      /Moneda:\s*USD/i.test(hero);
    const hasEur = /\b€\s*[\d.,]+\b/.test(hero) || /\bEUR\s*[\d.,]+\b/i.test(hero);
    return { hasUsd, hasEur };
  });
  return after.hasUsd || !after.hasEur;
}

async function scrapeKinguinHeroPage(url, rates, item) {
  const target = kinguinUrlWithUsd(url);
  if (!target) return null;
  const raw = await withPage(
    async (page) => {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitCloudflare(page, 25);
    await ensureKinguinUsdCurrency(page);
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const title =
        document.querySelector("h1, [data-test='product-title'], .product-title")?.textContent?.trim() || "";
      const full = document.body?.innerText || "";
      const cut = full.split(/SELECCIONADOS PARA TI|SELECTED FOR YOU|PRODUCTOS RELACIONADOS|YOU MAY ALSO LIKE/i)[0];
      const hero = cut.slice(0, Math.max(3500, cut.indexOf(title) + 2500));
      const bits = [];
      for (const el of document.querySelectorAll(
        "[class*='activation'], [class*='region'], [class*='product-info'], [class*='description'], .product-details, table"
      )) {
        const t = el.textContent?.trim();
        if (t && /activ|region|latam|argentin|country|global|worldwide/i.test(t)) bits.push(t.slice(0, 2000));
      }
      const offerLinks = [];
      const seen = new Set();
      for (const a of document.querySelectorAll("a[href*='o=']")) {
        const href = a.href || "";
        const om = href.match(/[?&]o=([a-f0-9]+)/i);
        if (!om || seen.has(om[1])) continue;
        seen.add(om[1]);
        offerLinks.push({
          offerId: om[1],
          link: href.split("#")[0],
          name: a.getAttribute("title") || a.textContent?.trim()?.slice(0, 120) || "",
        });
        if (offerLinks.length >= 15) break;
      }
      return {
        title,
        heroText: hero,
        activationText: [title, bits.join("\n"), hero].join("\n"),
        inStock: !/\bout of stock\b|\bagotado\b|\bno disponible\b|\bsold out\b/i.test(hero),
        offerLinks,
        pageUrl: location.href.split("#")[0],
      };
    });
    },
    {
      cookies: KINGUIN_USD_COOKIES,
      initScript: KINGUIN_USD_INIT,
    }
  );
  if (!raw) return null;
  let priceArs = pickKinguinPublicBuyPrice(raw.heroText, rates, item);
  return {
    ...raw,
    arsPrices: [],
    priceArs: priceArs || null,
  };
}

function mergeKinguinVerifiedPrice(apiPriceArs, pagePriceArs) {
  const p = Number(pagePriceArs) || 0;
  const a = Number(apiPriceArs) || 0;
  if (p) return p;
  return a || null;
}

async function quoteFromLink(item, rates) {
  const link = item.linkKinguin || "";
  const catBase = kinguinCategoryBaseUrl(link);
  const offerMatch = link.match(/o=([a-f0-9]+)/i);
  let offer = null;
  let offerId = offerMatch?.[1] || "";

  if (offerId) {
    offer = await fetchOffer(offerId).catch(() => null);
  }

  let hero = null;
  if (catBase) {
    try {
      hero = await scrapeKinguinHeroPage(link, rates, item);
    } catch (_) {}
  }

  if (!offer && hero?.offerLinks?.length) {
    const hit = hero.offerLinks[0];
    offerId = hit.offerId;
    offer = await fetchOffer(offerId).catch(() => null);
  }

  if (!offer && !hero?.priceArs) return null;
  if (offer && !kinguinInStock(offer)) return null;

  const apiPriceArs = offer ? kinguinPublicPriceArs(offer, rates) : null;
  const priceArs = mergeKinguinVerifiedPrice(apiPriceArs, hero?.priceArs);
  if (!priceArs) return null;

  const cleanLink = catBase
    ? pickKinguinProductLink({
        candidateLink: link,
        offerId: offerId || undefined,
        categoryLink: catBase,
      }) || (offerId ? catBase + (catBase.includes("?") ? "&" : "?") + "o=" + offerId : catBase)
    : isPlaceholderKinguinLink(link)
      ? ""
      : link.split("#")[0];
  if (!cleanLink || isPlaceholderKinguinLink(cleanLink)) return null;

  return {
    store: "kinguin",
    name: hero?.title || offer?.name || item.fullName,
    priceArs,
    link: cleanLink,
    offerId: offerId || "",
    source: hero?.priceArs ? "page_usd" : "api_usd",
    categoryLink: catBase || "",
  };
}

function kinguinCategoryBaseUrl(link) {
  const u = String(link || "").trim();
  const m = u.match(/^(https?:\/\/[^?#]+\/category\/[1-9]\d+\/[^/?#]+)/i);
  return m ? m[1] : "";
}

async function offersFromKinguinCategory(item, rates, categoryUrl) {
  const base = kinguinCategoryBaseUrl(categoryUrl);
  if (!base) return [];
  let hero = null;
  try {
    hero = await scrapeKinguinHeroPage(base, rates, item);
  } catch (_) {}

  const hits = hero?.offerLinks?.length
    ? hero.offerLinks
    : await withPage(async (page) => {
        await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
        await waitCloudflare(page, 20);
        await page.waitForTimeout(2000);
        return page.evaluate(() => {
          const out = [];
          const seen = new Set();
          for (const a of document.querySelectorAll("a[href*='/category/'], a[href*='o=']")) {
            const href = a.href || "";
            const om = href.match(/[?&]o=([a-f0-9]+)/i);
            if (!om || seen.has(om[1])) continue;
            seen.add(om[1]);
            out.push({
              offerId: om[1],
              name: a.getAttribute("title") || a.textContent?.trim()?.slice(0, 160) || "",
              link: href.split("#")[0],
            });
            if (out.length >= 30) break;
          }
          return out;
        });
      });
  if (!hits?.length && !hero?.priceArs) return [];

  const built = [];
  const offerIds = [...new Set((hits || []).map((h) => h.offerId).filter(Boolean))].slice(0, 20);
  const offers = await Promise.all(offerIds.map((id) => fetchOffer(id).catch(() => null)));
  const hitById = new Map((hits || []).map((h) => [h.offerId, h]));
  for (const offer of offers) {
    if (!offer || !kinguinInStock(offer)) continue;
    const hit = hitById.get(offer.id || offer.offerId);
    const c = offerToCandidate(offer, rates, hit?.link);
    if (c && !c.link && hit?.link && !isPlaceholderKinguinLink(hit.link)) c.link = hit.link.split("#")[0];
    if (c?.link) {
      c.priceArs = mergeKinguinVerifiedPrice(c.priceArs, hero?.priceArs);
      c.categoryLink = base;
      built.push(c);
    }
  }
  if (!built.length && hero?.priceArs) {
    const oid = offerIds[0] || parseKinguinOfferId(categoryUrl);
    const link = pickKinguinProductLink({ candidateLink: categoryUrl, offerId: oid, categoryLink: base }) || base;
    built.push({
      store: "kinguin",
      name: hero.title || item.fullName,
      priceArs: hero.priceArs,
      link,
      offerId: oid || "",
      source: "category_hero",
      categoryLink: base,
    });
  }
  return built;
}

async function searchKinguinOffersPaged(query, rates) {
  const all = [];
  for (let page = 0; page < 3; page++) {
    const url = OFFER_API + "?name=" + encodeURIComponent(query) + "&page=" + page + "&size=50";
    const res = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) break;
    const data = await res.json();
    const batch = (data.content || []).filter(
      (o) => o.status === "ACTIVE" && kinguinInStock(o) && !isSubscriptionListing(o.name, o.url)
    );
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < 50) break;
  }
  return all;
}

async function searchKinguinBrowser(query) {
  const searchUrls = [
    "https://www.kinguin.net/es/catalogsearch/result/?q=" + encodeURIComponent(query),
    "https://www.kinguin.net/es/catalogsearch/result/?phrase=" + encodeURIComponent(query) + "&active=1",
  ];
  return withPage(async (page) => {
    let categories = [];
    let offers = [];
    for (const url of searchUrls) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      await waitCloudflare(page, 25);
      await page.waitForTimeout(2500);
      const found = await page.evaluate(() => {
        const categories = [];
        const offers = [];
        const seenCat = new Set();
        const seenOffer = new Set();
        for (const a of document.querySelectorAll("a[href*='/category/']")) {
          const href = a.href || "";
          const cat = href.match(/\/category\/(\d+)\/([^/?#]+)/i);
          if (cat && !seenCat.has(cat[1])) {
            seenCat.add(cat[1]);
            categories.push({
              categoryId: cat[1],
              slug: cat[2],
              link: href.split("?")[0],
              name: a.getAttribute("title") || a.textContent?.trim()?.slice(0, 120) || "",
            });
          }
          const om = href.match(/[?&]o=([a-f0-9]+)/i);
          if (om && !seenOffer.has(om[1])) {
            seenOffer.add(om[1]);
            offers.push({
              offerId: om[1],
              name: a.getAttribute("title") || a.textContent?.trim()?.slice(0, 120) || "",
              link: href.split("#")[0],
            });
          }
        }
        return { categories, offers };
      });
      categories.push(...(found.categories || []));
      offers.push(...(found.offers || []));
      if (categories.length || offers.length) break;
    }

    const hits = [...offers];
    const seenOffer = new Set(offers.map((o) => o.offerId));
    const seenCat = new Set();
    for (const cat of categories.slice(0, 6)) {
      if (seenCat.has(cat.categoryId)) continue;
      seenCat.add(cat.categoryId);
      try {
        await page.goto(cat.link, { waitUntil: "domcontentloaded", timeout: 90000 });
        await waitCloudflare(page, 20);
        await page.waitForTimeout(2000);
        const scraped = await page.evaluate(() => {
          const hits = [];
          const seen = new Set();
          for (const a of document.querySelectorAll("a[href]")) {
            const href = a.href || "";
            const m = href.match(/[?&]o=([a-f0-9]+)/i);
            if (!m || seen.has(m[1])) continue;
            seen.add(m[1]);
            hits.push({
              offerId: m[1],
              name: a.getAttribute("title") || a.textContent?.trim()?.slice(0, 120) || "",
              link: href.split("#")[0],
            });
            if (hits.length >= 25) break;
          }
          return { hits, title: document.querySelector("h1")?.textContent?.trim() || "" };
        });
        for (const h of scraped?.hits || []) {
          if (seenOffer.has(h.offerId)) continue;
          seenOffer.add(h.offerId);
          hits.push({ ...h, categoryName: scraped.title || cat.name, categoryLink: cat.link });
        }
      } catch (_) {}
    }
    return hits;
  });
}

async function getKinguinQuotes(item, rates, options) {
  const candidates = [];
  const seen = new Set();
  const queries = buildKinguinSearchQueries(item, options);

  function add(c) {
    if (!c || !c.priceArs) return;
    if (c.priceArs > 800000) return;
    const key = (c.offerId || "") + "|" + (c.link || c.name);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  }

  try {
    const fromLink = await quoteFromLink(item, rates);
    if (fromLink) add(fromLink);
  } catch (_) {}

  const catUrl = kinguinCategoryBaseUrl(item.linkKinguin || "");
  if (catUrl) {
    try {
      for (const c of await offersFromKinguinCategory(item, rates, catUrl)) add(c);
    } catch (_) {}
  }

  const apiBatches = await Promise.all(
    queries.map((q) => searchKinguinOffersPaged(q, rates).catch(() => []))
  );
  for (const offers of apiBatches) {
    for (const offer of offers) {
      add(offerToCandidate(offer, rates));
    }
  }

  const filteredSoFar = filterCandidates(item, candidates);
  const browserQueries = options?.forceFullSearch || options?.expanded ? queries.slice(0, 3) : queries.slice(0, 2);
  const needBrowser =
    browserAllowed() &&
    (options?.forceFullSearch ||
      options?.expanded ||
      filteredSoFar.length < 10 ||
      !filteredSoFar.some((c) => c.link && !isPlaceholderKinguinLink(c.link)));

  if (needBrowser) {
    for (const q of browserQueries) {
      let hits = [];
      try {
        hits = (await searchKinguinBrowser(q)) || [];
      } catch (_) {
        continue;
      }
      const offerIds = [...new Set(hits.map((h) => h.offerId).filter(Boolean))].slice(0, 25);
      const offers = await Promise.all(offerIds.map((id) => fetchOffer(id).catch(() => null)));
      const hitById = new Map(hits.map((h) => [h.offerId, h]));
      for (const offer of offers) {
        if (!offer || !kinguinInStock(offer)) continue;
        const hit = hitById.get(offer.id || offer.offerId);
        const built = offerToCandidate(offer, rates, hit?.link);
        if (built && !built.link && hit?.link && !isPlaceholderKinguinLink(hit.link)) {
          built.link = hit.link.split("#")[0];
        }
        add(built);
      }
    }
  }

  return filterCandidates(item, candidates);
}

async function resolveKinguinOfferLink(item, offerId) {
  const oid = parseKinguinOfferId(offerId);
  if (!oid) return "";
  const queries = buildKinguinSearchQueries(item, { expanded: true }).slice(0, 4);
  for (const q of queries) {
    let hits = [];
    try {
      hits = (await searchKinguinBrowser(q)) || [];
    } catch (_) {
      continue;
    }
    const hit = hits.find((h) => h.offerId === oid);
    if (hit?.link && !isPlaceholderKinguinLink(hit.link)) return hit.link.split("#")[0];
  }
  return "";
}

async function getBestKinguinQuote(item, rates) {
  const quotes = await getKinguinQuotes(item, rates);
  if (!quotes.length) return null;
  quotes.sort((a, b) => (a.priceArs || 0) - (b.priceArs || 0));
  return quotes[0];
}

module.exports = {
  getKinguinQuotes,
  getBestKinguinQuote,
  searchKinguinOffers,
  searchKinguinBrowser,
  buildKinguinSearchQueries,
  resolveKinguinOfferLink,
  quoteFromLink,
  offersFromKinguinCategory,
  kinguinCategoryBaseUrl,
  scrapeKinguinHeroPage,
  mergeKinguinVerifiedPrice,
  parseKinguinArsPrices,
  pickKinguinPublicBuyPrice,
};