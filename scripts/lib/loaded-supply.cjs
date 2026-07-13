"use strict";

const { buildSearchQueries, buildExpandedSearchQueries, filterCandidates, regionOk, isSubscriptionListing } = require("./match-product.cjs");
const { parseLoadedRawPrice, toArsFromUsd } = require("./fx-ars.cjs");
const { parseArNumber } = require("./fx-rates.cjs");
const { stripSubscriptionSections } = require("./match-product.cjs");
const { withPage, waitCloudflare } = require("./browser-supply.cjs");

function parseLoadedSlug(link) {
  const m = String(link || "").match(/loaded\.com\/([^/?#]+)/i);
  return m ? m[1] : "";
}

async function searchLoadedBrowser(query, attempt) {
  return withPage(async (page) => {
    const base = "https://www.loaded.com/es_es/catalogsearch/result/?q=" + encodeURIComponent(query);
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitCloudflare(page, 30);
    await page.waitForTimeout(attempt > 0 ? 6000 : 4000);
    const title = await page.title();
    if (/moment|cloudflare|just a moment/i.test(title)) return [];
    return page.$$eval("[data-raw-price]", (els) =>
      els.slice(0, 30).map((el) => ({
        name: el.getAttribute("data-name") || el.querySelector("a.product-item-link, a.algolia-hit-link")?.textContent?.trim() || "",
        raw: el.getAttribute("data-raw-price"),
        href: el.querySelector("a.product-item-link, a.algolia-hit-link")?.href || "",
      })).filter((x) => x.name && x.href)
    );
  });
}

function hitToCandidate(hit) {
  if (isSubscriptionListing(hit.name, hit.href)) return null;
  const priceArs = parseLoadedRawPrice(hit.raw);
  if (!priceArs) return null;
  const name = hit.name || "";
  if (!regionOk(name) && !/latam|latin america|global|worldwide|account|steam/i.test(name)) return null;
  return {
    store: "loaded",
    name,
    priceArs,
    link: hit.href,
    source: "search",
  };
}

function parseLoadedUsdPrices(text) {
  const body = stripSubscriptionSections(text);
  const prices = [];
  for (const m of body.matchAll(/([\d.,]+)\s*US\$/gi)) {
    const n = parseArNumber(m[1]);
    if (n >= 0.5 && n < 5000) prices.push(n);
  }
  for (const m of body.matchAll(/US\$\s*([\d.,]+)/gi)) {
    const n = parseArNumber(m[1]);
    if (n >= 0.5 && n < 5000) prices.push(n);
  }
  return prices.length ? Math.min(...prices) : null;
}

function loadedPriceArsFromBody(body, rates, rawAttr) {
  const usd = parseLoadedUsdPrices(body);
  if (usd && rates) {
    return { priceArs: toArsFromUsd(usd, rates), source: "page_usd" };
  }
  if (rawAttr) {
    const n = parseLoadedRawPrice(rawAttr);
    if (n >= 3000) return { priceArs: n, source: "page_ars" };
  }
  return null;
}

async function verifyLoadedProduct(link, rates) {
  return withPage(async (page) => {
    await page.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitCloudflare(page, 25);
    await page.waitForTimeout(2500);
    const dom = await page.evaluate(() => {
      const title = document.querySelector("h1.page-title span, h1.product-name, h1")?.textContent?.trim() || "";
      const body = document.body?.innerText || "";
      const regionBits = [];
      for (const el of document.querySelectorAll(
        ".product.attribute, .product-info-main, .product-details, [class*='region'], [class*='activation'], table.data.table"
      )) {
        const t = el.textContent?.trim();
        if (t && /activ|region|latam|argentin|country|global|worldwide/i.test(t)) regionBits.push(t);
      }
      const activationText = [title, regionBits.join(" "), body.slice(0, 12000)].join("\n");
      const soldOut = /\bsold out\b|\bout of stock\b|\bagotado\b/i.test(body);
      const priceBox =
        document.querySelector(".product-info-main [data-raw-price]") ||
        document.querySelector(".product-info-price [data-raw-price]") ||
        document.querySelector("[data-raw-price]");
      const raw = priceBox?.getAttribute("data-raw-price") || "";
      const addBtn = document.querySelector("#product-addtocart-button, button.tocart");
      const btnOk = addBtn && !addBtn.disabled && !/stock|unavailable|sold/i.test(addBtn.textContent || "");
      const available = /\bdisponible\b|\bañadir al carrito\b|\bcomprar ahora\b/i.test(body);
      return { title, body, activationText, soldOut, raw, btnOk, available, hasAddBtn: Boolean(addBtn) };
    });
    const priced = loadedPriceArsFromBody(dom.body, rates, dom.raw);
    const priceArs = priced?.priceArs || null;
    const inStock =
      !dom.soldOut && priceArs && priceArs >= 3000 && (dom.btnOk || dom.available || !dom.hasAddBtn);
    return {
      inStock,
      priceArs: inStock ? priceArs : null,
      name: dom.title,
      activationText: dom.activationText,
      source: priced?.source || "page_usd",
    };
  });
}

async function getLoadedQuotes(item, rates, options) {
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
    let hits = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        hits = (await searchLoadedBrowser(q, attempt)) || [];
        if (hits.length) break;
      } catch (_) {}
    }
    for (const hit of hits) {
      const c = hitToCandidate(hit);
      if (c) add(c);
    }
  }

  const filtered = filterCandidates(item, candidates);
  return filtered;
}

module.exports = { getLoadedQuotes, searchLoadedBrowser, parseLoadedSlug, verifyLoadedProduct };