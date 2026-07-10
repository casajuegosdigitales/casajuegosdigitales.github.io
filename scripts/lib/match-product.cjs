"use strict";

const REGION_OK = /\b(latam|latin america|argentina|global|worldwide|row|rest of world)\b/i;
const REGION_BAD = /\b(eu|europe|european|turkey|turkish|\btr\b|russia|\bru\b|cis|china|\bcn\b|asia|japan|\bjp\b|vpn|random\s+\d*\s*key|random key|try to get|try-to-get|can only be activated)\b/i;
const NOISE = /\b(dlc|season pass|soundtrack|artbook|wallpaper|coin|points|subscription|gift card|top.?up|robux|nitro|separate ways|upgrade|expansion pass)\b/i;
const JUNK_LISTING = /\b(try to get|try-to-get|random\s+\d*\s*key|random\s*steam\s*key|loot\s*box|mystery\s*box|gamble|50\/50)\b/i;
const SUBSCRIPTION_LISTING =
  /\beneba plus\b|\bdriffle plus\b|\bkinguin smart\b|\bsmart price\b|\bmembers?\s*only\b|\bsubscribers?\s*only\b|\bwith\s+(?:an?\s+)?subscription\b|\bplus\s*exclusive\b|\brequires?\s+plus\b/i;
const ADDON_LISTING = /\b(upgrade\s*dlc|upgrade\s*pack|upgrade\s*only|requires?\s+(the\s+)?base|base\s+game\s+required|season\s*pass|character\s*pass|year\s*\d+\s*(character\s*)?pass|starter\s*pack|expansion\s*pass|separate\s*ways|dlc\s*pack|dlc\s*only|add[\s-]?on\s*pack)\b/i;
const TOKEN_STOP = /^(pc|steam|the|and|for|edition|key|account|latam|global|digital|download|cd|edicion|estandar|standard|cuenta|rockstar|ubisoft|connect|app|games|bundle|pack)$/;
const ACTIVATION_BLOCK =
  /cannot be activated in argentin|not available in argentin|will not work in argentin|restricted to(?:[^\n.]{0,50})?(?:eu|europe|turkey|russia|united states)|\b(?:eu|europe|european|turkey|turkish|russia|united states|north america)\s+only\b|\bonly\s+(?:works\s+)?in\s+(?:the\s+)?(?:eu|europe|turkey|russia|usa|us)\b/i;
const ACTIVATION_ALLOW =
  /\b(?:can be )?activat(?:ed|able|ion)?\s+in:?\s*argentin|\bargentina\b|\blatam\b|latin america|south america|\(latin america\)|\bglobal\b|\bworldwide\b|\brow\b|rest of world/i;
const WRONG_GAME_BLOCK = [
  { game: /resident evil 4|\bre4\b/i, block: /\brequiem\b/i },
  { game: /resident evil requiem|\brequiem\b/i, block: /\b(?:resident evil 4|\bre4\b(?!.*requiem))/i },
  { game: /\bdayz\b/i, block: /\bday of infamy|nice day for fishing\b/i },
  { game: /\bborderlands\s*4\b/i, block: /\bclaptrap|headhunter|robot revolution\b/i },
];
const LISTING_EXTRA_MARKERS = [
  { marker: /\bnightreign\b/i, itemNeeds: /\bnightreign\b/i },
  { marker: /\bday of infamy\b/i, itemNeeds: /\bday of infamy\b/i },
  { marker: /\bnice day for fishing\b/i, itemNeeds: /\bnice day for fishing\b/i },
  { marker: /\bcool edition\b/i, itemNeeds: /\bcool\b/i },
  { marker: /\bclaptrap|headhunter|robot revolution\b/i, itemNeeds: /\bclaptrap|headhunter|robot revolution\b/i },
  { marker: /\bdigital deluxe\b/i, itemNeeds: /\bdigital deluxe\b/i },
  { marker: /\bzombies deluxe\b/i, itemNeeds: /\bzombies deluxe\b/i },
  { marker: /\btoty edition\b/i, itemNeeds: /\btoty\b/i },
  { marker: /\bworld'?s game edition\b/i, itemNeeds: /\bworld'?s game\b/i },
];

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAccountName(text) {
  return /account|cuenta/i.test(String(text || ""));
}

function isCodeName(text) {
  return /cd key|cdkey|steam key|digital download|download key|\bkey\b/i.test(String(text || "")) && !isAccountName(text);
}

