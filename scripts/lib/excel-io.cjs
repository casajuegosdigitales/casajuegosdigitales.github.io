"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SITE_XL = path.join(__dirname, "..", "..", "GAMES LIST - AUTO.xlsx");
const DEFAULT_XL =
  process.env.GAMES_EXCEL ||
  (fs.existsSync(SITE_XL) ? SITE_XL : path.join(process.env.USERPROFILE || "", "Desktop", "GAMES LIST - AUTO.xlsx"));
const LEGACY_XL = path.join(process.env.USERPROFILE || "", "Downloads", "GAMES LIST.xlsx");

function colNum(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
  return n;
}

function readZipEntry(xlPath, entryName) {
  const buf = fs.readFileSync(xlPath);
  let offset = 0;
  while (offset < buf.length - 30) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const compMethod = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.slice(offset + 30, offset + 30 + nameLen).toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    offset = dataStart + compSize;
    if (name !== entryName) continue;
    if (compMethod === 0) return data;
    if (compMethod === 8) return zlib.inflateRawSync(data);
    throw new Error("Metodo ZIP no soportado: " + compMethod);
  }
  throw new Error("Entrada no encontrada en xlsx: " + entryName);
}

function readSharedStrings(xlPath) {
  const xml = readZipEntry(xlPath, "xl/sharedStrings.xml").toString("utf8");
  const strings = [];
  const siRe = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const inner = m[1];
    const parts = inner.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
    strings.push(
      parts
        .map((p) => {
          const t = p.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
          return t ? t[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : "";
        })
        .join("")
    );
  }
  return strings;
}

function parseDolarSteam(raw) {
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  let num = Number(cleaned);
  if (!num || Number.isNaN(num)) return 0;
  if (num < 100) num *= 1000;
  return Math.round(num);
}

function isHttpLink(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function cleanLink(value) {
  const v = String(value || "").trim();
  if (!v || /^abrir\s/i.test(v) || /^link\s/i.test(v)) return "";
  return isHttpLink(v) ? v : "";
}

function inferEditionFromLinks(linksText) {
  const t = String(linksText || "").toLowerCase();
  if (/icons-edition|icons_edition|\bicons\b/.test(t)) return "ICONS Edition";
  if (/toty-edition|toty_edition|\btoty\b/.test(t)) return "TOTY Edition";
  if (/ultimate-edition-plus|ultimate_edition_plus|ultimate-plus-edition/.test(t)) return "Ultimate Plus Edition";
  if (/ultimate-edition|ultimate_edition/.test(t)) return "Ultimate Edition";
  if (/deluxe-edition|deluxe_edition|\bdeluxe\b/.test(t)) return "Deluxe Edition";
  if (/premium-edition|premium_edition|\bpremium\b/.test(t)) return "Premium Edition";
  if (/gold-edition|gold_edition|\bgold\b/.test(t)) return "Gold Edition";
  if (/standard-edition|standard_edition/.test(t)) return "Edicion estandar";
  return "";
}

/** Corrige columna version cuando el link de compra indica otra edicion. */
function reconcileEditionFromSupplyLinks(edition, linksJoined) {
  const href = String(linksJoined || "").toLowerCase();
  let ed = String(edition || "").trim() || "Edicion estandar";
  if (/ultimate-edition-plus|ultimate_edition_plus|ultimate-plus-edition/.test(href)) {
    if (!/\bplus\b/i.test(ed)) return "Ultimate Plus Edition";
  }
  if (/\bultimate\b/i.test(ed) && /\bplus\b/i.test(href) && !/\bplus\b/i.test(ed)) {
    return "Ultimate Plus Edition";
  }
  return ed;
}

function inferTipoFromLinks(linksText) {
  const t = String(linksText || "").toLowerCase();
  if (/\/account|steam-account|cuenta/.test(t)) return "Cuenta Steam";
  if (/cd-key|cd_key|digital-key|steam-key/.test(t)) return "CD Key";
  return "";
}

function decodeXmlText(raw) {
  return String(raw || "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function readSheetData(xlPath) {
  const strings = readSharedStrings(xlPath);
  const sheet = readZipEntry(xlPath, "xl/worksheets/sheet1.xml").toString("utf8");
  const data = {};
  const rowRe = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(sheet))) {
    const rn = Number(rm[1]);
    data[rn] = {};
    // Soporta celdas vacias self-closing (<c .../>) y celdas sin atributos (<c r="D2"><v>1</v></c>).
    const cellRe = /<c r="([A-Z]+)(\d+)"([^>/]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[2]))) {
      const col = colNum(cm[1]);
      const attrs = cm[3] || "";
      const inner = cm[4] || "";
      let val = "";
      const v = inner.match(/<v>([^<]*)<\/v>/);
      if (v) val = v[1];
      const f = inner.match(/<f[^>]*>([\s\S]*?)<\/f>/);
      if (f && /HYPERLINK\s*\(/i.test(f[1])) {
        const formula = decodeXmlText(f[1]);
        const url = formula.match(/HYPERLINK\s*\(\s*"([^"]+)"/i);
        if (url) val = url[1];
      }
      if (/t="s"/.test(attrs) && val !== "" && /^-?\d+$/.test(val)) {
        val = strings[Number(val)] || "";
      }
      if (val !== "") data[rn][col] = val;
    }
  }
  return data;
}

