"use strict";
(async () => {
  const urls = [
    ["std", "https://driffle.com/007-first-light-global-pc-steam-account-p9994206"],
    ["deluxe", "https://driffle.com/es/007-first-light-deluxe-edition-global-pc-steam-account-p9995859"],
  ];
  for (const [label, url] of urls) {
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "currency=USD", {
      headers: { "User-Agent": "Mozilla/5.0 Chrome/120", Cookie: "currency=USD; selectedCurrency=USD" },
    });
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    const pp = m ? JSON.parse(m[1])?.props?.pageProps : null;
    const product = pp?.product || {};
    const offers = pp?.offers || pp?.sellerOffers || pp?.productOffers || [];
    console.log("\n===", label, "===");
    console.log("title:", product.title);
    console.log("product.price:", product.price, "mrp:", product.mrp, "minPrice:", product.minPrice, "lowestPrice:", product.lowestPrice);
    console.log("keys:", Object.keys(product).filter(k => /price|offer|amount|usd/i.test(k)).join(", "));
    if (Array.isArray(offers) && offers.length) {
      console.log("offers count:", offers.length, "sample:", JSON.stringify(offers.slice(0,3)).slice(0,500));
    }
    const agg = [...html.matchAll(/"priceCurrency"\s*:\s*"USD"[\s\S]{0,200}?"lowPrice"\s*:\s*"([\d.]+)"/gi)].map(x=>x[1]);
    console.log("jsonld usd low:", [...new Set(agg)].sort());
    const anchored = html.match(/starting at\s+US\$\s*([\d.]+)/i);
    console.log("starting at:", anchored?.[1]);
  }
})();