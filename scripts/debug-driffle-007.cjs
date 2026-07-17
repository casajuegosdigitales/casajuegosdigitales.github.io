"use strict";
const { getFxRates } = require("./lib/fx-rates.cjs");
const { verifyDriffleProductPage } = require("./lib/driffle-supply.cjs");

(async () => {
  const rates = await getFxRates();
  const std = { tipo: "Cuenta", fullName: "007 std cuenta" };
  const dlx = { tipo: "Cuenta", fullName: "007 deluxe cuenta" };
  const urls = [
    ["std", "https://driffle.com/007-first-light-global-pc-steam-account-p9994206", std],
    ["deluxe", "https://driffle.com/es/007-first-light-deluxe-edition-global-pc-steam-account-p9995859", dlx],
  ];
  for (const [label, url, item] of urls) {
    const page = await verifyDriffleProductPage(url, rates, item);
    console.log(label, JSON.stringify({ priceArs: page?.priceArs, name: page?.name, source: page?.source, inStock: page?.inStock }));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });