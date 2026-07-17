"use strict";
const { getFxRates } = require("./lib/fx-rates.cjs");
const { getBestFromExcelLinks } = require("./lib/supply-orchestrator.cjs");
const { closeBrowser } = require("./lib/browser-supply.cjs");
const { applyGroupPricing, cuotasFromVenta } = require("./lib/pricing.cjs");

const VARIANTS = [
  { label: "CD Key estandar", item: { game: "007 First Light", edition: "Edicion estandar", tipo: "CD Key", variant: "Edicion estandar - CD Key LATAM (Steam)", fullName: "007 First Light | Edicion estandar | CD Key", linkKinguin: "https://www.kinguin.net/es/category/534950/007-first-light-latam-pc-steam-cd-key", linkEneba: "https://www.eneba.com/latam/steam-007-first-light-steam-key-pc-latam", linkDriffle: "https://driffle.com/es/007-first-light-latam-pc-steam-digital-key-p9995849", linkLoaded: "https://www.loaded.com/es_es/007-first-light-pc-latin-america-steam", precioSteamArs: 73066 } },
  { label: "Deluxe CD Key", item: { game: "007 First Light", edition: "Edicion Deluxe", tipo: "CD Key", variant: "Edicion Deluxe - CD Key LATAM (Steam)", fullName: "007 First Light | Edicion Deluxe | CD Key", linkKinguin: "https://www.kinguin.net/es/category/537471/007-first-light-deluxe-edition-latam-pc-steam-cd-key", linkEneba: "https://www.eneba.com/latam/steam-007-first-light-deluxe-edition-steam-key-pc-latam", linkDriffle: "https://driffle.com/es/007-first-light-deluxe-edition-latam-pc-steam-digital-key-p9995852", linkLoaded: "https://www.loaded.com/es_es/007-first-light-deluxe-edition-pc-steam", precioSteamArs: 84028 } },
  { label: "Cuenta estandar", item: { game: "007 First Light", edition: "Edicion estandar", tipo: "Cuenta", variant: "Edicion estandar - Cuenta Steam", fullName: "007 First Light | Edicion estandar | Cuenta", linkKinguin: "https://www.kinguin.net/es/category/404893/007-first-light-pc-steam-account", linkEneba: "", linkDriffle: "https://driffle.com/007-first-light-global-pc-steam-account-p9994206", linkLoaded: "", precioSteamArs: 73066 } },
  { label: "Deluxe Cuenta", item: { game: "007 First Light", edition: "Deluxe Edition", tipo: "Cuenta", variant: "Deluxe Edition - Cuenta Steam", fullName: "007 First Light | Deluxe Edition | Cuenta", linkKinguin: "https://www.kinguin.net/es/category/535348/007-first-light-deluxe-edition-pc-steam-account", linkEneba: "", linkDriffle: "https://driffle.com/es/007-first-light-deluxe-edition-global-pc-steam-account-p9995859", linkLoaded: "", precioSteamArs: 84028 } },
];

(async () => {
  process.env.ENABLE_BROWSER_SUPPLY = "1";
  const rates = { ...(await getFxRates()), ...(await require("./lib/fx-rates.cjs").getFxRates?.()) };
  const fx = await require("./lib/fx-rates.cjs").getFxRates();
  Object.assign(rates, fx);
  console.log("CriptoYa:", rates.dolarDigitalVenta);
  for (const { label, item } of VARIANTS) {
    console.log("===", label, "===");
    const picked = await getBestFromExcelLinks(item, rates);
    for (const q of (picked.quotes || []).sort((a, b) => a.priceArs - b.priceArs)) {
      console.log(" ", q.store, q.priceArs, q.source);
    }
    if (picked.best) {
      item.compraArs = picked.best.priceArs;
      const result = applyGroupPricing([item]).get(item);
      console.log("Ganador:", picked.best.store, picked.best.priceArs, "venta", result?.venta, picked.best.source);
    } else {
      console.log("SIN PRECIO");
    }
  }
  await closeBrowser();
})().catch((e) => { console.error(e); process.exit(1); });