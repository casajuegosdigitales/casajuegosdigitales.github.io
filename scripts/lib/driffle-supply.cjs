"use strict";

const { buildSearchQueries, buildExpandedSearchQueries, filterCandidates, regionOk, stripSubscriptionSections, isSubscriptionListing } = require("./match-product.cjs");
const { toArsFromUsd, driffleBestPublicArs, pickPublicMinPrice, pickPublicMinUsdExact, pickPublicMinUsd, pickAnchoredPublicUsd, collectAnchoredPublicUsd, collectPublicUsdFromText, usdParseOptions, MIN_JSON_USD, parseUsdToken } = require("./fx-ars.cjs");
const { withPage, waitCloudflare } = require("./browser-supply.cjs");

const SEARCH_API = "https://search.driffle.com/products/v3/list";
const DRIFFLE_USD_COOKIES = [
  { name: "currency", value: "USD", domain: ".driffle.com", path: "/" },
  { name: "selectedCurrency", value: "USD", domain: ".driffle.com", path: "/" },
];
const HDR = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
  Accept: "application/json",
  Origin: "https://driffle.com",
  Referer: "https://driffle.com/store",
};

function driffleRegionOk(product) {
  const name = product.title || "";
  const region = product.regionName || "";
  if (/europe|\beu\b|turkey|\btr\b|russia|\bru\b/i.test(name + " " + region)) return false;
  if (/latam|latin|argentina|global|row|worldwide/i.test(name + " " + region)) return true;
  return regionOk(name);
}

function productToCandidate(product, rates) {
  const title = product.title || "";
  if (isSubscriptionListing(title, product.slug || "")) return null;
  const priceUsd = Number(product.price ?? product.mrp);
  if (!priceUsd || Number.isNaN(priceUsd)) return null;
  const priceArs = toArsFromUsd(priceUsd, rates);
  if (!priceArs) return null;
  const slug = product.slug || "";
  return {
    store: "driffle",
    name: product.title || "",
    priceArs,
    link: slug ? "https://driffle.com/" + slug : "",
    source: "search",
    region: product.regionName || "",
  };
}

