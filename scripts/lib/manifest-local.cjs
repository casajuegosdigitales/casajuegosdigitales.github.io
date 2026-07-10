"use strict";

const fs = require("fs");
const path = require("path");
const { writeXlsx } = require("./excel-io.cjs");

const { listingMatchesItem, deliveryTypeFromItem, platformFromItem, isSteamItem, isPublishableAltPlatform, hasValidPublishedSupply } = require("./match-product.cjs");

const LISTA_HEADERS = [
  "juego",
  "version",
  "esCdKey",
  "tipoCuentaKey",
  "compraArs",
  "precioPlataformaArs",
  "ventaTransferArs",
  "gananciaArs",
  "ventaCuotasArs",
  "linkCompra",
  "linkSteam",
  "tienda",
  "regionDetectada",
  "verificado",
  "nombreListado",
  "actualizado",
];

const GUIA_HEADERS = LISTA_HEADERS.concat([
  "listadoCoherente",
  "alternativas",
  "precioKinguin",
  "precioEneba",
  "precioDriffle",
  "precioLoaded",
  "linkKinguin",
  "linkEneba",
  "linkDriffle",
  "linkLoaded",
]);

const MANIFEST_HEADERS = GUIA_HEADERS;

const DEFAULT_DIR = path.join(process.env.USERPROFILE || "", "Downloads", "CJD-operaciones");

function writeCsvSemicolon(filePath, headers, rows) {
  const lines = [headers.join(";")].concat(
    rows.map((r) =>
      headers
        .map((h) => {
          const v = String(r[h] ?? "").replace(/"/g, '""');
          return `"${v}"`;
        })
        .join(";")
    )
  );
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function getManifestDir() {
  return process.env.CJD_MANIFEST_DIR || DEFAULT_DIR;
}

function tipoEntregaLabel(item) {
  if (deliveryTypeFromItem(item) === "account") {
    const p = platformFromItem(item);
    if (p === "rockstar") return "Cuenta Rockstar";
    if (p === "ea") return "Cuenta EA App";
    if (p === "ubisoft") return "Cuenta Ubisoft Connect";
    if (p === "epic") return "Cuenta Epic Games";
    return "Cuenta Steam";
  }
  const p = platformFromItem(item);
  if (p === "rockstar") return "CD Key Rockstar";
  if (p === "ea") return "CD Key EA App";
  if (p === "ubisoft") return "CD Key Ubisoft Connect";
  if (p === "epic") return "CD Key Epic Games";
  return "CD Key Steam";
}

function platformSortRank(tipoCuentaKey) {
  if (/Steam/i.test(tipoCuentaKey || "")) return 0;
  return 1;
}

function includeInGuia(item) {
  if (item.hidden) return false;
  if (isSteamItem(item)) return true;
  return isPublishableAltPlatform(item);
}

function storePriceByStore(item) {
  const out = { kinguin: "", eneba: "", driffle: "", loaded: "" };
  for (const q of item.supplyQuotes || []) {
    if (!q?.store || !q?.priceArs) continue;
    if (out[q.store] === "") out[q.store] = String(Math.round(q.priceArs));
  }
  return out;
}

function buildRows(data) {
  const now = new Date().toISOString();
  const rows = [];
  for (const item of data.items || []) {
    if (!includeInGuia(item)) continue;
    const verified = hasValidPublishedSupply(item);
    const nombreListado = verified
      ? (item.supplyQuotes || []).find((q) => q.store === item.bestStore)?.name || item.bestListado || ""
      : "";
    const linkCompra = verified ? item.bestLink || "" : "";
    const compra = verified ? item.compraArs || 0 : 0;
    const venta = verified ? item.ventaPublicada || 0 : 0;
    if (verified && venta > 0 && venta < compra) continue;
    const cuotas = verified ? item.cuotasPublicada || 0 : 0;
    const listadoCoherente =
      verified && nombreListado
        ? listingMatchesItem(item, nombreListado, linkCompra)
          ? "SI"
          : "NO"
        : "";
    const storePrices = storePriceByStore(item);
    rows.push({
      juego: item.game,
      version: item.variant,
      esCdKey: deliveryTypeFromItem(item) === "code" ? "SI" : "NO",
      tipoCuentaKey: tipoEntregaLabel(item),
      compraArs: compra,
      precioPlataformaArs: item.precioSteamArs || 0,
      ventaTransferArs: venta,
      gananciaArs: verified ? Math.max(0, venta - compra) : 0,
      ventaCuotasArs: cuotas,
      linkCompra,
      linkSteam: item.linkSteam || "",
      tienda: verified ? item.bestStore || "" : "",
      regionDetectada: item.regionLabel || (verified ? "AR/LATAM" : ""),
      verificado: verified ? "SI" : "NO",
      nombreListado,
      actualizado: item.supplyCheckedAt || now,
      listadoCoherente,
      alternativas: (item.supplyQuotes || []).map((q) => `${q.store}:${q.priceArs}`).join(" | "),
      precioKinguin: storePrices.kinguin,
      precioEneba: storePrices.eneba,
      precioDriffle: storePrices.driffle,
      precioLoaded: storePrices.loaded,
      linkKinguin: item.linkKinguin || "",
      linkEneba: item.linkEneba || "",
      linkDriffle: item.linkDriffle || "",
      linkLoaded: item.linkLoaded || "",
    });
  }
  rows.sort((a, b) => {
    const byGame = String(a.juego || "").localeCompare(String(b.juego || ""), "es", { sensitivity: "base" });
    if (byGame !== 0) return byGame;
    const byEdition = String(a.version || "").localeCompare(String(b.version || ""), "es", { sensitivity: "base" });
    if (byEdition !== 0) return byEdition;
    return platformSortRank(a.tipoCuentaKey) - platformSortRank(b.tipoCuentaKey);
  });
  return rows;
}

function writeGuiaCompras(data, siteDir) {
  const rows = buildRows(data);
  const payload = {
    generado: new Date().toISOString(),
    total: rows.length,
    nota: "Guia de compra: tienda mas barata entre Kinguin, Eneba, Driffle y Loaded.",
    items: rows,
  };
  const jsonPath = path.join(siteDir, "guia-compras.json");
  const csvPath = path.join(siteDir, "guia-compras.csv");
  const xlsxPath = path.join(siteDir, "guia-compras.xlsx");
  const csvArPath = path.join(siteDir, "guia-compras-excel.csv");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  const headers = ["juego", "variante", "tienda", "linkCompra", "compraArs", "ventaTransferArs", "gananciaArs"];
  const csv = [headers.join(",")].concat(
    rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))
  ).join("\n");
  fs.writeFileSync(csvPath, csv, "utf8");
  writeCsvSemicolon(csvArPath, GUIA_HEADERS, rows);
  writeXlsx(xlsxPath, GUIA_HEADERS, rows, "Guia compras");
  return { jsonPath, csvPath, xlsxPath, csvArPath, count: rows.length };
}

