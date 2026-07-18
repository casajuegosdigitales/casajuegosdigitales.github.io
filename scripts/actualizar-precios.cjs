"use strict";

const fs = require("fs");
const path = require("path");
const { getRates, getRatesWithFallback, sleep } = require("./lib/kinguin-api.cjs");
const { priceChanged, MIN_PROFIT_ARS, MAX_PROFIT_ARS, CUOTAS_FACTOR } = require("./lib/pricing.cjs");
const { loadCatalog, saveCatalog, propagateSteamLinks, syncSteamMetadata } = require("./lib/catalog-io.cjs");
const { loadExcelProducts, DEFAULT_XL, writeGamesListAutoExcel } = require("./lib/excel-io.cjs");
const { applyPricingToCatalog } = require("./lib/apply-catalog-pricing.cjs");
const { getBestSupplyQuote, applyBestToItem, reapplyBestFromStoredQuotes, fetchItemSupply, reselectBestAvoidingBrokenLinks, getBestFromExcelLinks } = require("./lib/supply-orchestrator.cjs");
const { resolveKinguinOfferLink, kinguinCategoryBaseUrl } = require("./lib/kinguin-supply.cjs");
const { isPlaceholderKinguinLink, parseKinguinOfferId } = require("./lib/kinguin-api.cjs");
const {
  deliveryTypeFromItem,
  platformFromItem,
  discoverMissingVariants,
  editionBase,
  listingMatchesItem,
  hasSteamEditionSibling,
  purgeRedundantAltPlatforms,
  pruneCatalogForSteamFirst,
  isSteamItem,
  sanitizeInvalidSupplyItems,
  hasValidPublishedSupply,
  isSteamGiftOffer,
} = require("./lib/match-product.cjs");
const { getFxRates, fetchSteamAppPricingDetails, resolveSteamPriceArsForEdition, STEAM_EDITION_BUNDLE_ADDONS, bundleEditionKey } = require("./lib/fx-rates.cjs");
const { editionKey } = require("./lib/pricing.cjs");
const { writeLocalManifest, writeGuiaCompras, writeListaComprasExcel } = require("./lib/manifest-local.cjs");

const SITE_DIR = path.join(__dirname, "..");
const DATA_PATH = path.join(SITE_DIR, "kinguin-price-data.json");
const CATALOG_PATH = path.join(SITE_DIR, "js", "catalog.js");
const LOG_PATH = path.join(SITE_DIR, "ultima-actualizacion-precios.log");
const XL_PATH = process.env.GAMES_EXCEL || DEFAULT_XL;
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_FETCH = process.argv.includes("--skip-fetch");
const REAPPLY_FILTERS = process.argv.includes("--reapply-filters");
const REFETCH_MISSING = process.argv.includes("--refetch-missing");
const REPAIR_KINGUIN = process.argv.includes("--repair-kinguin");
const GUIA_ONLY = process.argv.includes("--guia-only");
const LINKS_ONLY = process.argv.includes("--links-only");
const SAVE_EVERY = Number(process.env.SAVE_EVERY_N || 10);
const DELAY_MS = Number(process.env.SUPPLY_DELAY_MS || process.env.KINGUIN_DELAY_MS || 150);
const IS_CI = Boolean(process.env.GITHUB_ACTIONS);

function autoExcelWriteTargets(excelPath) {
  const targets = [path.join(SITE_DIR, "GAMES LIST - AUTO.xlsx"), excelPath];
  if (!IS_CI && process.env.USERPROFILE) {
    targets.push(path.join(process.env.USERPROFILE, "Desktop", "GAMES LIST - AUTO.xlsx"));
  }
  return [...new Set(targets.filter(Boolean))];
}

function autoExcelSourcePath(excelPath) {
  const desktop = path.join(process.env.USERPROFILE || "", "Desktop", "GAMES LIST - AUTO.xlsx");
  if (!IS_CI && fs.existsSync(desktop)) return desktop;
  if (excelPath && fs.existsSync(excelPath)) return excelPath;
  return path.join(SITE_DIR, "GAMES LIST - AUTO.xlsx");
}

function variantGroupKey(item) {
  return `${item.game}|${editionBase(item.variant)}|${platformFromItem(item)}`;
}