async function searchDriffle(query, rates) {
  const params = new URLSearchParams({
    q: query,
    page: "1",
    limit: "25",
    worksIn: "true",
  });
  const res = await fetch(SEARCH_API + "?" + params.toString(), {
    headers: HDR,
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) return [];
  const json = await res.json();
  const products = json.data || [];
  return products.filter(driffleRegionOk).map((p) => productToCandidate(p, rates)).filter(Boolean);
}

async function quoteFromSlug(slug, item, rates) {
  if (!slug) return null;
  const page = await verifyDriffleProductPage(slug, rates, item);
  if (!page?.inStock || !page.priceArs) return null;
  const title = page.name || item.fullName;
  if (!regionOk(title) && !driffleRegionOk({ title, regionName: "" })) return null;
  return {
    store: "driffle",
    name: title,
    priceArs: page.priceArs,
    link: page.link,
    source: page.source || "page_usd",
  };
}

function parseDriffleSlug(link) {
  const s = String(link || "");
  const m = s.match(/driffle\.com\/(?:[a-z]{2}\/)?([^/?#]+)/i);
  if (m && m[1].length >= 8 && !/^(es|store|login)$/i.test(m[1])) return m[1];
  return "";
}

function driffleUrl(linkOrSlug) {
  const s = String(linkOrSlug || "").trim();
  if (/^https?:\/\//i.test(s)) return s.split("#")[0].split("?")[0];
  const slug = parseDriffleSlug(s) || s.replace(/^\/+/, "");
  return slug ? "https://driffle.com/" + slug : "";
}

function parseArsAmount(raw, minArs) {
  const floor = minArs == null ? 8000 : minArs;
  const n = Number(String(raw || "").replace(/,/g, ""));
  if (!n || Number.isNaN(n) || n < floor || n > 5000000) return null;
  return Math.round(n);
}

function parseUsdAmount(raw, minUsd = MIN_JSON_USD) {
  return parseUsdToken(raw, minUsd);
}

function parseDriffleUsdFromHtml(html, item) {
  const raw = String(html || "");
  const parseOpts = item ? usdParseOptions(item) : { minUsd: MIN_JSON_USD };
  const anchored = pickAnchoredPublicUsd(raw);
  if (anchored != null) return anchored;

  const text = stripSubscriptionSections(raw);
  const fromText = pickPublicMinUsd(text, parseOpts);
  if (fromText != null) return fromText;

  const prices = new Set();
  for (const m of text.matchAll(
    /"priceCurrency"\s*:\s*"USD"[\s\S]*?"lowPrice"\s*:\s*"([\d.]+)"/gi
  )) {
    const p = parseUsdAmount(m[1], MIN_JSON_USD);
    if (p) prices.add(p);
  }
  for (const m of text.matchAll(
    /"@type"\s*:\s*"AggregateOffer"[\s\S]*?"lowPrice"\s*:\s*"([\d.]+)"[\s\S]*?"priceCurrency"\s*:\s*"USD"/gi
  )) {
    const p = parseUsdAmount(m[1], MIN_JSON_USD);
    if (p) prices.add(p);
  }

  const list = [...prices].sort((a, b) => a - b);
  if (!list.length) return null;
  return pickPublicMinPrice(list);
}

function parseDriffleArsFromHtml(html) {
  const text = stripSubscriptionSections(html);

  for (const m of text.matchAll(
    /"@type"\s*:\s*"AggregateOffer"[\s\S]*?"lowPrice"\s*:\s*"([\d.]+)"[\s\S]*?"priceCurrency"\s*:\s*"ARS"/gi
  )) {
    const p = parseArsAmount(m[1], 3000);
    if (p) return p;
  }
  for (const m of text.matchAll(
    /"priceCurrency"\s*:\s*"ARS"[\s\S]*?"lowPrice"\s*:\s*"([\d.]+)"/gi
  )) {
    const p = parseArsAmount(m[1], 3000);
    if (p) return p;
  }
  for (const m of text.matchAll(/starting\s+at\s+ARS\s*([\d,]+(?:\.\d{1,2})?)/gi)) {
    const p = parseArsAmount(m[1], 3000);
    if (p) return p;
  }

  const prices = new Set();
  for (const m of text.matchAll(/property="product:price:amount"\s+content="([\d.]+)"/gi)) {
    const p = parseArsAmount(m[1], 3000);
    if (p) prices.add(p);
  }
  for (const m of text.matchAll(/ARS\s*([\d,]+(?:\.\d{1,2})?)/gi)) {
    const p = parseArsAmount(m[1], 8000);
    if (p) prices.add(p);
  }

  const list = [...prices].sort((a, b) => a - b);
  if (!list.length) return null;
  return pickPublicMinPrice(list);
}

function parseDriffleMetaFromHtml(html) {
  const text = String(html || "");
  const title =
    text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1] ||
    text.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ||
    "";
  const m = text.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  let pageProps = null;
  if (m) {
    try {
      pageProps = JSON.parse(m[1])?.props?.pageProps || null;
    } catch (_) {}
  }
  const productData = pageProps?.product?.data || pageProps?.product || {};
  const regionText = [
    title,
    productData.name,
    productData.title,
    productData.regionName,
    productData.description,
    pageProps?.description,
  ]
    .filter(Boolean)
    .join("\n");
  return { title: productData.name || productData.title || title, regionText, pageProps, productData };
}

/** Precios USD de otras variaciones (selector) para no mezclar ediciones en la misma pagina. */
function driffleCrossVariantExcludedUsd(pageProps) {
  const current = String(pageProps?.slug || pageProps?.product?.data?.slug || "").toLowerCase();
  const data = pageProps?.product?.data || {};
  const multiplier =
    Number(data.countryData?.multiplier || pageProps?.mcPdpData?.multiplier || 0) || 1.1431;
  const excluded = new Set();
  for (const v of data.allVariations || []) {
    const slug = String(v.slug || "").toLowerCase();
    if (!slug || slug === current) continue;
    const base = Number(v.offer?.price);
    if (!base) continue;
    excluded.add(Math.round(base * 100) / 100);
    excluded.add(Math.round(base * multiplier * 100) / 100);
  }
  return excluded;
}

function matchesExcludedUsd(usd, excluded) {
  if (usd == null || !excluded?.size) return false;
  for (const ex of excluded) {
    if (Math.abs(Number(usd) - Number(ex)) <= 0.06) return true;
  }
  return false;
}

function filterExcludedUsd(candidates, excluded) {
  return [...new Set(candidates)].filter((u) => u != null && !matchesExcludedUsd(u, excluded));
}

/** Minimo USD publico visible en pagina (no API interna, no Plus, no otra variacion). */
function parseDrifflePublicUsdFromPage(html, domBody, item, pageProps) {
  const parseOpts = item ? usdParseOptions(item) : { minUsd: MIN_JSON_USD };
  const excluded = driffleCrossVariantExcludedUsd(pageProps);

  function keepUsd(usd) {
    const n = Number(usd);
    const min = parseOpts.minUsd ?? MIN_KEY_USD;
    if (!n || Number.isNaN(n) || n < min || n > 120) return false;
    return !matchesExcludedUsd(n, excluded);
  }

  function collectFromText(text) {
    const body = String(text || "").trim();
    if (!body) return { anchored: [], lines: [] };
    return {
      anchored: collectAnchoredPublicUsd(body).filter(keepUsd),
      lines: collectPublicUsdFromText(body, parseOpts).filter(keepUsd),
    };
  }

  let { anchored, lines } = collectFromText(domBody);

  if (!anchored.length && !lines.length && html) {
    const htmlClean = String(html)
      .replace(/<script id="__NEXT_DATA__"[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n");
    ({ anchored, lines } = collectFromText(htmlClean));
  }

  if (anchored.length) return pickPublicMinUsdExact(anchored);
  if (lines.length) return pickPublicMinUsdExact(lines);
  return null;
}

async function fetchDriffleHtml(linkOrSlug) {
  const url = driffleUrl(linkOrSlug);
  if (!url) return null;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
      Accept: "text/html",
      "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(35000),
  });
  if (!res.ok) return null;
  return res.text();
}

async function verifyDriffleProductPage(linkOrSlug, rates, item) {
  const url = driffleUrl(linkOrSlug);
  if (!url) return null;

  let html = null;
  let httpStatus = 0;
  let dom = null;
  let priceUsd = null;

  try {
    dom = await withPage(async (page) => {
      const target = url.includes("currency=") ? url : url + (url.includes("?") ? "&" : "?") + "currency=USD";
      const resp = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 90000 });
      httpStatus = resp?.status() || 0;
      await waitCloudflare(page, 20);
      await page.waitForTimeout(3500);
      html = await page.content();
      return page.evaluate(() => {
        const title = document.querySelector("h1")?.textContent?.trim() || document.title || "";
        const body = document.body?.innerText || "";
        return { title, body: body.slice(0, 12000) };
      });
    }, { cookies: DRIFFLE_USD_COOKIES });
    const metaFromBrowser = parseDriffleMetaFromHtml(html);
    priceUsd = parseDrifflePublicUsdFromPage(html, dom?.body, item, metaFromBrowser.pageProps);
  } catch (_) {}

  if (!html) {
    try {
      const res = await fetch(url + (url.includes("?") ? "&" : "?") + "currency=USD", {
        headers: {
          "User-Agent": "Mozilla/5.0 Chrome/120",
          Accept: "text/html",
          Cookie: "currency=USD; selectedCurrency=USD",
        },
        signal: AbortSignal.timeout(35000),
        redirect: "follow",
      });
      httpStatus = res.status;
      if (res.ok) {
        html = await res.text();
      }
    } catch (_) {}
  }

  if (!html) return null;
  if (httpStatus === 404 || httpStatus === 410) return null;
  if (/\b404\b|page not found|not found|doesn't exist|product unavailable|no longer available/i.test(html.slice(0, 8000))) {
    return null;
  }

  const meta = parseDriffleMetaFromHtml(html);
  if (!priceUsd) {
    priceUsd = parseDrifflePublicUsdFromPage(html, dom?.body, item, meta.pageProps);
  }

  let priceArs = null;
  let source = "page_usd";
  if (priceUsd && rates) {
    priceArs = toArsFromUsd(priceUsd, rates);
  }
  if (!priceArs) return null;

  const soldOut =
    /\b(no sellers available|currently unavailable)\b/i.test(html) ||
    /\b(no sellers available|currently unavailable)\b/i.test(dom?.body || "");

  return {
    priceArs,
    name: dom?.title || meta.title || "",
    activationText: [dom?.title || meta.title, dom?.body || "", meta.regionText].filter(Boolean).join("\n"),
    link: url,
    inStock: !soldOut,
    source,
  };
}

async function getDriffleQuotes(item, rates, options) {
  const candidates = [];
  const seen = new Set();
  const queries = options?.expanded ? buildExpandedSearchQueries(item) : buildSearchQueries(item);
  function add(c) {
    if (!c || !c.priceArs) return;
    const key = (c.link || c.name) + "|" + c.priceArs;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  }

  for (const q of queries) {
    let found = [];
    try {
      found = await searchDriffle(q, rates);
    } catch (_) {
      continue;
    }
    for (const c of found) add(c);
  }

  const filtered = filterCandidates(item, candidates);
  return filtered;
}

module.exports = {
  getDriffleQuotes,
  searchDriffle,
  parseDriffleSlug,
  verifyDriffleProductPage,
  parseDriffleArsFromHtml,
  driffleUrl,
};