"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { fetchSteamAppDetails } = require("./fx-rates.cjs");

function escJs(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "\\n");
}
function steamDetailsToJs(sd) {
  if (!sd) return "";
  const parts = [];
  if (sd.description) parts.push('description:"' + escJs(sd.description) + '"');
  if (sd.min) parts.push('min:"' + escJs(sd.min) + '"');
  if (sd.rec) parts.push('rec:"' + escJs(sd.rec) + '"');
  return parts.length ? "steamDetails:{" + parts.join(",") + "}" : "";
}
function gameToJs(g) {
  const tagStr = (g.tags || []).map((t) => '"' + escJs(t) + '"').join(",");
  const sd = steamDetailsToJs(g.steamDetails);
  const sdPart = sd ? "," + sd : "";
  const lines = [
    '  { id:' + g.id + ',name:"' + escJs(g.name) + '",icon:"' + escJs(g.icon || "game") + '",steamId:"' + escJs(g.steamId || "") + '"' + sdPart + ',img:"' + escJs(g.img || "") + '",heroImg:"' + escJs(g.heroImg || g.img || "") + '",',
    '    badge:"' + escJs(g.badge || "") + '",badgeType:"' + escJs(g.badgeType || "") + '",',
    '    tags:[' + tagStr + '],platform:"' + escJs(g.platform || "Steam - PC") + '",',
    '    description:"' + escJs(g.description || "Juego original para PC. Elegi edicion, entrega (cuenta o CD Key) y metodo de pago. Entrega coordinada por WhatsApp.") + '",',
    "    delivery:[",
  ];
  for (const d of g.delivery || []) {
    lines.push('      {id:"' + escJs(d.id) + '",name:"' + escJs(d.name) + '",desc:"' + escJs(d.desc) + '"},');
  }
  lines.push("    ],", "    versions:[");
  for (const v of g.versions || []) {
    let extra = "";
    if (v.hidden) extra += ",hidden:true";
    if (Number(v.steamPriceArs) > 0) extra += ",steamPriceArs:" + Math.round(v.steamPriceArs);
    lines.push('      {id:"' + escJs(v.id) + '",name:"' + escJs(v.name) + '",deliveryType:"' + escJs(v.deliveryType) + '",basePrice:' + v.basePrice + ",priceTransfer:" + v.priceTransfer + extra + "},");
  }
  lines.push("    ]", "  },");
  return lines.join("\n");
}
function catalogToJs(catalog) { return "const catalog = [\n" + catalog.map(gameToJs).join("\n") + "\n];\n"; }
function loadCatalog(filePath) {
  const code = fs.readFileSync(filePath, "utf8");
  const catalog = new Function(code + "\nreturn catalog;")();
  if (!Array.isArray(catalog)) throw new Error("No se pudo leer catalog");
  return catalog;
}
function saveCatalog(filePath, catalog) {
  finalizeCatalogGames(catalog);
  const publishable = (catalog || []).filter(
    (g) => !g.hidden && (g.versions || []).some((v) => !v.hidden)
  );
  fs.writeFileSync(filePath, catalogToJs(publishable), "utf8");
}
function findCatalogVersion(catalog, item) {
  const game = catalog.find((g) => g.name === item.game);
  if (!game) return { game: null, version: null };
  const version = (game.versions || []).find((v) => v.name === item.variant);
  return { game, version };
}

