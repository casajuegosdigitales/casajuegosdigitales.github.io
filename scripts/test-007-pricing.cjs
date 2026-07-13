"use strict";
const { getRates } = require("./lib/kinguin-api.cjs");
const { getFxRates, clearFxCache } = require("./lib/fx-rates.cjs");
const { getBestFromExcelLinks } = require("./lib/supply-orchestrator.cjs");
const { closeBrowser } = require("./lib/browser-supply.cjs");
const ITEM = {
  game: "007 First Light",
  edition: "Edicion estandar",
  deliveryType: "cdkey",
  linkKinguin: "https://www.kinguin.net/es/category/534950/007-first-light-latam-pc-steam-cd-key",
  linkEneba: "https://www.eneba.com/latam/steam-007-first-light-steam-key-pc-latam",
  linkDriffle: "https://www.driffle.com/es/007-first-light-latam-pc-steam-digital-key-p9995849",
  linkLoaded: "https://www.loaded.com/es_es/007-first-light-pc-latin-america-steam",
};
(async () => {
  clearFxCache();
  const rates = { ...(await getRates()), ...(await getFxRates({})) };
  console.log("CriptoYa:", rates.dolarDigitalVenta);
  const picked = await getBestFromExcelLinks(ITEM, rates);
  for (const q of picked.quotes || []) console.log(q.store, q.priceArs, q.linkVerified ? "(linkVerified)" : "");
  console.log("Ganador:", picked.best?.store, picked.best?.priceArs);
  await closeBrowser();
})().catch((e) => { console.error(e); process.exit(1); });