function isAutoExcelData(data) {
  const h = String(data[1]?.[1] || "").trim().toLowerCase();
  return h === "juego";
}

function readExcelAutoRows(xlPath) {
  const data = readSheetData(xlPath);
  const rows = [];
  let lastGame = "";
  let lastEdition = "Edicion estandar";
  let lastLinkSteam = "";

  for (let r = 2; r <= 500; r++) {
    const row = data[r];
    if (!row) continue;

    let game = String(row[1] || "").trim();
    if (game && !/^\d+$/.test(game)) {
      if (game !== lastGame) lastLinkSteam = "";
      lastGame = game;
      if (row[2]) lastEdition = String(row[2]).trim() || lastEdition;
    }
    if (!lastGame) continue;

    const linksJoined = [row[10], row[9], row[11], row[12], row[13]].filter(Boolean).join(" ");
    let edition = String(row[2] || "").trim();
    if (!edition || /^\d+$/.test(edition)) {
      edition = inferEditionFromLinks(linksJoined) || lastEdition;
    } else {
      lastEdition = edition;
    }

    let tipo = String(row[3] || "").trim();
    if (!tipo || /^\d+$/.test(tipo)) tipo = inferTipoFromLinks(linksJoined);
    if (!tipo) continue;
    edition = reconcileEditionFromSupplyLinks(edition, linksJoined);

    const linkSteamRaw = cleanLink(row[9]);
    if (linkSteamRaw) lastLinkSteam = linkSteamRaw;
    const linkSteam = linkSteamRaw || lastLinkSteam;
    const linkKinguin = cleanLink(row[10]);
    const linkDriffle = cleanLink(row[11]);
    const linkLoaded = cleanLink(row[12]);
    const linkEneba = cleanLink(row[13]);
    if (!linkKinguin && !linkDriffle && !linkLoaded && !linkEneba && !linkSteam) continue;

    const compra = Math.round(Number(row[4] || 0));
    const precioSteam = Math.round(Number(row[5] || 0));
    const venta = Math.round(Number(row[6] || 0));
    let cuotas = Math.round(Number(row[7] || 0));
    if (cuotas <= 0 && venta > 0) cuotas = Math.round(venta * 1.44);

    rows.push({
      game: lastGame,
      edition,
      tipo,
      fullName: "",
      compra,
      venta,
      cuotas,
      precioSteam,
      linkSteam,
      linkKinguin,
      linkEneba,
      linkDriffle,
      linkLoaded,
    });
  }

  return { format: "auto", dolarSteam: 0, rows };
}