function nextVersionId(versions) {
  let max = 0;
  for (const v of versions || []) {
    const m = String(v.id || "").match(/^v(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return "v" + (max + 1);
}

function ensureDeliveryOption(game, deliveryType) {
  const delivery = game.delivery || [];
  const needId = deliveryType === "account" ? "account" : "code";
  if (delivery.some((d) => d.id === needId)) return;
  if (needId === "account") {
    delivery.push({
      id: "account",
      name: "Cuenta completa",
      desc: "Te entregamos una cuenta con el juego activado en la plataforma indicada en cada edicion.",
    });
  } else {
    delivery.push({
      id: "code",
      name: "Codigo / CD Key",
      desc: "Recibis el codigo por email y lo activas en la plataforma indicada en cada edicion (Steam, EA App, Rockstar, Ubisoft, etc.).",
    });
  }
  game.delivery = delivery;
}

function nextGameId(catalog) {
  let max = 0;
  for (const g of catalog || []) {
    const n = Number(g.id);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}

function steamAssetsFromLink(linkSteam) {
  const steamId = String(linkSteam || "").match(/\/app\/(\d+)/)?.[1] || "";
  if (!steamId) return { steamId: "", img: "", heroImg: "" };
  const base = "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/" + steamId;
  return {
    steamId,
    img: base + "/library_600x900_2x.jpg",
    heroImg: base + "/library_hero_2x.jpg",
  };
}

function ensureCatalogGame(catalog, item) {
  let game = catalog.find((g) => g.name === item.game);
  if (game) {
    syncGameSteamAssets(game, item.linkSteam);
    return { game, created: false };
  }
  const assets = steamAssetsFromLink(item.linkSteam);
  game = {
    id: nextGameId(catalog),
    name: item.game,
    icon: "game",
    steamId: assets.steamId,
    img: assets.img,
    heroImg: assets.heroImg || assets.img,
    badge: "",
    badgeType: "",
    tags: [],
    platform: "Steam - PC",
    description:
      "Juego original para PC. Elegi edicion, entrega (cuenta o CD Key) y metodo de pago. Entrega coordinada por WhatsApp.",
    delivery: [],
    versions: [],
  };
  catalog.push(game);
  return { game, created: true };
}

function ensureCatalogVersion(catalog, item, deliveryType) {
  const ensuredGame = ensureCatalogGame(catalog, item);
  const game = ensuredGame.game;
  if (!game) return { game: null, version: null, created: false, gameCreated: false };
  let version = (game.versions || []).find((v) => v.name === item.variant);
  if (version) return { game, version, created: false, gameCreated: ensuredGame.created };
  const dtype =
    deliveryType ||
    (item.tipo
      ? /\bcuenta\b|account/i.test(item.tipo)
        ? "account"
        : "code"
      : /\baccount\b|\bcuenta\b/i.test(`${item.fullName} ${item.variant}`)
        ? "account"
        : "code");
  ensureDeliveryOption(game, dtype);
  version = {
    id: nextVersionId(game.versions),
    name: item.variant,
    deliveryType: dtype,
    basePrice: 0,
    priceTransfer: 0,
  };
  if (Number(item.precioSteamArs) > 0) version.steamPriceArs = Math.round(Number(item.precioSteamArs));
  game.versions = game.versions || [];
  game.versions.push(version);
  return { game, version, created: true, gameCreated: ensuredGame.created };
}

function propagateSteamLinks(items) {
  const byGame = new Map();
  for (const item of items || []) {
    if (!item.game) continue;
    if (!byGame.has(item.game)) byGame.set(item.game, []);
    byGame.get(item.game).push(item);
  }
  let filled = 0;
  for (const group of byGame.values()) {
    const steam = group.find((i) => i.linkSteam)?.linkSteam || "";
    if (!steam) continue;
    for (const item of group) {
      if (!item.linkSteam) {
        item.linkSteam = steam;
        filled++;
      }
    }
  }
  return filled;
}

function syncGameSteamAssets(game, linkSteam) {
  const assets = steamAssetsFromLink(linkSteam);
  if (!assets.steamId) return false;
  let changed = false;
  if (!game.steamId) {
    game.steamId = assets.steamId;
    changed = true;
  }
  if (!game.img) {
    game.img = assets.img;
    changed = true;
  }
  if (!game.heroImg) {
    game.heroImg = assets.heroImg;
    changed = true;
  }
  return changed;
}

function trimDeliveryOptions(game) {
  const vis = (game.versions || []).filter((v) => !v.hidden);
  const hasCode = vis.some((v) => (v.deliveryType || "account") === "code");
  const hasAcc = vis.some((v) => (v.deliveryType || "account") === "account");
  const defs = {
    code: {
      id: "code",
      name: "Codigo / CD Key",
      desc: "Recibis el codigo por email y lo activas en la plataforma indicada en cada edicion (Steam, EA App, Rockstar, Ubisoft, etc.).",
    },
    account: {
      id: "account",
      name: "Cuenta completa",
      desc: "Te entregamos una cuenta con el juego activado en la plataforma indicada en cada edicion.",
    },
  };
  game.delivery = [];
  if (hasCode) game.delivery.push(defs.code);
  if (hasAcc) game.delivery.push(defs.account);
}

function finalizeCatalogGames(catalog) {
  for (const game of catalog || []) {
    game.versions = (game.versions || []).filter((v) => !v.hidden);
    trimDeliveryOptions(game);
    const vis = game.versions || [];
    game.hidden = vis.length === 0;
  }
}

function loadJsCache(filePath, varName) {
  if (!fs.existsSync(filePath)) return {};
  const code = fs.readFileSync(filePath, "utf8");
  const fn = new Function(code + "\nreturn " + varName + ";");
  const obj = fn();
  return obj && typeof obj === "object" ? obj : {};
}

function writeDetailsCache(filePath, cache) {
  const keys = Object.keys(cache).sort((a, b) => Number(a) - Number(b));
  const lines = keys.map((id) => {
    const e = cache[id];
    const parts = [];
    if (e.description) parts.push('description:"' + escJs(e.description) + '"');
    if (e.min) parts.push('min:"' + escJs(e.min) + '"');
    if (e.rec) parts.push('rec:"' + escJs(e.rec) + '"');
    return '    "' + id + '": { ' + parts.join(", ") + " }";
  });
  fs.writeFileSync(filePath, "const STEAM_DETAILS_CACHE={\n" + lines.join(",\n") + "\n};\n", "utf8");
}

function writeAboutCache(filePath, cache) {
  const keys = Object.keys(cache).sort((a, b) => Number(a) - Number(b));
  const body = keys
    .map((id) => {
      const shots = (cache[id]?.screenshots || []).map((u) => '"' + escJs(u) + '"').join(",");
      return '"' + id + '":{"screenshots":[' + shots + "]}";
    })
    .join(",");
  fs.writeFileSync(filePath, "const STEAM_ABOUT_CACHE={" + body + "};\n", "utf8");
}

function collectSteamIds(catalog, items) {
  const ids = new Set();
  for (const g of catalog || []) {
    if (g.steamId) ids.add(String(g.steamId));
  }
  for (const item of items || []) {
    const m = String(item.linkSteam || "").match(/\/app\/(\d+)/);
    if (m) ids.add(m[1]);
  }
  return [...ids];
}

async function syncSteamMetadata(catalog, items, siteDir, options) {
  const opts = options || {};
  const detailsPath = path.join(siteDir, "js", "steam-details-cache.js");
  const aboutPath = path.join(siteDir, "js", "steam-about-cache.js");
  const detailsCache = loadJsCache(detailsPath, "STEAM_DETAILS_CACHE");
  const aboutCache = loadJsCache(aboutPath, "STEAM_ABOUT_CACHE");
  const delayMs = Number(opts.delayMs || 400);
  const maxFetch = Number(opts.maxFetch || 40);

  const linkFill = propagateSteamLinks(items);
  for (const item of items || []) {
    const game = catalog.find((g) => g.name === item.game);
    if (game) syncGameSteamAssets(game, item.linkSteam);
  }

  const ids = collectSteamIds(catalog, items);
  const missing = ids.filter((id) => !detailsCache[id] || !aboutCache[id]?.screenshots?.length);
  let fetched = 0;
  const log = [];

  for (const id of missing.slice(0, maxFetch)) {
    const data = await fetchSteamAppDetails(id);
    if (!data) {
      log.push("Steam " + id + ": sin datos API");
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    detailsCache[id] = {
      description: data.description || detailsCache[id]?.description || "",
      min: data.min || detailsCache[id]?.min || "",
      rec: data.rec || detailsCache[id]?.rec || "",
    };
    if (data.screenshots?.length) aboutCache[id] = { screenshots: data.screenshots };
    for (const game of catalog) {
      if (String(game.steamId) !== id) continue;
      game.steamDetails = {
        description: detailsCache[id].description || "",
        min: detailsCache[id].min || "",
        rec: detailsCache[id].rec || "",
      };
    }
    fetched++;
    log.push("Steam " + id + ": OK (" + (data.screenshots?.length || 0) + " capturas)");
    await new Promise((r) => setTimeout(r, delayMs));
  }

  finalizeCatalogGames(catalog);
  if (!opts.dryRun) {
    writeDetailsCache(detailsPath, detailsCache);
    writeAboutCache(aboutPath, aboutCache);
  }
  return { linkFill, fetched, missing: missing.length, log };
}

module.exports = {
  loadCatalog,
  saveCatalog,
  catalogToJs,
  findCatalogVersion,
  ensureCatalogGame,
  ensureCatalogVersion,
  steamAssetsFromLink,
  propagateSteamLinks,
  syncGameSteamAssets,
  trimDeliveryOptions,
  finalizeCatalogGames,
  syncSteamMetadata,
};