function deliveryTypeFromItem(item) {
  if (item.tipo) return /cuenta|account/i.test(item.tipo) ? "account" : "code";
  const t = `${item.fullName || ""} ${item.variant || ""}`;
  return isAccountName(t) ? "account" : "code";
}

function isJunkListing(name, link) {
  const text = `${name || ""} ${link || ""}`;
  if (JUNK_LISTING.test(text)) return true;
  if (/try-to-get-/i.test(String(link || ""))) return true;
  return false;
}

function isSubscriptionListing(name, link) {
  return SUBSCRIPTION_LISTING.test(`${name || ""} ${link || ""}`);
}

function itemTargetText(item) {
  return `${item.game || ""} ${item.edition || ""} ${item.tipo || ""} ${item.fullName || ""} ${item.variant || ""}`.toLowerCase();
}

function itemWantsAddonProduct(item) {
  const t = itemTargetText(item);
  return ADDON_LISTING.test(t) || /\b(season pass|character pass|expansion pass|starter pack|dlc)\b/i.test(t);
}

function isAddonOnlyListing(name, link) {
  const text = `${name || ""} ${link || ""}`.toLowerCase();
  const href = String(link || "").toLowerCase();
  if (/upgrade-dlc|upgrade-dlc-|-upgrade-dlc-/.test(href)) return true;
  if (ADDON_LISTING.test(text)) return true;
  if (/\bupgrade\b/.test(text) && /\b(dlc|edition)\b/.test(text)) return true;
  if (/-[\w-]*-dlc(?:-|$)/.test(href) && !/\bbundle\b/.test(text)) return true;
  return false;
}

function isDisallowedAddonMatch(item, name, link) {
  if (!isAddonOnlyListing(name, link)) return false;
  if (itemWantsAddonProduct(item)) return false;
  return true;
}

function regionOk(name) {
  const n = String(name || "");
  if (isJunkListing(n, "")) return false;
  if (REGION_BAD.test(n)) return false;
  if (/\bLATAM\b/i.test(n)) return true;
  if (/\bArgentina\b/i.test(n)) return true;
  if (/\bGlobal\b/i.test(n) && !/\bEU\b/i.test(n)) return true;
  if (isAccountName(n)) return true;
  if (/Steam CD Key|PC Steam CD Key|Rockstar|EA App|Ubisoft/i.test(n) && !REGION_BAD.test(n)) return true;
  return REGION_OK.test(n);
}

function checkActivationRegion(text, opts) {
  const t = String(text || "").replace(/\s+/g, " ");
  if (!t.trim()) return { ok: null, label: "sin_datos", unknown: true };
  if (ACTIVATION_BLOCK.test(t)) return { ok: false, label: "no_argentina", unknown: false };
  if (ACTIVATION_ALLOW.test(t)) {
    let label = "global";
    if (/\bargentin|\blatam\b|latin america|\(latin america\)/i.test(t)) label = "AR/LATAM";
    else if (/\bglobal\b|\bworldwide\b|\brow\b/i.test(t)) label = "global";
    return { ok: true, label, unknown: false };
  }
  if (opts && opts.isAccount) return { ok: true, label: "cuenta", unknown: false };
  return { ok: null, label: "sin_confirmar", unknown: true };
}

function regionOkForArgentina(text, opts) {
  const o = opts || {};
  const check = checkActivationRegion(text, o);
  if (check.ok === true) return check;
  if (check.ok === false) return check;
  if (o.trustStoreLocale) return { ok: true, label: o.trustLabel || "tienda_AR", unknown: false };
  if (!o.wantsLatam) {
    if (regionOk(text)) return { ok: true, label: "titulo", unknown: false };
    return check;
  }
  return check;
}

function editionMarkersInItem(item) {
  const t = itemTargetText(item);
  const markers = [];
  if (/\bgold\b/i.test(t) && !/gold edition\s*&/i.test(t)) markers.push("gold");
  if (/\bdeluxe\b/i.test(t)) markers.push("deluxe");
  if (/\bultimate\b/i.test(t)) markers.push("ultimate");
  if (/\bphantom\b/i.test(t)) markers.push("phantom");
  if (/\bpremium\b/i.test(t)) markers.push("premium");
  if (/\bvault\b/i.test(t)) markers.push("vault");
  if (/\bcomplete\b/i.test(t)) markers.push("complete");
  if (/\bgoty\b/i.test(t)) markers.push("goty");
  if (/\bremastered\b/i.test(t)) markers.push("remastered");
  if (/\brequiem\b/i.test(t)) markers.push("requiem");
  if (/\bicons\b/i.test(t)) markers.push("icons");
  if (/\btoty\b/i.test(t)) markers.push("toty");
  if (/\b(?:standard|estandar)\b/i.test(t) && !markers.length) markers.push("standard");
  return markers;
}