function readExcelRows(xlPath) {
  const data = readSheetData(xlPath);
  if (isAutoExcelData(data)) return readExcelAutoRows(xlPath);

  const dolarSteam = data[1] ? parseDolarSteam(data[1][1]) : 0;
  const rows = [];

  for (let r = 4; r <= 400; r++) {
    if (!data[r]) continue;
    const row = data[r];
    const name = String(row[1] || "").trim();
    if (!name || /^https?:/i.test(name)) continue;

    const venta = Math.round(Number(row[4] || 0));
    if (venta <= 0) continue;

    let cuotas = Math.round(Number(row[5] || 0));
    if (cuotas <= 0) cuotas = Math.round(venta * 1.44);

    const compra = Math.round(Number(row[2] || 0));
    const precioSteam = Math.round(Number(row[3] || 0));
    let linkKinguin = String(row[8] || "");
    if (linkKinguin === "LINK COMPRA") linkKinguin = "";
    let linkSteam = String(row[9] || "");
    if (linkSteam === "LINK STEAM") linkSteam = "";

    let linkEneba = String(row[10] || "");
    if (/^LINK\s/i.test(linkEneba)) linkEneba = "";
    let linkDriffle = String(row[11] || "");
    if (/^LINK\s/i.test(linkDriffle)) linkDriffle = "";
    let linkLoaded = String(row[12] || "");
    if (/^LINK\s/i.test(linkLoaded)) linkLoaded = "";

    rows.push({ fullName: name, compra, venta, cuotas, precioSteam, linkKinguin, linkSteam, linkEneba, linkDriffle, linkLoaded });
  }

  return { dolarSteam, rows };
}

function latamFromRow(row) {
  return /latam/i.test(
    [row.linkKinguin, row.linkEneba, row.linkDriffle, row.linkLoaded, row.linkSteam]
      .filter(Boolean)
      .join(" ")
  );
}

function deliveryTypeFromTipo(tipo) {
  return /cuenta|account/i.test(String(tipo || "")) ? "account" : "code";
}

function variantFromExcelRow(row) {
  const edition = row.edition || "Edicion estandar";
  const isAccount = deliveryTypeFromTipo(row.tipo) === "account";
  if (isAccount) return `${edition} - Cuenta Steam`;
  const latam = latamFromRow(row);
  return latam ? `${edition} - CD Key LATAM (Steam)` : `${edition} - CD Key (Steam)`;
}

function fullNameFromExcelRow(row) {
  const game = String(row.game || "").trim();
  const edition = String(row.edition || "Edicion estandar").trim();
  const tipo = String(row.tipo || "").trim();
  return `${game} | ${edition} | ${tipo}`;
}

