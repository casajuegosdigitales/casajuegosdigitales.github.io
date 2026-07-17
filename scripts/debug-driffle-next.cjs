"use strict";
const { withPage, waitCloudflare } = require("./lib/browser-supply.cjs");
const DRIFFLE_USD_COOKIES = [
  { name: "currency", value: "USD", domain: ".driffle.com", path: "/" },
  { name: "selectedCurrency", value: "USD", domain: ".driffle.com", path: "/" },
];
(async () => {
  const url = "https://driffle.com/es/007-first-light-deluxe-edition-global-pc-steam-account-p9995859?currency=USD";
  await withPage(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitCloudflare(page, 20);
    await page.waitForTimeout(4000);
    const data = await page.evaluate(() => {
      const nd = JSON.parse(document.querySelector("#__NEXT_DATA__").textContent);
      const pp = nd?.props?.pageProps || {};
      const pick = (o) => o ? JSON.stringify(o, (k,v) => typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? v : undefined).slice(0,800) : null;
      return {
        slug: pp.slug,
        product: pp.product,
        primarySeller: pp.primarySeller,
        lowestOfferSeller: pp.lowestOfferSeller,
        mcPdpData: pp.mcPdpData,
        externalDiscountedPriceBase: pp.externalDiscountedPriceBase,
      };
    });
    console.log(JSON.stringify(data, null, 2));
  }, { cookies: DRIFFLE_USD_COOKIES });
})();