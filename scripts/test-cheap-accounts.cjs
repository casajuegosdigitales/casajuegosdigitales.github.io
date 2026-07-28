"use strict";
const { getRates } = require("./lib/kinguin-api.cjs");
const { getFxRates, clearFxCache } = require("./lib/fx-rates.cjs");
const { getBestFromExcelLinks } = require("./lib/supply-orchestrator.cjs");
const { closeBrowser } = require("./lib/browser-supply.cjs");

const BF6 = {
  game: "Battlefield 6",
  edition: "Edicion estandar",
  tipo: "Cuenta",
  deliveryType: "account",
  precioSteamArs: 127879,
  linkDriffle: "https://driffle.com/es/battlefield-6-global-pc-steam-account-p9952012",
  linkKinguin: "https://www.kinguin.net/es/category/371748/battlefield-6-pc-steam-account",
};

const FC26 = {
  game: "EA SPORTS FC 26",
  edition: "Edicion estandar",
  tipo: "Cuenta",
  deliveryType: "account",
  precioSteamArs: 127879,
  linkDriffle: "https://driffle.com/es/ea-sports-fc-26-global-pc-steam-account-p9952463",
  linkKinguin: "https://www.kinguin.net/es/category/365634/ea-sports-fc-26-pc-steam-account",
};

(async () => {
  clearFxCache();
  const rates = { ...(await getRates()), ...(await getFxRates({})) };
  console.log("CriptoYa:", rates.dolarDigitalVenta);
  for (const item of [BF6, FC26]) {
    const picked = await getBestFromExcelLinks(item, rates);
    console.log(item.game, "ganador:", picked.best?.store, picked.best?.priceArs);
  }
  await closeBrowser();
})().catch((e) => { console.error(e); process.exit(1); });