function excelRowKey(row) {
  const variant =
    row.variant ||
    (row.game && row.tipo
      ? variantFromExcelRow({
          edition: row.edition || "Edicion estandar",
          tipo: row.tipo,
          linkKinguin: row.linkKinguin,
          linkEneba: row.linkEneba,
          linkDriffle: row.linkDriffle,
          linkLoaded: row.linkLoaded,
          linkSteam: row.linkSteam,
        })
      : "");
  const linkTag = String(row.linkKinguin || row.linkDriffle || row.linkEneba || row.linkLoaded || "")
    .replace(/^https?:\/\//i, "")
    .slice(0, 48);
  const base = `${row.game}|${row.edition || "Edicion estandar"}|${row.tipo || ""}|${variant}`;
  return linkTag ? base + "|" + linkTag : base;
}

function enrichAutoExcelRow(row) {
  row.variant = variantFromExcelRow(row);
  row.fullName = fullNameFromExcelRow(row);
  row.excelKey = excelRowKey(row);
  row.latam = latamFromRow(row);
  return row;
}

function loadExcelProducts(xlPath) {
  const resolved = xlPath || DEFAULT_XL;
  const data = readExcelRows(resolved);
  const byFullName = new Map();

  for (const row of data.rows) {
    if (row.game && data.format === "auto") {
      enrichAutoExcelRow(row);
    } else if (!row.fullName && row.game) {
      const { buildVariantItem } = require("./match-product.cjs");
      const isAccount = deliveryTypeFromTipo(row.tipo) === "account";
      const template = {
        game: row.game,
        variant: row.edition || "Edicion estandar",
        linkSteam: row.linkSteam || "",
        precioSteamArs: row.precioSteam || 0,
      };
      const built = buildVariantItem(template, "steam", isAccount ? "account" : "code", {
        latam: latamFromRow(row),
      });
      row.fullName = built.fullName;
      row.variant = built.variant;
    }
    if (row.fullName) byFullName.set(row.fullName, row);
  }

  return {
    path: resolved,
    format: data.format || "legacy",
    dolarSteam: data.dolarSteam,
    rows: data.rows,
    byFullName,
  };
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function writeZip(outputPath, files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const data = file.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    parts.push(local, data);
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    nameBuf.copy(cd, 46);
    central.push(cd);
    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(outputPath, Buffer.concat([...parts, centralBuf, end]));
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function hyperlinkLabel(header) {
  if (header === "linkCompra") return "Abrir compra";
  if (header === "linkSteam" || header === "link Steam") return "Abrir Steam";
  if (header === "kinguin") return "Kinguin";
  if (header === "eneba") return "Eneba";
  if (header === "driffle") return "Driffle";
  if (header === "loaded") return "Loaded";
  return "Abrir link";
}

function hyperlinkFormula(url, label) {
  const u = String(url).trim().replace(/"/g, '""');
  const l = String(label).replace(/"/g, '""');
  return `HYPERLINK("${u}","${l}")`;
}

function writeXlsx(outputPath, headers, rows, sheetName, hyperlinkHeaders) {
  const linkCols = new Set(hyperlinkHeaders || ["linkCompra", "linkSteam"]);
  const strings = [];
  const indexOf = new Map();
  function strIdx(val) {
    const s = String(val ?? "");
    if (!indexOf.has(s)) {
      indexOf.set(s, strings.length);
      strings.push(s);
    }
    return indexOf.get(s);
  }
  const matrix = [headers].concat(rows.map((r) => headers.map((h) => r[h] ?? "")));
  let sheetRows = "";
  for (let ri = 0; ri < matrix.length; ri++) {
    const rNum = ri + 1;
    let cells = "";
    for (let ci = 0; ci < matrix[ri].length; ci++) {
      const ref = colLetter(ci + 1) + rNum;
      const header = headers[ci];
      const val = matrix[ri][ci];
      if (ri > 0 && linkCols.has(header) && isHttpUrl(val)) {
        const label = hyperlinkLabel(header);
        const formula = hyperlinkFormula(val, label);
        cells += `<c r="${ref}" t="str"><f>${escapeXml(formula)}</f><v>${escapeXml(label)}</v></c>`;
      } else if (typeof val === "number" && Number.isFinite(val)) {
        cells += `<c r="${ref}"><v>${val}</v></c>`;
      } else {
        cells += `<c r="${ref}" t="s"><v>${strIdx(val)}</v></c>`;
      }
    }
    sheetRows += `<row r="${rNum}">${cells}</row>`;
  }
  const sst =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((s) => `<si><t>${escapeXml(s)}</t></si>`).join("") +
    "</sst>";
  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    sheetRows +
    "</sheetData></worksheet>";
  const name = escapeXml(sheetName || "Guia").replace(/"/g, "");
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>';
  const relsRoot =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const relsWorkbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>';
  writeZip(outputPath, [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(relsRoot, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbook, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(relsWorkbook, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet, "utf8") },
    { name: "xl/sharedStrings.xml", data: Buffer.from(sst, "utf8") },
  ]);
}

const AUTO_WRITE_HEADERS = [
  "juego",
  "version",
  "tipo",
  "compra Ars",
  "Precio Steam (Ars)",
  "venta Transfer",
  "venta CuotasArs",
  "ganancia",
  "link Steam",
  "kinguin",
  "driffle",
  "loaded",
  "eneba",
];

const AUTO_LINK_HEADERS = ["link Steam", "kinguin", "driffle", "loaded", "eneba"];

function buildAutoPriceMap(items) {
  const { hasValidPublishedSupply } = require("./match-product.cjs");
  const map = new Map();
  for (const item of items || []) {
    if (!item.game || !item.tipo) continue;
    const edition = item.edition || "Edicion estandar";
    const key = item.excelKey || `${item.game}|${edition}|${item.tipo}`;
    const verified = hasValidPublishedSupply(item);
    const compra = verified ? Math.round(Number(item.compraArs) || 0) : 0;
    const venta = verified ? Math.round(Number(item.ventaPublicada) || 0) : 0;
    const cuotas = verified
      ? Math.round(Number(item.cuotasPublicada) || 0)
      : venta > 0
        ? Math.round(venta * 1.44)
        : 0;
    const steam = Math.round(Number(item.precioSteamArs) || 0);
    const ganancia = verified && venta > compra ? venta - compra : 0;
    map.set(key, { compra, steam, venta, cuotas, ganancia });
  }
  return map;
}

function mergeAutoExcelPrices(excelRows, priceMap) {
  return excelRows.map((row) => {
    const key = row.excelKey || excelRowKey(row);
    const prices = priceMap.get(key);
    const compra = prices?.compra ?? row.compra ?? 0;
    const venta = prices?.venta ?? row.venta ?? 0;
    const cuotas = prices?.cuotas ?? row.cuotas ?? 0;
    const precioSteam = prices?.steam ?? row.precioSteam ?? 0;
    const ganancia =
      prices?.ganancia != null ? prices.ganancia : venta > compra ? venta - compra : 0;
    return { ...row, compra, venta, cuotas, precioSteam, ganancia };
  });
}

function autoRowsToWriteMatrix(rows, rawLayout) {
  let lastGame = "";
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const layout = rawLayout?.[i];
    const showGame = layout ? layout.showGame : row.game && row.game !== lastGame;
    if (showGame) lastGame = row.game;
    const compra = Number(row.compra) || 0;
    const venta = Number(row.venta) || 0;
    const cuotas = Number(row.cuotas) || 0;
    const precioSteam = Number(row.precioSteam) || 0;
    const ganancia =
      row.ganancia != null ? Number(row.ganancia) || 0 : Math.max(0, venta - compra);
    out.push({
      juego: showGame ? row.game : "",
      version: layout ? layout.edition || "" : row.edition || "",
      tipo: row.tipo || "",
      "compra Ars": compra,
      "Precio Steam (Ars)": precioSteam,
      "venta Transfer": venta,
      "venta CuotasArs": cuotas,
      ganancia,
      "link Steam": row.linkSteam || "",
      kinguin: row.linkKinguin || "",
      driffle: row.linkDriffle || "",
      loaded: row.linkLoaded || "",
      eneba: row.linkEneba || "",
    });
  }
  return out;
}

function readAutoExcelLayout(xlPath) {
  const data = readSheetData(xlPath);
  const layout = [];
  let lastGame = "";
  let lastEdition = "Edicion estandar";
  for (let r = 2; r <= 500; r++) {
    const row = data[r];
    if (!row) continue;
    let game = String(row[1] || "").trim();
    if (game && !/^\d+$/.test(game)) {
      lastGame = game;
      if (row[2]) lastEdition = String(row[2]).trim() || lastEdition;
    }
    if (!lastGame) continue;
    const linksJoined = [row[10], row[9], row[11], row[12], row[13]].filter(Boolean).join(" ");
    let edition = String(row[2] || "").trim();
    if (!edition || /^\d+$/.test(edition)) {
      edition = inferEditionFromLinks(linksJoined) || lastEdition;
    } else {
      lastEdition = edition;
    }
    let tipo = String(row[3] || "").trim();
    if (!tipo || /^\d+$/.test(tipo)) tipo = inferTipoFromLinks(linksJoined);
    if (!tipo) continue;
    layout.push({
      showGame: Boolean(String(row[1] || "").trim() && !/^\d+$/.test(String(row[1] || "").trim())),
      edition: String(row[2] || "").trim() || "",
    });
  }
  return layout;
}

function writeGamesListAutoExcel(outputPath, data, sourcePath) {
  const resolvedSource = sourcePath || outputPath;
  if (!fs.existsSync(resolvedSource)) {
    return { path: outputPath, count: 0, skipped: true, reason: "source_missing" };
  }
  const excel = loadExcelProducts(resolvedSource);
  if (!excel.rows.length) {
    return { path: outputPath, count: 0, skipped: true, reason: "no_rows" };
  }
  const priceMap = buildAutoPriceMap(data.items || []);
  const merged = mergeAutoExcelPrices(excel.rows, priceMap);
  const rawLayout = readAutoExcelLayout(resolvedSource);
  const matrix =
    rawLayout.length === merged.length
      ? autoRowsToWriteMatrix(merged, rawLayout)
      : autoRowsToWriteMatrix(merged);
  writeXlsx(outputPath, AUTO_WRITE_HEADERS, matrix, "Lista juegos", AUTO_LINK_HEADERS);
  return { path: outputPath, count: matrix.length };
}

module.exports = {
  DEFAULT_XL,
  LEGACY_XL,
  AUTO_WRITE_HEADERS,
  loadExcelProducts,
  readExcelRows,
  readExcelAutoRows,
  buildAutoPriceMap,
  writeGamesListAutoExcel,
  writeXlsx,
  colLetter,
  escapeXml,
  isHttpUrl,
  hyperlinkFormula,
};
