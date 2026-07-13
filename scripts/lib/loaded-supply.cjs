"use strict";

const { buildSearchQueries, buildExpandedSearchQueries, filterCandidates, regionOk, isSubscriptionListing } = require("./match-product.cjs");
const { parseLoadedRawPrice } = require("./fx-ars.cjs");
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

async function verifyLoadedProduct(link) {
  return withPage(async (page) => {
    await page.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitCloudflare(page, 25);
    await page.waitForTimeout(2500);
    const html = await page.content();
    return page.evaluate((pageHtml) => {
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
      const raw = priceBox?.getAttribute("data-raw-price");
      let priceArs = null;
      if (raw) {
        const n = Number(String(raw).replace(/,/g, ""));
        if (n > 0) priceArs = Math.round(n);
      }
      if (!priceArs) {
        const init = pageHtml.match(/initialFinalPrice\s*:\s*([\d.]+)/);
        if (init) {
          const n = Number(init[1]);
          if (n >= 3000) priceArs = Math.round(n);
        }
      }
      if (!priceArs) {
        const prices = [];
        for (const m of body.matchAll(/([\d]{1,3}(?:\.\d{3})*,\d{2}|[\d]{4,7}(?:[.,]\d{1,2})?)\s*AR\$/gi)) {
          const rawPrice = String(m[1]).replace(/\./g, "").replace(",", ".");
          const n = Number(rawPrice);
          if (n >= 3000 && n < 5000000) prices.push(Math.round(n));
        }
        if (prices.length) priceArs = Math.min(...prices);
      }
      const addBtn = document.querySelector("#product-addtocart-button, button.tocart");
      const btnOk = addBtn && !addBtn.disabled && !/stock|unavailable|sold/i.test(addBtn.textContent || "");
      const available = /\bdisponible\b|\bañadir al carrito\b|\bcomprar ahora\b/i.test(body);
      const inStock = !soldOut && priceArs >= 3000 && (btnOk || available || !addBtn);
      return { inStock, priceArs: inStock ? priceArs : null, name: title, activationText };
    }, html);
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