function writeListaComprasExcel(data, outputPath) {
  const rows = buildRows(data);
  if (!rows.length) {
    return { path: outputPath, count: 0, skipped: true };
  }
  writeXlsx(outputPath, GUIA_HEADERS, rows, "Lista compras");
  return { path: outputPath, count: rows.length };
}

function writeLocalManifest(data, catalog, manifestDir) {
  const dir = manifestDir || getManifestDir();
  fs.mkdirSync(dir, { recursive: true });
  const rows = buildRows(data);
  const now = new Date().toISOString();
  const payload = {
    generado: now,
    total: rows.length,
    nota: "Copia privada en tu PC. Misma info que guia-compras.json del repo.",
    items: rows,
  };
  const jsonPath = path.join(dir, "manifesto-compras.json");
  const csvPath = path.join(dir, "manifesto-compras.csv");
  const xlsxPath = path.join(dir, "manifesto-compras.xlsx");
  const csvArPath = path.join(dir, "manifesto-compras-excel.csv");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  writeCsvSemicolon(csvPath, MANIFEST_HEADERS, rows);
  writeCsvSemicolon(csvArPath, MANIFEST_HEADERS, rows);
  writeXlsx(xlsxPath, MANIFEST_HEADERS, rows, "Guia compras");
  return { jsonPath, csvPath, xlsxPath, csvArPath, count: rows.length };
}

module.exports = {
  writeLocalManifest,
  writeGuiaCompras,
  writeListaComprasExcel,
  getManifestDir,
  DEFAULT_DIR,
  buildRows,
  LISTA_HEADERS,
};