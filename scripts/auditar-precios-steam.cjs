"use strict";

const fs = require("fs");
const path = require("path");
const { getFxRates, fetchSteamPriceBreakdown } = require("./lib/fx-rates.cjs");
const { sleep } = require("./lib/kinguin-api.cjs");

const SITE_DIR = path.join(__dirname, "..");
const DATA_PATH = path.join(SITE_DIR, "kinguin-price-data.json");

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const fx = await getFxRates(data.lastFxRates || {});
  const byApp = new Map();
  const rows = [];

  for (const item of data.items || []) {
    if (!item.linkSteam) continue;
    const appId = String(item.linkSteam).match(/\/app\/(\d+)/)?.[1];
    if (!appId) continue;
    if (!byApp.has(appId)) {
      const b = await fetchSteamPriceBreakdown(item.linkSteam, fx);
      byApp.set(appId, b);
      await sleep(200);
    }
    const b = byApp.get(appId);
    const stored = Number(item.precioSteamArs) || 0;
    const listArs = b?.listArs || 0;
    const saleArs = b?.saleArs || 0;
    const diffList = listArs - stored;
    if (Math.abs(diffList) >= 500) {
      rows.push({
        game: item.game,
        variant: item.variant,
        stored,
        listArs,
        saleArs,
        listUsd: b?.listUsd,
        saleUsd: b?.saleUsd,
        diffList,
      });
    }
  }

  const unique = new Map();
  for (const r of rows) {
    const k = r.game + "|" + r.listArs;
    if (!unique.has(k)) unique.set(k, r);
  }

  console.log("Dolar steamcito:", fx.steamMetodoNormal);
  console.log("Variantes con diferencia >= 500 ARS (lista vs guardado):", rows.length);
  console.log("Juegos unicos afectados:", unique.size, "\n");
  [...unique.values()]
    .sort((a, b) => Math.abs(b.diffList) - Math.abs(a.diffList))
    .slice(0, 25)
    .forEach((r) => {
      console.log(
        r.game +
          " | guardado " + r.stored +
          " | lista " + r.listArs + " (USD " + r.listUsd + ")" +
          " | oferta " + r.saleArs + " (USD " + r.saleUsd + ")" +
          " | diff +" + r.diffList
      );
    });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