function loadData() {
  if (!fs.existsSync(DATA_PATH)) throw new Error("No existe kinguin-price-data.json");
  let raw = fs.readFileSync(DATA_PATH, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

function saveData(data) {
  data.updatedAt = new Date().toISOString();
  data.lastPriceSync = data.updatedAt;
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
}

function winnerListado(item) {
  if (item.bestListado) return item.bestListado;
  const q = (item.supplyQuotes || []).find(
    (row) => row.store === item.bestStore && row.link === item.bestLink
  );
  return q?.name || "";
}

function hasBrokenWinnerLink(item) {
  if (!item.bestStore || !item.bestLink) return true;
  if (!hasValidPublishedSupply(item)) return true;
  return false;
}

async function repairKinguinPlaceholderLinks(data, rates) {
  const targets = data.items.filter(
    (item) => item.bestStore === "kinguin" && isPlaceholderKinguinLink(item.bestLink)
  );
  if (!targets.length) return { fixed: 0, refetched: 0, pending: 0 };

  console.log("=== Reparando links Kinguin rotos (" + targets.length + ") ===\n");
  let fixed = 0;
  let refetched = 0;
  let pending = 0;

  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    const label = item.fullName || item.game + " / " + item.variant;
    process.stdout.write("[" + (i + 1) + "/" + targets.length + "] " + label + " ... ");

    if (reselectBestAvoidingBrokenLinks(item)) {
      fixed++;
      console.log("alternativa", item.bestStore, item.compraArs);
      saveData(data);
      continue;
    }

    const res = await fetchOneItem(item, rates, [], label, { forceFullSearch: true });
    if (res.ok && !hasBrokenWinnerLink(item)) {
      refetched++;
      console.log("refetch", item.bestStore, item.compraArs);
      saveData(data);
      await sleep(DELAY_MS);
      continue;
    }

    const oid = parseKinguinOfferId(item.bestLink);
    const resolved = oid ? await resolveKinguinOfferLink(item, oid) : "";
    if (resolved) {
      item.bestStore = "kinguin";
      item.bestLink = resolved;
      item.linkKinguin = resolved;
      item.compraArs = item.compraArs || 0;
      item.supplyVerified = true;
      for (const q of item.supplyQuotes || []) {
        if (q.store === "kinguin" && parseKinguinOfferId(q.link) === oid) q.link = resolved;
      }
      fixed++;
      console.log("kinguin resuelto", item.compraArs);
      saveData(data);
      await sleep(DELAY_MS);
      continue;
    }

    pending++;
    console.log("PENDIENTE");
    saveData(data);
    await sleep(DELAY_MS);
  }

  return { fixed, refetched, pending };
}

function needsKinguinLinkRecheck(item) {
  const lk = item.linkKinguin || "";
  if (isPlaceholderKinguinLink(lk) || !kinguinCategoryBaseUrl(lk)) return false;
  const savedOid = parseKinguinOfferId(lk);
  if (!savedOid) return false;
  if (item.bestStore === "kinguin" && parseKinguinOfferId(item.bestLink || "") === savedOid) return false;
  return true;
}

function needsRefetch(item, items) {
  if (hasSteamEditionSibling(item, items)) return false;
  if (needsKinguinLinkRecheck(item)) return true;
  if (item.supplyVerified === false) return true;
  if (!item.bestStore) return true;
  if (hasBrokenWinnerLink(item)) return true;
  const quotes = item.supplyQuotes || [];
  if (!quotes.length) return true;
  if (quotes.length && quotes.every((q) => q.store === "loaded" && q.source === "search")) return true;
  return false;
}

function refetchPriority(a, b) {
  const steamA = isSteamItem(a) ? 0 : 1;
  const steamB = isSteamItem(b) ? 0 : 1;
  if (steamA !== steamB) return steamA - steamB;
  const brokenA = hasBrokenWinnerLink(a) ? 0 : 1;
  const brokenB = hasBrokenWinnerLink(b) ? 0 : 1;
  if (brokenA !== brokenB) return brokenA - brokenB;
  return String(a.fullName || "").localeCompare(String(b.fullName || ""), "es", { sensitivity: "base" });
}

function itemFromExcelRow(row) {
  return {
    game: row.game || "",
    edition: row.edition || "Edicion estandar",
    tipo: row.tipo || "",
    variant: row.variant || "",
    fullName: row.fullName || "",
    excelKey: row.excelKey || `${row.game}|${row.edition}|${row.tipo}`,
    latam: row.latam != null ? row.latam : /latam/i.test(
      [row.linkKinguin, row.linkEneba, row.linkDriffle, row.linkLoaded].filter(Boolean).join(" ")
    ),
    linkKinguin: row.linkKinguin || "",
    linkEneba: row.linkEneba || "",
    linkDriffle: row.linkDriffle || "",
    linkLoaded: row.linkLoaded || "",
    linkSteam: row.linkSteam || "",
    precioSteamArs: row.precioSteam || 0,
    excelVenta: row.venta || 0,
    compraArs: 0,
    ventaPublicada: 0,
    cuotasPublicada: 0,
    hidden: false,
    supplyVerified: false,
    supplyQuotes: [],
  };
}

function hasExcelSupplyLinks(item) {
  return [item.linkKinguin, item.linkEneba, item.linkDriffle, item.linkLoaded].some((link) =>
    /^https?:\/\//i.test(String(link || "").trim())
  );
}

function supplyLinksKey(item) {
  return [item.linkKinguin, item.linkEneba, item.linkDriffle, item.linkLoaded]
    .map((link) => String(link || "").trim())
    .join("|");
}

function supplyLinksMatch(a, b) {
  return supplyLinksKey(a) === supplyLinksKey(b);
}

function snapshotSupplyFields(items) {
  return (items || []).map((item) => ({
    excelKey: item.excelKey || `${item.game}|${item.edition || ""}|${item.tipo || ""}`,
    game: item.game,
    edition: item.edition,
    tipo: item.tipo,
    variant: item.variant,
    linkKinguin: item.linkKinguin,
    linkEneba: item.linkEneba,
    linkDriffle: item.linkDriffle,
    linkLoaded: item.linkLoaded,
    compraArs: item.compraArs,
    ventaPublicada: item.ventaPublicada,
    cuotasPublicada: item.cuotasPublicada,
    bestStore: item.bestStore,
    bestLink: item.bestLink,
    supplyVerified: item.supplyVerified,
    supplyQuotes: item.supplyQuotes,
    hidden: item.hidden,
    hiddenReason: item.hiddenReason,
  }));
}

function copySupplyFields(target, source) {
  target.compraArs = source.compraArs;
  target.ventaPublicada = source.ventaPublicada;
  target.cuotasPublicada = source.cuotasPublicada;
  target.bestStore = source.bestStore;
  target.bestLink = source.bestLink;
  target.supplyVerified = source.supplyVerified !== false;
  target.supplyQuotes = source.supplyQuotes ? [...source.supplyQuotes] : [];
  target.hidden = false;
  target.hiddenReason = "";
}

function restoreStaleSupply(items, prevSnapshot) {
  const prevByKey = new Map((prevSnapshot || []).map((p) => [p.excelKey, p]));
  let restored = 0;
  for (const item of items) {
    if (item.hiddenReason === "sin_links_excel") continue;
    if (hasValidPublishedSupply(item)) continue;
    const prev = prevByKey.get(item.excelKey);
    if (!prev || !prev.bestStore || (prev.compraArs || 0) <= 0) continue;
    if (!supplyLinksMatch(item, prev)) continue;
    copySupplyFields(item, prev);
    item._staleSupply = true;
    restored++;
  }
  return restored;
}

function syncItemsFromExcel(data, excel, prevSnapshot) {
  const prevByKey = new Map((prevSnapshot || []).map((p) => [p.excelKey, p]));
  const items = [];
  for (const row of excel.rows) {
    if (!row.game || !row.tipo) continue;
    const item = itemFromExcelRow(row);
    const prev = prevByKey.get(item.excelKey);
    if (prev && supplyLinksMatch(item, prev) && prev.bestStore && (prev.compraArs || 0) > 0) {
      copySupplyFields(item, prev);
    }
    items.push(item);
  }
  data.items = items;
  return items.length;
}

async function refreshAllSteamPrices(items, fx) {
  const appLinks = new Map();
  for (const item of items) {
    if (!item.linkSteam) continue;
    const appId = String(item.linkSteam).match(/\/app\/(\d+)/)?.[1];
    if (!appId) continue;
    if (!appLinks.has(appId)) appLinks.set(appId, item.linkSteam);
    const addonIds = STEAM_EDITION_BUNDLE_ADDONS[bundleEditionKey(item.game, item.edition)];
    if (addonIds) {
      for (const addonId of addonIds) {
        const id = String(addonId);
        if (!appLinks.has(id)) {
          appLinks.set(id, "https://store.steampowered.com/app/" + id + "/");
        }
      }
    }
  }
  const byApp = new Map();
  const oldByItem = new Map();
  for (const item of items) {
    if (!item.linkSteam) continue;
    const key = item.fullName || item.variant || item.game;
    oldByItem.set(key, Number(item.precioSteamArs) || 0);
  }
  const entries = [...appLinks.entries()];
  const delayMs = Number(process.env.STEAM_PRICE_DELAY_MS || 1200);

  async function fetchApp(appId, link, label) {
    process.stdout.write(label);
    const pricing = await fetchSteamAppPricingDetails(appId, fx);
    if (pricing) {
      byApp.set(appId, pricing);
      const baseArs = pricing.basePriceCents
        ? Math.round((pricing.basePriceCents / 100) * (Number(fx.steamMetodoNormal) || 0))
        : null;
      console.log(
        (baseArs || "sin precio") +
          " | subs:" +
          (pricing.subs?.length || 0)
      );
      return true;
    }
    console.log("sin precio");
    return false;
  }

  console.log("=== Precios Steam de referencia (USD regional AR/LATAM x steamcito, por edicion) ===");
  console.log("Apps unicas:", entries.length, "| Dolar:", fx.steamMetodoNormal, "ARS/USD\n");

  for (let i = 0; i < entries.length; i++) {
    const [appId, link] = entries[i];
    await fetchApp(appId, link, "  [" + (i + 1) + "/" + entries.length + "] app " + appId + " ... ");
    if (i < entries.length - 1) await sleep(delayMs);
  }

  const missing = entries.filter(([appId]) => !byApp.has(appId));
  if (missing.length) {
    console.log("\nReintento apps sin precio:", missing.length, "(pausa 8s)\n");
    await sleep(8000);
    for (let i = 0; i < missing.length; i++) {
      const [appId, link] = missing[i];
      await fetchApp(appId, link, "  [retry " + (i + 1) + "/" + missing.length + "] app " + appId + " ... ");
      if (i < missing.length - 1) await sleep(delayMs);
    }
  }

  let variants = 0;
  let changed = 0;
  const unmatched = [];

  for (const item of items) {
    if (!item.linkSteam) continue;
    const appId = String(item.linkSteam).match(/\/app\/(\d+)/)?.[1];
    if (!appId || !byApp.has(appId)) continue;
    const edition = item.edition || editionKey(item);
    const result = resolveSteamPriceArsForEdition(edition, byApp.get(appId), fx, {
      game: item.game,
      byApp,
    });
    if (!result.price) continue;
    const key = item.fullName || item.variant || item.game;
    const prev = oldByItem.get(key) || 0;
    item.precioSteamArs = result.price;
    variants++;
    if (prev > 0 && prev !== result.price) changed++;
    if (!result.matched) {
      unmatched.push({
        fullName: item.fullName || item.variant,
        edition,
        note: result.note,
        price: result.price,
      });
    }
  }

  if (unmatched.length) {
    console.log("\nEdiciones sin match exacto (fallback base):", unmatched.length);
    for (const row of unmatched.slice(0, 15)) {
      console.log("  -", row.fullName, "|", row.edition, "->", row.price, "(" + row.note + ")");
    }
    if (unmatched.length > 15) console.log("  ... y", unmatched.length - 15, "mas");
  }
  if (changed) console.log("\nVariantes con precio Steam distinto al anterior:", changed);

  return {
    apps: entries.length,
    priced: byApp.size,
    variants,
    changed,
    unmatched,
    missing: entries.length - byApp.size,
  };
}

async function fetchOneItemLinksOnly(item, rates, fetchLog, label, fx) {
  const oldCompra = item.compraArs || 0;
  item._oldCompra = oldCompra;

  if (!hasExcelSupplyLinks(item)) {
    item.supplyVerified = false;
    item.compraArs = 0;
    item.bestStore = "";
    item.bestLink = "";
    item.supplyQuotes = [];
    item.hidden = true;
    item.hiddenReason = "sin_links_excel";
    fetchLog.push(label + " | sin_links_excel | reservado (sin publicar)");
    return { ok: false, changed: false, attempts: [], noLinks: true, recheck: false };
  }

  const result = await getBestFromExcelLinks(item, rates);
  applyBestToItem(item, result);
  const altCount = (item.supplyQuotes || []).length;
  const changed = priceChanged(oldCompra, item.compraArs);
  fetchLog.push(
    label +
      " | links | " +
      (item.bestStore || "ninguna") +
      " | " +
      (changed ? "compra " + oldCompra + " -> " + item.compraArs : "sin cambio | " + item.compraArs) +
      " (" +
      altCount +
      " cotiz.)"
  );
  item._prevStore = item.bestStore;
  return { ok: true, changed, attempts: [], recheck: false };
}

async function fetchOneItem(item, rates, fetchLog, label, options) {
  const oldCompra = item.compraArs || 0;
  item._oldCompra = oldCompra;
  const res = await fetchItemSupply(item, rates, {
    delayMs: 0,
    forceFullSearch: options?.forceFullSearch,
  });
  if (!res.ok) {
    const stores = res.result?.storeStatus || {};
    fetchLog.push(label + " | PENDIENTE | " + JSON.stringify(stores));
    return { ok: false, pending: true, attempts: res.attempts };
  }
  const altCount = (item.supplyQuotes || []).length;
  const changed = priceChanged(oldCompra, item.compraArs);
  const mode = res.recheck ? "recheck" : "full";
  fetchLog.push(
    label +
      " | " +
      mode +
      " | " +
      (item.bestStore || "ninguna") +
      " | " +
      (changed ? "compra " + oldCompra + " -> " + item.compraArs : "sin cambio | " + item.compraArs) +
      " (" +
      altCount +
      " cotiz.)"
  );
  item._prevStore = item.bestStore;
  return {
    ok: true,
    changed: changed || item.bestStore !== (item._prevStore || ""),
    attempts: res.attempts,
    recheck: Boolean(res.recheck),
  };
}

async function main() {
  if (GUIA_ONLY) {
    const data = loadData();
    for (const item of data.items || []) {
      if (item.supplyVerified === undefined && item.bestStore && (item.compraArs || 0) > 0) {
        item.supplyVerified = true;
      }
      if (item.supplyVerified === undefined && !item.bestStore) {
        item.supplyVerified = false;
      }
    }
    const catalog = loadCatalog(CATALOG_PATH);
    const guia = writeGuiaCompras(data, SITE_DIR);
    console.log("Guia compras (" + guia.count + " filas):", guia.jsonPath);
    console.log("Guia Excel:", guia.xlsxPath);
    console.log("CSV Excel AR:", guia.csvArPath);
    const listaPath =
      process.env.GAMES_LIST_AUTO ||
      path.join(path.dirname(XL_PATH), "GAMES LIST - AUTO.xlsx");
    const lista = writeListaComprasExcel(data, listaPath);
    console.log("Lista compras Excel (" + lista.count + " filas):", lista.path);
    const autoSource = autoExcelSourcePath(XL_PATH);
    for (const autoPath of autoExcelWriteTargets(XL_PATH)) {
      try {
        const auto = writeGamesListAutoExcel(autoPath, data, autoSource);
        if (auto.skipped) {
          console.warn("Lista AUTO no escrita:", autoPath, auto.reason || "");
        } else {
          console.log("Lista AUTO (" + auto.count + " filas):", auto.path);
        }
      } catch (err) {
        console.warn("No se pudo escribir Lista AUTO:", autoPath, err.message);
      }
    }
    const manifest = writeLocalManifest(data, catalog);
    console.log("Manifest privado (" + manifest.count + " filas):", manifest.xlsxPath);
    return;
  }

  console.log(
    DRY_RUN ? "=== DRY RUN ===" : LINKS_ONLY
      ? "=== Actualizando precios (solo links Excel + cotizaciones FX) ==="
      : "=== Actualizando precios (Kinguin + Eneba + Driffle + Loaded) ==="
  );

  if (!fs.existsSync(XL_PATH)) {
    console.warn("AVISO: No se encontro Excel:", XL_PATH);
    console.warn("Se usaran precios Steam guardados en kinguin-price-data.json");
  }

  let excelByFullName;
  let excelPath = XL_PATH;
  let excelLoaded = null;
  if (fs.existsSync(XL_PATH)) {
    excelLoaded = loadExcelProducts(XL_PATH);
    excelByFullName = excelLoaded.byFullName;
    excelPath = excelLoaded.path;
    console.log("Excel:", excelLoaded.path, "| Formato:", excelLoaded.format || "legacy");
    console.log("Filas Excel:", excelLoaded.rows.length);
  } else {
    excelByFullName = null;
    console.warn("AVISO: No se encontro Excel:", XL_PATH);
    console.warn("Se usaran precios Steam guardados en kinguin-price-data.json");
  }

  const data = loadData();
  const prevSupplySnapshot = snapshotSupplyFields(data.items);
  if (LINKS_ONLY && excelLoaded) {
    if (!excelLoaded.rows.length) {
      console.error("ERROR: Excel sin filas validas. No se sobrescribe kinguin-price-data.json.");
      process.exit(1);
    }
    const n = syncItemsFromExcel(data, excelLoaded, prevSupplySnapshot);
    console.log("Catalogo sincronizado desde Excel:", n, "variantes");
  }
  const steamLinksFilled = propagateSteamLinks(data.items || []);
  if (steamLinksFilled) console.log("Links Steam propagados por juego:", steamLinksFilled, "filas");
  for (const item of data.items || []) {
    if (item.supplyVerified === undefined && item.bestStore && (item.compraArs || 0) > 0) {
      item.supplyVerified = true;
    }
    if (item.supplyVerified === undefined && !item.bestStore) {
      item.supplyVerified = false;
    }
  }
  if (!excelByFullName) {
    const { excelMapFromItems } = require("./lib/pricing.cjs");
    excelByFullName = excelMapFromItems(data.items);
    console.log("Precios Steam desde JSON:", excelByFullName.size, "variantes");
  }

  const catalog = loadCatalog(CATALOG_PATH);
  const kinguinRates = SKIP_FETCH
    ? await getRatesWithFallback(data.lastRates)
    : await getRates();
  const fx = SKIP_FETCH
    ? await getFxRates(data.lastFxRates || {})
    : await getFxRates(data.lastFxRates || {});
  const rates = {
    ...kinguinRates,
    dolarDigitalVenta: fx.dolarDigitalVenta,
    dolarDigitalCompra: fx.dolarDigitalCompra,
    steamMetodoNormal: fx.steamMetodoNormal,
  };
  data.lastRates = kinguinRates;
  data.lastFxRates = fx;
  data.sourceExcel = excelPath;

  console.log(
    "FX Steam (metodo normal steamcito):",
    fx.steamMetodoNormal,
    "ARS/USD | Fuente:",
    fx.steamSource
  );
  console.log(
    "FX Tiendas (USDT Binance P2P ask x CriptoYa):",
    fx.dolarDigitalVenta,
    "ARS/USD | Fuente:",
    fx.digitalSource
  );

  const purged = purgeRedundantAltPlatforms(data);
  if (purged) console.log("Variantes alt eliminadas (Steam prioritario):", purged);

  let repaired = null;
  if (REPAIR_KINGUIN || (!SKIP_FETCH && !REFETCH_MISSING && !REAPPLY_FILTERS && !LINKS_ONLY)) {
    const placeholders = data.items.filter(
      (item) => item.bestStore === "kinguin" && isPlaceholderKinguinLink(item.bestLink)
    ).length;
    if (placeholders) {
      for (const item of data.items) {
        if (item.bestStore === "kinguin" && isPlaceholderKinguinLink(item.bestLink)) {
          reselectBestAvoidingBrokenLinks(item);
        }
      }
    }
  }
  if (REPAIR_KINGUIN) {
    repaired = await repairKinguinPlaceholderLinks(data, rates);
    console.log(
      "Links Kinguin reparados:",
      repaired.fixed,
      "| Refetch:",
      repaired.refetched,
      "| Pendientes:",
      repaired.pending,
      "\n"
    );
  }

  console.log("Kinguin EUR→USD (solo conversion API):", rates.usdPerEur, "USD/EUR");
  console.log("Ganancia minima:", MIN_PROFIT_ARS, "| Ganancia maxima:", MAX_PROFIT_ARS, "| Cuotas:", CUOTAS_FACTOR);
  const { STEAM_MULT_ACCOUNT, STEAM_MULT_CODE, CAPTURE_RATE } = require("./lib/pricing.cjs");
  console.log(
    "Precio inteligente: cuenta Steam x" + STEAM_MULT_ACCOUNT +
    ", codigo x" + STEAM_MULT_CODE +
    ", captura " + Math.round(CAPTURE_RATE * 100) + "% del espacio"
  );
  console.log("Variantes:", data.items.length, "\n");

  const sanitized = sanitizeInvalidSupplyItems(data.items);
  if (sanitized) console.log("Listados invalidos limpiados (gift/links rotos):", sanitized, "\n");

  if (excelByFullName) {
    for (const item of data.items) {
      const row = excelByFullName.get(item.fullName);
      if (!row) continue;
      if (row.linkSteam) item.linkSteam = row.linkSteam;
    }
  }

  const fetchLog = [];
  const pendientes = [];
  let updated = 0;
  let unchanged = 0;
  let errors = 0;
  let skippedNoLinks = 0;
  let rechecked = 0;
  const forceFullSearch = REAPPLY_FILTERS || REFETCH_MISSING;

  if (LINKS_ONLY && !SKIP_FETCH) {
    console.log("=== Modo links-only: solo URLs del Excel ===\n");
    const targets = data.items;
    const labelTotal = targets.length;
    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      const label = item.fullName || item.game + " / " + item.variant;
      process.stdout.write("[" + (i + 1) + "/" + labelTotal + "] " + label + " ... ");
      const res = await fetchOneItemLinksOnly(item, rates, fetchLog, label, fx);
      if (res.noLinks) {
        skippedNoLinks++;
        pendientes.push({ fullName: label, reason: "sin_links_excel" });
        console.log("SIN LINK (reservado en Excel, no publicado)");
      } else if (res.changed) {
        updated++;
        console.log(item.bestStore, item.compraArs);
      } else {
        unchanged++;
        const cotiz = (item.supplyQuotes || []).length;
        if ((item.compraArs || 0) <= 0) {
          console.log("SIN PRECIO (" + cotiz + " cotiz.)");
        } else {
          console.log(item.bestStore, item.compraArs, "sin cambio (" + cotiz + " cotiz.)");
        }
      }
      if (!DRY_RUN && (i + 1) % SAVE_EVERY === 0) {
        saveData(data);
      }
      await sleep(DELAY_MS);
    }
    if (!DRY_RUN) saveData(data);
  } else if (REAPPLY_FILTERS || REFETCH_MISSING || !SKIP_FETCH) {
    if (REAPPLY_FILTERS) {
      console.log("=== Reaplicando filtros: re-busca en 4 tiendas (no usa links Excel) ===\n");
    }
    if (!REAPPLY_FILTERS && !REFETCH_MISSING) {
      console.log("=== Descubriendo variantes cuenta/key faltantes ===");
      const missing = discoverMissingVariants(data);
      if (missing.length) {
        console.log("Nuevas variantes agregadas:", missing.length);
        for (const item of missing.slice(0, 20)) {
          console.log(" +", item.fullName);
          data.items.push(item);
        }
        if (missing.length > 20) {
          for (const item of missing.slice(20)) data.items.push(item);
          console.log(" ... y", missing.length - 20, "mas");
        }
      }
    }

    const targets = REFETCH_MISSING
      ? data.items.filter((item) => needsRefetch(item, data.items)).sort(refetchPriority)
      : REAPPLY_FILTERS
        ? data.items
        : data.items;

    const labelTotal = targets.length;
    if (REFETCH_MISSING) console.log("=== Re-fetch Steam / links rotos (" + labelTotal + ") ===\n");
    else if (!REAPPLY_FILTERS) {
      console.log("=== Busqueda en 4 tiendas (" + labelTotal + " items, paralelo + recheck 12h) ===\n");
    }

    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      const label = item.fullName || item.game + " / " + item.variant;
      process.stdout.write("[" + (i + 1) + "/" + labelTotal + "] " + label + " ... ");
      const res = await fetchOneItem(item, rates, fetchLog, label, { forceFullSearch });
      if (!res.ok) {
        errors++;
        pendientes.push({ fullName: label, attempts: res.attempts });
        console.log("PENDIENTE (reintentar)");
      } else if (res.recheck) {
        rechecked++;
        if (res.changed) {
          updated++;
          console.log("recheck", item.bestStore, item.compraArs);
        } else {
          unchanged++;
          console.log("recheck", item.bestStore, item.compraArs, "sin cambio");
        }
      } else if (res.changed) {
        updated++;
        console.log(item.bestStore, item.compraArs);
      } else {
        unchanged++;
        console.log(item.bestStore, item.compraArs, "sin cambio");
      }
      await sleep(DELAY_MS);
    }

    if (!REFETCH_MISSING && !REAPPLY_FILTERS) {
      for (const item of data.items) {
        if (!targets.includes(item)) item._oldCompra = item.compraArs || 0;
      }
    }
  } else {
    console.log("(skip-fetch: no consulta tiendas)\n");
    for (const item of data.items) {
      item._oldCompra = item.compraArs || 0;
    }
  }

  const restoredStale = LINKS_ONLY ? 0 : restoreStaleSupply(data.items, prevSupplySnapshot);
  if (restoredStale) {
    console.log("Precios anteriores restaurados (fetch fallo, mismos links):", restoredStale);
  }

  const steamRefresh = await refreshAllSteamPrices(data.items, fx);
  console.log(
    "\nSteam referencia actualizado:",
    steamRefresh.priced + "/" + steamRefresh.apps,
    "apps |",
    steamRefresh.variants,
    "variantes |",
    steamRefresh.changed || 0,
    "con precio distinto\n"
  );

  console.log("\n=== Aplicando reglas de precio (Steam lista + compra mayorista) ===");
  const pricing = applyPricingToCatalog(data, catalog, excelByFullName);
  pruneCatalogForSteamFirst(catalog, data);
  console.log(
    "Opciones visibles:",
    pricing.visible,
    "| Ocultas:",
    pricing.hidden,
    "| Nuevas en catalog:",
    pricing.catalogAdded || 0
  );

  console.log("\n=== RESUMEN ===");
  console.log(
    "Compras actualizadas:",
    updated,
    "| Sin cambio:",
    unchanged,
    "| Recheck rapido:",
    rechecked,
    "| Sin link (reservado):",
    skippedNoLinks,
    "| Errores:",
    errors
  );

  let summary = [
    "=== Actualizacion precios multi-tienda ===",
    "Fecha: " + new Date().toISOString(),
    "Excel origen (solo Steam): " + excelPath,
    "Compras actualizadas: " +
      updated +
      " | Sin cambio: " +
      unchanged +
      " | Recheck rapido: " +
      rechecked +
      " | Sin link (reservado): " +
      skippedNoLinks +
      " | Errores: " +
      errors,
    "Opciones visibles: " + pricing.visible + " | Ocultas: " + pricing.hidden,
    "",
    "--- Pendientes (buscar de nuevo) ---",
    ...pendientes.map((p) => p.fullName),
    "",
    "--- Fetch tiendas ---",
    ...fetchLog,
    "",
    "--- Precios / visibilidad ---",
    ...pricing.log,
  ].join("\n");

  if (!DRY_RUN) {
    let steamMeta = { fetched: 0, linkFill: 0, log: [] };
    if (!process.argv.includes("--skip-steam-meta")) {
      try {
        steamMeta = await syncSteamMetadata(catalog, data.items, SITE_DIR, {
          dryRun: false,
          maxFetch: IS_CI ? 20 : 60,
          delayMs: IS_CI ? 600 : 350,
        });
        if (steamMeta.fetched) {
          console.log("Steam metadata actualizada:", steamMeta.fetched, "apps");
        }
        if (steamMeta.log.length) {
          summary += "\n\n--- Steam metadata ---\n" + steamMeta.log.join("\n");
        }
      } catch (err) {
        console.warn("Steam metadata:", err.message);
      }
    }

    saveData(data);
    saveCatalog(CATALOG_PATH, catalog);
    fs.writeFileSync(LOG_PATH, summary, "utf8");
    console.log("Guardado catalog.js y kinguin-price-data.json");

    try {
      const guia = writeGuiaCompras(data, SITE_DIR);
      console.log("Guia compras (" + guia.count + " filas):", guia.jsonPath);
      if (guia.xlsxPath) console.log("Guia Excel:", guia.xlsxPath);

      const listaPath =
        process.env.GAMES_EXCEL_OUTPUT ||
        path.join(SITE_DIR, "GAMES LIST - AUTO - salida.xlsx");
      try {
        const lista = writeListaComprasExcel(data, listaPath);
        if (lista.skipped) {
          console.warn("Lista Excel no escrita (sin filas).");
        } else {
          console.log("Lista compras Excel (" + lista.count + " filas):", lista.path);
        }
      } catch (err) {
        console.warn("No se pudo escribir lista Excel:", err.message);
      }

      const autoSource = autoExcelSourcePath(excelPath);
      for (const autoPath of autoExcelWriteTargets(excelPath)) {
        try {
          const auto = writeGamesListAutoExcel(autoPath, data, autoSource);
          if (auto.skipped) {
            console.warn("Lista AUTO no escrita:", autoPath, auto.reason || "");
          } else {
            console.log("Lista AUTO (" + auto.count + " filas):", auto.path);
          }
        } catch (err) {
          console.warn("No se pudo escribir Lista AUTO:", autoPath, err.message);
        }
      }

      if (pendientes.length) {
        const pendPath = path.join(SITE_DIR, "compras-pendientes.txt");
        fs.writeFileSync(
          pendPath,
          pendientes.map((p) => p.fullName).join("\n"),
          "utf8"
        );
        const reserved = pendientes.filter((p) => p.reason === "sin_links_excel").length;
        const realPending = pendientes.length - reserved;
        if (reserved) {
          console.log("Info:", reserved, "filas sin link en Excel (reservadas para despues) ->", pendPath);
        }
        if (realPending) {
          console.warn("AVISO:", realPending, "items con error real ->", pendPath);
        }
      }
    } catch (err) {
      console.warn("No se pudo escribir guia-compras:", err.message);
    }
    if (!IS_CI) {
      try {
        const manifest = writeLocalManifest(data, catalog);
        if (manifest) {
          console.log("Manifest privado PC (" + manifest.count + " filas):");
          console.log(" ", manifest.jsonPath);
        }
      } catch (err) {
        console.warn("No se pudo escribir manifest local:", err.message);
      }
    }
  } else {
    console.log("(dry-run, no guardado)");
  }

  try {
    const { closeBrowser } = require("./lib/browser-supply.cjs");
    await closeBrowser();
  } catch (_) {}

  // Filas sin link en Excel no son error fatal: el usuario las deja vacias a proposito.
  if (errors > 0) {
    console.warn("AVISO: hubo", errors, "errores reales (no incluye filas sin link reservadas).");
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  try {
    const { closeBrowser } = require("./lib/browser-supply.cjs");
    await closeBrowser();
  } catch (_) {}
  console.error(err);
  process.exit(1);
});