"use strict";

const { buildSearchQueries, buildExpandedSearchQueries, filterCandidates, wantsLatam, stripSubscriptionSections, isPaidExtraOfferLine } = require("./match-product.cjs");
const { toArsFromForeign, pickPublicMinPrice, enebaAuctionPricesArs, pickPublicMinUsd, publicUsdFromPriceGroup, pickAnchoredPublicUsd, isPlausibleStoreCompraArs, MIN_GAME_USD } = require("./fx-ars.cjs");
const { parseArNumber } = require("./fx-rates.cjs");
const { withPage, waitCloudflare } = require("./browser-supply.cjs");

const ENEBA_GRAPHQL = "https://www.eneba.com/graphql/";

function parseEnebaSlug(link) {
  const s = String(link || "");
  const m = s.match(/eneba\.com\/(?:latam|ar|us|gb|[a-z]{2}(?:-[a-z]{2})?)\/([^/?#]+)/i);
  if (m && m[1].length >= 8) return m[1];
  const parts = s.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  if (last.length >= 8 && !/^(latam|store|login|registration)$/i.test(last)) return last;
  return "";
}

function enebaLocaleForItem(item) {
  return wantsLatam(item) ? "latam" : "latam";
}

function enebaCountryForItem(item) {
  return "AR";
}

function enebaCurrencyForCountry(country) {
  return country === "AR" ? "USD" : "USD";
}

function enebaProductUrl(slug, item) {
  const locale = enebaLocaleForItem(item);
  return "https://www.eneba.com/" + locale + "/" + String(slug || "").replace(/^\/+/, "");
}

function parseVisibleArsPrices(text) {
  const prices = new Set();
  const body = stripSubscriptionSections(text);
  for (const m of body.matchAll(/(?:ARS|AR\$)\s*([\d.,]+)/gi)) {
    const raw = String(m[1]).replace(/\./g, "").replace(",", ".");
    const n = Number(raw);
    if (n >= 8000 && n < 5000000) prices.add(Math.round(n));
  }
  return [...prices].sort((a, b) => a - b);
}

function parseVisibleUsdPrices(text) {
  const prices = new Set();
  const body = stripSubscriptionSections(text);

  for (const m of body.matchAll(/([\d]{1,4}(?:[.,]\d{1,2})?)\s*US\$/gi)) {
    const n = parseArNumber(m[1]);
    if (n >= 1 && n < 5000) prices.add(n);
  }

  for (const m of body.matchAll(/(?:US\$|\$)\s*([\d]{1,4}(?:[.,]\d{1,2})?)/g)) {
    const n = parseArNumber(m[1]);
    if (n >= 1 && n < 5000) prices.add(n);
  }

  return [...prices].sort((a, b) => a - b);
}

function isSellerOfferLine(line) {
  const t = String(line || "");
  if (!/US\$|\$/.test(t)) return false;
  if (/service fee|commission|tax|iva|fee|cargo|comisi|not the final|no es el precio final/i.test(t)) return false;
  if (/oferta destacada|featured offer|buy now|comprar ahora|recommended offer/i.test(t)) return false;
  return /safe_purchase|game zone|venus|portal|shop|seller|vendedor|merchant|a-z game/i.test(t);
}

function minPriceFromPublicOfferLines(auctionText, parseLinePrices) {
  const prices = [];
  for (const line of String(auctionText || "").split("\n")) {
    if (!line.trim() || isPaidExtraOfferLine(line)) continue;
    if (!isSellerOfferLine(line)) continue;
    const linePrices = parseLinePrices(line);
    const pub = publicUsdFromPriceGroup(linePrices);
    if (pub) prices.push(pub);
  }
  return prices.length ? Math.min(...prices) : null;
}

function resolveEnebaPriceUsd(text, auctionText) {
  const body = stripSubscriptionSections(text);
  const anchored = pickAnchoredPublicUsd(body);
  if (anchored) return anchored;

  const usdFromOffers = minPriceFromPublicOfferLines(auctionText, (line) => {
    const found = [];
    for (const m of line.matchAll(/([\d.,]+)\s*US\$/gi)) {
      const n = parseArNumber(m[1]);
      if (n >= MIN_GAME_USD && n < 5000) found.push(n);
    }
    for (const m of line.matchAll(/US\$\s*([\d.,]+)/gi)) {
      const n = parseArNumber(m[1]);
      if (n >= MIN_GAME_USD && n < 5000) found.push(n);
    }
    return found;
  });
  if (usdFromOffers) return usdFromOffers;

  return pickPublicMinUsd(body);
}

function pickEnebaPublicUsd(text) {
  return resolveEnebaPriceUsd(text, "");
}

async function verifyEnebaProductPage(linkOrSlug, item, rates) {
  const slug = parseEnebaSlug(linkOrSlug) || String(linkOrSlug || "").replace(/^\/+/, "");
  if (!slug) return null;
  const url = String(linkOrSlug || "").startsWith("http") ? linkOrSlug : enebaProductUrl(slug, item);

  const dom = await withPage(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitCloudflare(page, 25);
    await page.waitForTimeout(3500);
    return page.evaluate(() => {
      const title = document.querySelector("h1")?.textContent?.trim() || document.title || "";
      const body = document.body?.innerText || "";
      const auctionBits = [];
      for (const row of document.querySelectorAll(
        "[class*='auction'], [class*='offer'], [class*='seller'], [data-testid*='offer'], table tr, li"
      )) {
        const t = row.textContent?.replace(/\s+/g, " ").trim();
        if (t && /(\$|ARS|US\$)/.test(t) && t.length < 300) auctionBits.push(t);
      }
      const ld = [];
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          ld.push(JSON.parse(s.textContent || ""));
        } catch (_) {}
      }
      return { title, body: body.slice(0, 16000), auctionText: auctionBits.join("\n"), ld };
    });
  });

  if (!dom) return null;

  const text = [dom.title, dom.body, dom.auctionText].join("\n");
  let priceArs = null;
  let source = "page_usd";

  let priceUsd = resolveEnebaPriceUsd(text, dom.auctionText);

  if (!priceUsd && dom.ld?.length) {
    for (const block of dom.ld) {
      const offers = block?.offers;
      const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
      for (const o of list) {
        const cur = String(o?.priceCurrency || o?.priceSpecification?.priceCurrency || "").toUpperCase();
        const amt = Number(o?.price || o?.lowPrice || o?.priceSpecification?.price);
        if (cur === "USD" && amt >= MIN_GAME_USD && amt < 5000) {
          priceUsd = priceUsd == null ? amt : Math.min(priceUsd, amt);
        }
      }
    }
  }

  if (priceUsd && rates) {
    priceArs = toArsFromForeign(priceUsd, "USD", rates);
  }

  if (priceArs && !isPlausibleStoreCompraArs(priceArs, item, rates)) {
    priceArs = null;
    priceUsd = null;
  }

  if (!priceArs && rates) {
    const gql = await tryGraphqlSlug(slug, item, rates);
    if (gql?.priceArs && isPlausibleStoreCompraArs(gql.priceArs, item, rates)) {
      return {
        priceArs: gql.priceArs,
        name: gql.name || dom.title,
        activationText: gql.name || text,
        link: gql.link || url,
        slug,
        inStock: true,
        source: "graphql",
      };
    }
  }

  if (!priceArs) return null;
  if (!isPlausibleStoreCompraArs(priceArs, item, rates)) return null;

  const soldOut = /\bout of stock\b|\bsold out\b|\bno offers\b|\bagotado\b|\bno disponible\b/i.test(text);
  return {
    priceArs,
    name: dom.title,
    activationText: text,
    link: url,
    slug,
    inStock: !soldOut,
    source,
  };
}

