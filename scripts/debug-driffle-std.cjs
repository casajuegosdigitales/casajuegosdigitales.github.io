"use strict";
const { withPage, waitCloudflare, closeBrowser } = require("./lib/browser-supply.cjs");
const { parseDrifflePublicUsdFromPage } = require("./lib/driffle-supply.cjs");
const fx = require("./lib/fx-ars.cjs");
(async () => {
  const tests = [
    ["cd key", "https://driffle.com/es/007-first-light-latam-pc-steam-digital-key-p9995849?currency=USD", { tipo: "CD Key" }],
    ["cuenta std", "https://driffle.com/007-first-light-global-pc-steam-account-p9994206?currency=USD", { tipo: "Cuenta" }],
    ["cuenta deluxe", "https://driffle.com/es/007-first-light-deluxe-edition-global-pc-steam-account-p9995859?currency=USD", { tipo: "Cuenta" }],
  ];
  for (const [label, url, item] of tests) {
    let html, dom;
    await withPage(async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      await waitCloudflare(page, 20);
      await page.waitForTimeout(3500);
      html = await page.content();
      dom = await page.evaluate(() => document.body?.innerText?.slice(0, 12000) || "");
    }, { cookies: [{ name: "currency", value: "USD", domain: ".driffle.com", path: "/" }] });
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    const pageProps = m ? JSON.parse(m[1])?.props?.pageProps : null;
    const usd = parseDrifflePublicUsdFromPage(html, dom, item, pageProps);
    console.log(label, "usd", usd, "ars", usd ? Math.round(usd*1571) : null, "anchored", fx.collectAnchoredPublicUsd(dom));
  }
  await closeBrowser();
})().catch((e) => { console.error(e); process.exit(1); });