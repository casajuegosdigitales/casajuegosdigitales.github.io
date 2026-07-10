"use strict";

const { applyGroupPricing, mergeExcelSteamPrices, isProfitableVenta, priceFloor } = require("./pricing.cjs");
const { findCatalogVersion, ensureCatalogVersion, finalizeCatalogGames } = require("./catalog-io.cjs");
const { platformFromItem, isSteamItem, isPublishableAltPlatform, hasValidPublishedSupply } = require("./match-product.cjs");

function applyVentaToItem(item, result) {
  item.ventaPublicada = result.venta;
  item.cuotasPublicada = result.cuotas;
  item.hidden = false;
}

function syncVersionPrices(version, item, result) {
  version.hidden = false;
  version.priceTransfer = result.venta;
  version.basePrice = result.cuotas;
  if (Number(item.precioSteamArs) > 0) {
    version.steamPriceArs = Number(item.precioSteamArs);
  }
}

function applyPricingToCatalog(data, catalog, excelByFullName) {
  const items = data.items || [];
  mergeExcelSteamPrices(items, excelByFullName);

  for (const item of items) {
    item._oldCompra = item.compraArs;
  }

  const results = applyGroupPricing(items);
  let visible = 0;
  let hidden = 0;
  let catalogAdded = 0;
  const log = [];

  for (const item of items) {
    const result = results.get(item);
    if (!result) continue;

    if (item.supplyVerified === false || !hasValidPublishedSupply(item)) {
      item.hiddenReason = item.hiddenReason || "sin_compra_verificada";
      item.ventaPublicada = 0;
      item.cuotasPublicada = 0;
      item.hidden = true;
      const match = findCatalogVersion(catalog, item);
      if (match.version) {
        match.version.hidden = true;
        hidden++;
      }
      log.push(
        `${item.fullName} | OCULTO sin compra | ${isSteamItem(item) ? "Steam" : platformFromItem(item)}`
      );
      continue;
    }

    item.hiddenReason = result.reason || "";

    const compra = Number(item.compraArs) || 0;
    if (!isProfitableVenta(compra, result.venta)) {
      item.hidden = true;
      item.hiddenReason = "venta_bajo_compra";
      item.ventaPublicada = 0;
      item.cuotasPublicada = 0;
      const match = findCatalogVersion(catalog, item);
      if (match.version) match.version.hidden = true;
      hidden++;
      log.push(`${item.fullName} | OCULTO venta_bajo_compra | compra ${compra} venta ${result.venta}`);
      continue;
    }

    if (result.hidden) {
      item.hidden = true;
      const match = findCatalogVersion(catalog, item);
      if (match.version) match.version.hidden = true;
      hidden++;
      log.push(`${item.fullName} | OCULTO | ${result.reason}`);
      continue;
    }

    applyVentaToItem(item, result);

    let match = findCatalogVersion(catalog, item);
    if (!match.version) {
      const ensured = ensureCatalogVersion(catalog, item);
      if (ensured.created || ensured.gameCreated) catalogAdded++;
      match = ensured;
    }

    if (match.version) {
      if (!isPublishableAltPlatform(item)) {
        match.version.hidden = true;
        item.hidden = true;
        hidden++;
        log.push(`${item.fullName} | OCULTO alt sin verificar | ${platformFromItem(item)}`);
      } else {
        syncVersionPrices(match.version, item, result);
        visible++;
        if (result.reason === "compra_alta") {
          log.push(`${item.fullName} | PUBLICADO compra_alta | venta ${result.venta}`);
        }
      }
    } else {
      visible++;
      log.push(`${item.fullName} | PUBLICADO sin catalog | venta ${result.venta}`);
    }
  }

  for (const game of catalog) {
    game.versions = (game.versions || []).filter((v) => !v.hidden);
    const vis = game.versions;
    game.hidden = vis.length === 0;
  }
  finalizeCatalogGames(catalog);

  return { visible, hidden, catalogAdded, log };
}

module.exports = { applyPricingToCatalog };
