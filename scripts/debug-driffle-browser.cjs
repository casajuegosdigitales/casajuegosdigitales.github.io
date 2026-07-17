"use strict";
const { withPage, waitCloudflare } = require("./lib/browser-supply.cjs");
const DRIFFLE_USD_COOKIES = [
  { name: "currency", value: "USD", domain: ".driffle.com", path: "/" },
  { name: "selectedCurrency", value: "USD", domain: ".driffle.com", path: "/" },
];

(async () => {
  const urls = [
    ["std", "https://driffle.com/007-first-light-global-pc-steam-account-p9994206?currency=USD"],
    ["deluxe", "https://driffle.com/es/007-first-light-deluxe-edition-global-pc-steam-account-p9995859?currency=USD"],
  ];
  await withPage(async (page) => {
    for (const [label, url] of urls) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      await waitCloudflare(page, 20);
      await page.waitForTimeout(4000);
      const data = await page.evaluate(() => {
        const nd = document.querySelector("#__NEXT_DATA__")?.textContent;
        let product = null;
        let pageProps = null;
        if (nd) {
          try {
            pageProps = JSON.parse(nd)?.props?.pageProps;
            product = pageProps?.product || null;
          } catch (e) {}
        }
        const body = document.body?.innerText || "";
        const priceLines = body.split("\n").filter(l => /\$|US\$|USD|starting|partir|oferta/i.test(l)).slice(0, 40);
        return {
          title: document.querySelector("h1")?.textContent?.trim(),
          product: product ? {
            title: product.title,
            price: product.price,
            mrp: product.mrp,
            minPrice: product.minPrice,
            lowestPrice: product.lowestPrice,
            slug: product.slug,
            keys: Object.keys(product).filter(k => /price|offer|seller|amount/i.test(k)),
          } : null,
          pagePropsKeys: pageProps ? Object.keys(pageProps) : [],
          offerKeys: pageProps ? Object.keys(pageProps).filter(k => /offer/i.test(k)) : [],
          priceLines,
        };
      });
      console.log("\n===", label, "===");
      console.log(JSON.stringify(data, null, 2));
    }
  }, { cookies: DRIFFLE_USD_COOKIES });
})();