async function fetchEnebaProduct(slug, wantsLatamRegion) {
  const country = wantsLatamRegion ? "AR" : "US";
  const currency = enebaCurrencyForCountry(country);
  const query = `query ProductPage($slug: String!, $country: String!, $currency: String!) {
    product(slug: $slug, country: $country, currency: $currency) {
      slug name
      auctions(first: 25) {
        edges { node { price { amount currency } isInStock merchant { name } } }
      }
    }
  }`;
  const res = await fetch(ENEBA_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
      Origin: "https://www.eneba.com",
      Referer: "https://www.eneba.com/" + country.toLowerCase() + "/" + slug,
    },
    body: JSON.stringify({
      operationName: "ProductPage",
      query,
      variables: { slug, country, currency },
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.data?.product || null;
}

async function tryGraphqlSlug(slug, item, rates) {
  try {
    const product = await fetchEnebaProduct(slug, wantsLatam(item));
    if (!product) return null;
    const name = product.name || item.fullName;
    const priceArs = enebaAuctionPricesArs(product.auctions?.edges || [], rates);
    if (!priceArs) return null;
    const locale = enebaLocaleForItem(item);
    return {
      store: "eneba",
      name,
      priceArs,
      link: "https://www.eneba.com/" + locale + "/" + slug,
      source: "graphql",
      slug,
    };
  } catch (_) {
    return null;
  }
}

async function searchEnebaBrowser(query) {
  return withPage(async (page) => {
    const url =
      "https://www.eneba.com/latam/store/all?text=" +
      encodeURIComponent(query) +
      "&os=windows&platform=steam";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitCloudflare(page, 25);
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const slugs = new Set();
      for (const a of document.querySelectorAll('a[href*="/latam/"], a[href*="/ar/"]')) {
        const m = a.href.match(/eneba\.com\/(?:latam|ar)\/([a-z0-9-]{10,})/i);
        if (!m) continue;
        const slug = m[1];
        if (/store|login|registration|collection|sell|affiliate|terms|privacy|blog|careers|contact|help|faq|about|cookies|refund|support|checkout|cart|wallet|gift|topup|plus|promo|vendor|merchant|become|api|robots|sitemap/.test(slug)) continue;
        slugs.add(slug);
      }
      return [...slugs].slice(0, 12);
    });
  });
}

async function getEnebaQuotes(item, rates, options) {
  const candidates = [];
  const seen = new Set();
  const queries = options?.expanded ? buildExpandedSearchQueries(item) : buildSearchQueries(item);
  function add(c) {
    if (!c || !c.priceArs) return;
    const key = (c.link || c.slug || c.name) + "|" + c.priceArs;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  }

  const slugSet = new Set();

  for (const q of queries) {
    let slugs = [];
    try {
      slugs = (await searchEnebaBrowser(q)) || [];
    } catch (_) {
      continue;
    }
    for (const slug of slugs) {
      if (slugSet.has(slug)) continue;
      slugSet.add(slug);
      add(await tryGraphqlSlug(slug, item, rates));
    }
  }

  const filtered = filterCandidates(item, candidates);
  return filtered;
}

module.exports = {
  getEnebaQuotes,
  parseEnebaSlug,
  tryGraphqlSlug,
  fetchEnebaProduct,
  verifyEnebaProductPage,
  enebaProductUrl,
};