function editionMarkersMatch(item, name) {
  const required = editionMarkersInItem(item);
  const n = String(name || "").toLowerCase();
  for (const m of required) {
    if (m === "standard") {
      if (/\b(gold|deluxe|ultimate|phantom|premium|vault|complete|goty|remastered|requiem)\b/i.test(n)) return false;
      continue;
    }
    if (!new RegExp("\\b" + m + "\\b", "i").test(n)) return false;
  }
  const game = String(item.game || item.fullName || "");
  for (const rule of WRONG_GAME_BLOCK) {
    if (rule.game.test(game) && rule.block.test(n)) return false;
  }
  return true;
}

function wrongGameListing(item, name) {
  return !editionMarkersMatch(item, name);
}

function normalizeForSearch(text) {
  return String(text || "")
    .replace(/™/g, "")
    .replace(/[''´`]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForStoreQuery(text) {
  return String(text || "")
    .replace(/™/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function editionFromVariant(item) {
  let v = normalizeForStoreQuery(item.variant || "");
  v = v.replace(/\s*-\s*(Cuenta|CD Key|Account|Key).*$/i, "").trim();
  v = v.replace(/\b(Cuenta Steam|CD Key|Steam Account|Account)\b.*$/i, "").trim();
  v = v.replace(/\((Steam|Rockstar|Ubisoft|EA App|Epic Games)[^)]*\)/gi, "").trim();
  if (/^(Edicion estandar|Standard Edition|Edición estándar)$/i.test(v)) return "";
  return v;
}

function buildStoreSearchQueries(item) {
  const game = normalizeForStoreQuery(item.game || "");
  const edition = editionFromVariant(item);
  const queries = new Set();
  if (game && edition) queries.add(`${game} ${edition}`);
  if (game) queries.add(game);
  if (edition && !game) queries.add(edition);
  return [...queries].filter(Boolean);
}

function buildSearchQueries(item) {
  return buildStoreSearchQueries(item);
}

function buildExpandedSearchQueries(item) {
  const game = normalizeForStoreQuery(item.game || "");
  const edition = editionFromVariant(item);
  const queries = new Set(buildStoreSearchQueries(item));
  if (game && edition) {
    queries.add(`${game} ${edition} PC`);
  }
  if (game) queries.add(`${game} PC`);
  return [...queries].filter(Boolean);
}

function tokenize(text) {
  return normalizeForSearch(text)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => {
      if (/^\d+$/.test(w) || /^[ivxlcdm]+$/i.test(w)) return true;
      return w.length > 2 && !TOKEN_STOP.test(w);
    });
}

function tokenPresent(token, nameTokens, fullText) {
  const text = String(fullText || "");
  const boundary = new RegExp("\\b" + escapeRegex(token) + "\\b", "i");
  if (boundary.test(text)) return true;
  if (token.length >= 4) {
    return nameTokens.some((nt) => nt === token || (nt.length >= 4 && (nt.includes(token) || token.includes(nt))));
  }
  return nameTokens.some((nt) => nt === token);
}

function requiredGameTokens(item) {
  return tokenize(item.game || item.fullName || "");
}

function variantAnchorTokens(item) {
  const edition = editionFromVariant(item);
  if (edition) return tokenize(edition);
  return [];
}

function allRequiredTokensMatch(item, name, link) {
  const fullText = `${name || ""} ${link || ""}`;
  const nameTokens = tokenize(name);
  const required = [...requiredGameTokens(item), ...variantAnchorTokens(item)];
  const unique = [...new Set(required.filter((t) => !TOKEN_STOP.test(t)))];
  if (!unique.length) return true;
  return unique.every((t) => tokenPresent(t, nameTokens, fullText));
}

function normalizeGameSlug(text) {
  return normalizeForSearch(text)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function slugMatchesGame(item, link) {
  const href = String(link || "").toLowerCase();
  if (!href || !/driffle\.com|kinguin\.net|loaded\.com|eneba\.com/.test(href)) return true;
  if (/kinguin\.net\/(?:[a-z]{2}\/)?category\/0\/product(?:\?|$)/i.test(href)) return true;
  const gameSlug = normalizeGameSlug(item.game || "");
  if (gameSlug && href.includes(gameSlug)) return true;
  const edition = editionFromVariant(item);
  if (edition) {
    const edSlug = normalizeGameSlug(edition);
    if (edSlug && !href.includes(edSlug) && !href.includes(edSlug.replace(/-edition$/, ""))) {
      return false;
    }
  }
  const parts = gameSlug.split("-").filter((p) => p.length > 2 || /^\d+$/.test(p));
  if (!parts.length) return true;
  return parts.every((p) => href.includes(p));
}

function gameNumberMatch(item, name, link) {
  const game = String(item.game || "").trim();
  const m = game.match(/^(.+?)\s+(\d+)$/);
  if (!m) return true;
  const base = m[1].trim();
  const num = m[2];
  const text = `${name || ""} ${link || ""}`.toLowerCase();
  const baseNorm = normalizeForSearch(base).toLowerCase();
  const slugBase = normalizeGameSlug(base);
  const patterns = [
    new RegExp(escapeRegex(baseNorm) + "[\\s:.-]*" + num + "\\b", "i"),
    new RegExp(escapeRegex(slugBase) + "[\\s.-]*" + num + "\\b", "i"),
  ];
  return patterns.some((p) => p.test(text));
}

function gameIdentityMatch(item, name, link) {
  const fullText = `${name || ""} ${link || ""}`;
  const game = String(item.game || "").trim();
  if (!game) return true;
  const gameNorm = normalizeForSearch(game).toLowerCase();
  const parts = gameNorm.split(/\s+/).filter(Boolean);
  const nameTokens = tokenize(name);
  if (parts.length === 1) {
    if (!tokenPresent(parts[0], nameTokens, fullText)) return false;
  } else {
    for (const part of parts) {
      if (!tokenPresent(part, nameTokens, fullText)) return false;
    }
  }
  if (!gameNumberMatch(item, name, link)) return false;
  if (!slugMatchesGame(item, link)) return false;
  for (const rule of WRONG_GAME_BLOCK) {
    if (rule.game.test(game) && rule.block.test(String(name || ""))) return false;
  }
  return true;
}

function listingHasForbiddenExtras(item, name) {
  const itemText = itemTargetText(item);
  const listing = String(name || "");
  for (const rule of LISTING_EXTRA_MARKERS) {
    if (rule.marker.test(listing) && !rule.itemNeeds.test(itemText)) return true;
  }
  return false;
}

function deliveryTypeMatches(item, name, link) {
  const want = deliveryTypeFromItem(item);
  const href = String(link || "").toLowerCase();
  const text = `${name || ""} ${href}`.toLowerCase();
  const linkAccount = /steam-account|pc-steam-account|-account-p\d|\/account/i.test(href);
  const linkCode = /digital-key|cd-key|cdkey|steam-key|-key-p\d|\/key/i.test(href);
  const nameAccount = isAccountName(name);
  const nameCode = isCodeName(name);
  if (want === "account") {
    if (linkCode && !linkAccount) return false;
    if (nameCode && !nameAccount) return false;
  }
  if (want === "code") {
    if (linkAccount && !linkCode) return false;
    if (nameAccount && !nameCode) return false;
    if (/steam[-\s]gift|steam gift/i.test(text) && !/digital key|cd key|cdkey/i.test(text)) return false;
    if (/-steam-gift-/i.test(href) && !/digital-key|cd-key|-key-p/i.test(href)) return false;
  }
  if (want === "code" && /steam account/i.test(text) && !/cd key|digital key|digital download/i.test(text)) {
    return false;
  }
  if (want === "account" && /cd key|digital key|digital download/i.test(text) && !/account|cuenta/i.test(text)) {
    return false;
  }
  return true;
}

function listingMatchesItem(item, name, link) {
  if (!name) return false;
  if (isSubscriptionListing(name, link)) return false;
  if (isJunkListing(name, link)) return false;
  if (isDisallowedAddonMatch(item, name, link)) return false;
  if (!gameIdentityMatch(item, name, link)) return false;
  if (!deliveryTypeMatches(item, name, link)) return false;
  if (!editionMarkersMatch(item, name)) return false;
  if (listingHasForbiddenExtras(item, name)) return false;
  if (!allRequiredTokensMatch(item, name, link)) return false;
  return true;
}

function gameTokens(item) {
  const base = item.game || item.fullName || "";
  return tokenize(base);
}

function tokenOverlap(tokens, name, link) {
  const fullText = `${name || ""} ${link || ""}`;
  const nTokens = tokenize(name);
  if (!tokens.length || !nTokens.length) return 0;
  let hit = 0;
  for (const t of tokens) {
    if (tokenPresent(t, nTokens, fullText)) hit++;
  }
  return hit / tokens.length;
}

function platformFromItem(item) {
  const t = `${item.fullName || ""} ${item.variant || ""}`;
  if (/Rockstar/i.test(t)) return "rockstar";
  if (/EA App/i.test(t)) return "ea";
  if (/Ubisoft Connect/i.test(t)) return "ubisoft";
  if (/Epic Games/i.test(t)) return "epic";
  if (/Battle\.net/i.test(t)) return "battlenet";
  if (/Xbox/i.test(t)) return "xbox";
  if (/PlayStation|PSN/i.test(t)) return "psn";
  if (/Nintendo/i.test(t)) return "nintendo";
  return "steam";
}

function platformMatch(name, platform, link) {
  const n = String(name || "").toLowerCase();
  const href = String(link || "").toLowerCase();
  if (/xbox|playstation|\bpsn\b|nintendo|epic-games|rockstar|ea-app|ubisoft|battle-net/i.test(n + " " + href)) {
    if (platform === "xbox") return /xbox/i.test(n + " " + href);
    if (platform === "psn") return /playstation|\bpsn\b/i.test(n + " " + href);
    if (platform === "nintendo") return /nintendo|switch/i.test(n + " " + href);
    if (platform !== "xbox" && platform !== "psn" && platform !== "nintendo") return false;
  }
  const map = {
    steam: /steam/i,
    rockstar: /rockstar/i,
    ea: /ea app|\bea\b/i,
    ubisoft: /ubisoft/i,
    epic: /epic games|\bepic\b/i,
    battlenet: /battle\.net/i,
    xbox: /xbox/i,
    psn: /playstation|\bpsn\b/i,
    nintendo: /nintendo|\bswitch\b/i,
  };
  const re = map[platform] || /steam/i;
  if (re.test(n) || re.test(href)) return true;
  if (platform === "steam" && /-steam-|\/steam|pc-steam|steam-/i.test(href)) return true;
  if (platform === "steam" && /\bpc\b|\(latin america\)|\(global\)/i.test(n) && !/xbox|playstation|nintendo|epic|rockstar|ubisoft|\bea app\b/i.test(n)) return true;
  return false;
}

function wantsLatam(item) {
  if (item.latam != null) return Boolean(item.latam);
  return /\bLATAM\b|Latin America/i.test(`${item.fullName || ""} ${item.variant || ""}`);
}

function scoreCandidate(item, candidate) {
  const wantAccount = deliveryTypeFromItem(item) === "account";
  const name = String(candidate.name || candidate.title || "");
  const link = candidate.link || "";
  const target = normalizeForSearch(item.fullName || "").toLowerCase();
  const n = name.toLowerCase();
  const tokens = gameTokens(item);
  const overlap = tokenOverlap(tokens, name, link);

  if (!listingMatchesItem(item, name, link)) return 0;
  if (overlap < 0.65) return 0;

  const plat = platformFromItem(item);
  if (!platformMatch(name, plat, link)) return 0;

  let score = Math.round(overlap * 50);
  const isAcc = isAccountName(name);
  const isCode = isCodeName(name);
  if (wantAccount && isAcc) score += 35;
  if (!wantAccount && isCode) score += 35;
  if (wantAccount && isCode) return 0;
  if (!wantAccount && isAcc) return 0;
  if (platformMatch(name, plat, link)) score += 20;
  if (regionOk(name)) score += 15;
  else if (!wantsLatam(item)) score -= 40;
  if (n === target) score += 30;
  if (target && n.includes(target.slice(0, Math.min(24, target.length)))) score += 15;

  const targetHasNoise = NOISE.test(item.fullName || "");
  if (!targetHasNoise && NOISE.test(name)) score -= 50;

  return score;
}

function filterCandidates(item, candidates) {
  return candidates
    .map((c) => ({ ...c, _score: scoreCandidate(item, c) }))
    .filter((c) => c._score >= 55)
    .sort((a, b) => b._score - a._score || (a.priceArs || 0) - (b.priceArs || 0));
}

const PLATFORM_LABELS = {
  steam: "Steam",
  ubisoft: "Ubisoft Connect",
  ea: "EA App",
  rockstar: "Rockstar",
  epic: "Epic Games",
  battlenet: "Battle.net",
};

function editionBase(variant) {
  return String(variant || "")
    .replace(/\s*-\s*(Cuenta|CD Key|Account).*$/i, "")
    .trim();
}

function gameWithEdition(game, edition) {
  const ed = edition || "Edicion estandar";
  if (/^edicion estandar$/i.test(ed.trim())) return game;
  return `${game} ${ed}`;
}

function buildVariantItem(template, platformKey, wantType, opts) {
  const edition = editionBase(template.variant) || "Edicion estandar";
  const game = template.game;
  const plat = PLATFORM_LABELS[platformKey] || "Steam";
  const latam = opts?.latam || /latam/i.test(template.fullName || template.variant || "");
  const nameBase = gameWithEdition(game, edition);

  if (wantType === "account") {
    const variant = `${edition} - Cuenta ${plat}`;
    const fullName =
      platformKey === "steam" ? `${nameBase} PC Steam Account` : `${nameBase} PC ${plat} Account`;
    return {
      game,
      variant,
      fullName,
      linkSteam: template.linkSteam || "",
      precioSteamArs: template.precioSteamArs || 0,
      compraArs: 0,
      ventaPublicada: 0,
      cuotasPublicada: 0,
      hidden: false,
      supplyVerified: false,
      _discovered: true,
    };
  }

  const latamTag = latam && platformKey === "steam" ? " LATAM" : "";
  const variant = `${edition} - CD Key${latam && platformKey === "steam" ? " LATAM" : ""} (${plat})`;
  const fullName =
    platformKey === "steam"
      ? `${nameBase}${latamTag} PC Steam CD Key`
      : `${nameBase} PC ${plat} CD Key`;
  return {
    game,
    variant,
    fullName,
    linkSteam: template.linkSteam || "",
    precioSteamArs: template.precioSteamArs || 0,
    compraArs: 0,
    ventaPublicada: 0,
    cuotasPublicada: 0,
    hidden: false,
    supplyVerified: false,
    _discovered: true,
  };
}

function discoverMissingVariants(data) {
  const items = data.items || [];
  const existing = new Set(items.map((i) => i.fullName));
  const toAdd = [];
  const editionGroups = new Map();

  for (const item of items) {
    const k = `${item.game}|${editionBase(item.variant)}`;
    if (!editionGroups.has(k)) editionGroups.set(k, []);
    editionGroups.get(k).push(item);
  }

  for (const [, group] of editionGroups) {
    const template =
      group.find((i) => i.linkSteam) ||
      group.find((i) => platformFromItem(i) === "steam") ||
      group[0];
    const latam = group.some((i) => /latam/i.test(`${i.fullName || ""} ${i.variant || ""}`));
    const platformsPresent = new Set(group.map((i) => platformFromItem(i)));
    const platformsToEnsure = new Set(platformsPresent);

    if (template.linkSteam || platformsPresent.has("steam")) {
      platformsToEnsure.add("steam");
    }

    for (const plat of platformsToEnsure) {
      if (plat !== "steam" && platformsPresent.has("steam")) continue;
      for (const wantType of ["account", "code"]) {
        const has = group.some(
          (i) => platformFromItem(i) === plat && deliveryTypeFromItem(i) === wantType
        );
        if (has) continue;
        const built = buildVariantItem(template, plat, wantType, { latam });
        if (!existing.has(built.fullName)) {
          toAdd.push(built);
          existing.add(built.fullName);
        }
      }
    }
  }

  return toAdd;
}

function isSteamItem(item) {
  return platformFromItem(item) === "steam";
}

function hasSteamEditionSibling(item, items) {
  if (isSteamItem(item)) return false;
  const ed = editionBase(item.variant);
  return (items || []).some(
    (row) =>
      row.game === item.game &&
      editionBase(row.variant) === ed &&
      platformFromItem(row) === "steam"
  );
}

function purgeRedundantAltPlatforms(data) {
  const items = data.items || [];
  const keep = [];
  let removed = 0;
  for (const item of items) {
    if (hasSteamEditionSibling(item, items)) {
      removed++;
      continue;
    }
    keep.push(item);
  }
  data.items = keep;
  return removed;
}

function pruneCatalogForSteamFirst(catalog, data) {
  const variantSet = new Set((data.items || []).map((i) => `${i.game}|${i.variant}`));
  for (const game of catalog) {
    game.versions = (game.versions || []).filter((v) => variantSet.has(`${game.name}|${v.name}`));
    const visibleSteam = (game.versions || []).filter(
      (v) => !v.hidden && /steam/i.test(v.name)
    );
    if (visibleSteam.length) game.platform = "Steam - PC";
    const vis = (game.versions || []).filter((v) => !v.hidden);
    game.hidden = vis.length === 0;
  }
}

function isSteamGiftOffer(item, name, link) {
  if (deliveryTypeFromItem(item) !== "code") return false;
  const blob = `${name || ""} ${link || ""}`;
  if (/steam[-\s]gift|steam gift/i.test(blob)) return true;
  if (/-steam-gift-/i.test(String(link || "")) && !/digital-key|digital-code|cd-key|-key-p/i.test(String(link || ""))) {
    return true;
  }
  return false;
}

function winnerListadoName(item) {
  if (item.bestListado) return item.bestListado;
  const q = (item.supplyQuotes || []).find(
    (row) => row.store === item.bestStore && row.link === item.bestLink
  );
  return q?.name || "";
}

function hasValidPublishedSupply(item) {
  if (item.supplyVerified === false) return false;
  if (!item.bestStore || !item.bestLink) return false;
  if ((item.compraArs || 0) <= 0) return false;
  const compra = Number(item.compraArs) || 0;
  const venta = Number(item.ventaPublicada) || 0;
  if (venta > 0) {
    const { MIN_PROFIT_ARS } = require("./pricing.cjs");
    if (venta < compra + MIN_PROFIT_ARS) return false;
  }
  const { isPlaceholderKinguinLink } = require("./kinguin-api.cjs");
  if (item.bestStore === "kinguin" && isPlaceholderKinguinLink(item.bestLink)) return false;
  const name = winnerListadoName(item);
  if (isSteamGiftOffer(item, name, item.bestLink)) return false;
  if (name && !listingMatchesItem(item, name, item.bestLink)) return false;
  return true;
}

function sanitizeInvalidSupplyItems(items) {
  let cleared = 0;
  for (const item of items || []) {
    const hadSupply = Boolean(item.bestStore) && (item.compraArs || 0) > 0;
    if (hadSupply && !hasValidPublishedSupply(item)) {
      item.supplyVerified = false;
      item.bestStore = "";
      item.bestLink = "";
      item.compraArs = 0;
      item.hiddenReason = "listado_invalido";
      cleared++;
    }
    if (!hasValidPublishedSupply(item)) {
      item.ventaPublicada = 0;
      item.cuotasPublicada = 0;
    }
  }
  return cleared;
}

function isPublishableAltPlatform(item) {
  if (isSteamItem(item)) return hasValidPublishedSupply(item);
  return hasValidPublishedSupply(item) && (item.ventaPublicada || 0) > 0;
}

module.exports = {
  platformFromItem,
  platformMatch,
  wantsLatam,
  isAccountName,
  isCodeName,
  isJunkListing,
  isSubscriptionListing,
  isAddonOnlyListing,
  isDisallowedAddonMatch,
  itemWantsAddonProduct,
  deliveryTypeFromItem,
  deliveryTypeMatches,
  regionOk,
  checkActivationRegion,
  regionOkForArgentina,
  editionMarkersMatch,
  editionMarkersInItem,
  wrongGameListing,
  gameIdentityMatch,
  listingHasForbiddenExtras,
  listingMatchesItem,
  buildSearchQueries,
  buildStoreSearchQueries,
  buildExpandedSearchQueries,
  editionFromVariant,
  scoreCandidate,
  filterCandidates,
  tokenize,
  gameTokens,
  allRequiredTokensMatch,
  normalizeForStoreQuery,
  editionBase,
  buildVariantItem,
  discoverMissingVariants,
  isSteamItem,
  isPublishableAltPlatform,
  isSteamGiftOffer,
  hasValidPublishedSupply,
  sanitizeInvalidSupplyItems,
  hasSteamEditionSibling,
  purgeRedundantAltPlatforms,
  pruneCatalogForSteamFirst,
};