"use strict";

const MIN_PROFIT_ARS = 15000;
const MAX_PROFIT_ARS = 35000;
const CUOTAS_FACTOR = 1.44;
const CODE_PREMIUM_FLOOR = 8000;
const CODE_PREMIUM_PERCENT = 0.15;
/** Cuenta: ~35% menos que Steam */
const STEAM_MULT_ACCOUNT = 0.65;
/** CD Key: ~25% menos que Steam */
const STEAM_MULT_CODE = 0.75;
/** Cuanto del espacio piso-techo se captura como ganancia extra */
const CAPTURE_RATE = 0.6;

function isAccountItem(item) {
  const text = `${item.fullName || ""} ${item.variant || ""}`;
  return /account|cuenta/i.test(text);
}

function editionKey(item) {
  const variant = String(item.variant || item.fullName || "");
  return variant
    .replace(/\s*-\s*Cuenta\b.*/i, "")
    .replace(/\s*-\s*CD Key\b.*/i, "")
    .replace(/\s*-\s*Codigo\b.*/i, "")
    .trim();
}

function groupKey(item) {
  return `${item.game || ""}::${editionKey(item)}`;
}

function profitFromItem(item) {
  const compra = Number(item.compraArs) || 0;
  const venta = Number(item.ventaPublicada) || 0;
  return Math.max(0, venta - compra);
}

function cuotasFromVenta(venta) {
  return Math.round(Number(venta) * CUOTAS_FACTOR);
}

function priceFloor(compra) {
  return Math.round((Number(compra) || 0) + MIN_PROFIT_ARS);
}

function priceCap(compra) {
  return Math.round((Number(compra) || 0) + MAX_PROFIT_ARS);
}

function clampVenta(compra, venta, steamPrice, isAccount) {
  const floor = priceFloor(compra);
  const cap = priceCap(compra);
  const ceiling = steamCeiling(steamPrice, isAccount);
  let v = Math.round(Number(venta) || 0);
  v = Math.min(v, cap);
  if (ceiling != null && ceiling > floor) {
    v = Math.min(v, ceiling);
  }
  return Math.max(floor, v);
}

function steamCeiling(steamPrice, isAccount) {
  const s = Number(steamPrice) || 0;
  if (s <= 0) return null;
  const mult = isAccount ? STEAM_MULT_ACCOUNT : STEAM_MULT_CODE;
  return Math.round(s * mult);
}

function smartVenta(compra, steamPrice, isAccount) {
  const floor = priceFloor(compra);
  const cap = priceCap(compra);
  const ceiling = steamCeiling(steamPrice, isAccount);
  if (ceiling == null) {
    return { venta: Math.min(cap, floor), note: "sin_steam" };
  }
  if (ceiling <= floor) {
    return { venta: Math.min(floor, cap), note: "compra_alta" };
  }
  const effectiveCeiling = Math.min(ceiling, cap);
  const room = effectiveCeiling - floor;
  const venta = Math.round(floor + room * CAPTURE_RATE);
  return { venta: Math.max(floor, Math.min(venta, effectiveCeiling)), note: "" };
}

function codePremiumFromAccount(accountVenta, excelPremium) {
  const pct = Math.round(Number(accountVenta) * CODE_PREMIUM_PERCENT);
  const excel = Number(excelPremium) || 0;
  return Math.max(CODE_PREMIUM_FLOOR, pct, excel > CODE_PREMIUM_FLOOR ? excel : 0);
}

function publishResult(compra, venta, note) {
  const c = Number(compra) || 0;
  const floor = priceFloor(c);
  const v = Math.max(floor, Math.round(Number(venta) || 0));
  return {
    hidden: false,
    reason: note || "",
    venta: v,
    cuotas: cuotasFromVenta(v),
    ganancia: Math.max(0, v - c),
  };
}

function isProfitableVenta(compra, venta) {
  const c = Number(compra) || 0;
  const v = Number(venta) || 0;
  return c > 0 && v >= c + MIN_PROFIT_ARS;
}

function canPublish(compra, venta) {
  const c = Number(compra) || 0;
  const v = Number(venta) || 0;
  if (v < c + MIN_PROFIT_ARS) return { ok: false, reason: "ganancia_minima" };
  return { ok: true, reason: "" };
}

function computePremiumsFromExcel(items) {
  const groups = new Map();
  for (const item of items) {
    const key = groupKey(item);
    if (!groups.has(key)) groups.set(key, { account: null, code: null });
    const g = groups.get(key);
    const excelVenta = Number(item.excelVenta) || Number(item.ventaPublicada) || 0;
    const slot = isAccountItem(item) ? "account" : "code";
    g[slot] = excelVenta;
  }
  const premiums = new Map();
  for (const [key, g] of groups) {
    if (g.account > 0 && g.code > g.account) {
      premiums.set(key, g.code - g.account);
    }
  }
  return premiums;
}

function applyGroupPricing(items) {
  const premiums = computePremiumsFromExcel(items);
  const groups = new Map();

  for (const item of items) {
    const key = groupKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const results = new Map();

  for (const [, groupItems] of groups) {
    const steamPrice = Number(groupItems.find((x) => Number(x.precioSteamArs) > 0)?.precioSteamArs) || 0;
    const accounts = groupItems.filter(isAccountItem);
    const codes = groupItems.filter((x) => !isAccountItem(x));
    const key = groupKey(groupItems[0]);
    const excelPremium = premiums.get(key);

    let accountVenta = null;

    for (const item of accounts) {
      const compra = Number(item.compraArs) || 0;
      const { venta, note } = smartVenta(compra, steamPrice, true);
      const finalVenta = clampVenta(compra, venta, steamPrice, true);
      results.set(item, publishResult(compra, finalVenta, note));
      accountVenta = accountVenta == null ? finalVenta : Math.max(accountVenta, finalVenta);
    }

    for (const item of codes) {
      const compra = Number(item.compraArs) || 0;
      const { venta: smartPrice, note } = smartVenta(compra, steamPrice, false);
      let venta = Math.max(smartPrice, priceFloor(compra));
      if (accountVenta != null) {
        const prem = codePremiumFromAccount(accountVenta, excelPremium);
        venta = Math.max(venta, accountVenta + prem);
      }
      venta = clampVenta(compra, venta, steamPrice, false);
      results.set(item, publishResult(compra, venta, note));
    }

    for (const item of groupItems.filter((x) => !accounts.includes(x) && !codes.includes(x))) {
      const compra = Number(item.compraArs) || 0;
      const isAcct = isAccountItem(item);
      const { venta, note } = smartVenta(compra, steamPrice, isAcct);
      const finalVenta = clampVenta(compra, venta, steamPrice, isAcct);
      results.set(item, publishResult(compra, finalVenta, note));
    }
  }

  return results;
}

function mergeExcelSteamPrices(items, excelByFullName) {
  for (const item of items) {
    const row = excelByFullName && excelByFullName.get ? excelByFullName.get(item.fullName) : null;
    if (row && Number(row.venta) > 0) {
      item.excelVenta = Number(row.venta);
    }
    if (!item.excelVenta && Number(item.ventaPublicada) > 0) {
      item.excelVenta = Number(item.ventaPublicada);
    }
  }
}

function excelMapFromItems(items) {
  const map = new Map();
  for (const item of items) {
    if (Number(item.precioSteamArs) > 0 || Number(item.excelVenta) > 0) {
      map.set(item.fullName, {
        precioSteam: Number(item.precioSteamArs) || 0,
        venta: Number(item.excelVenta) || Number(item.ventaPublicada) || 0,
      });
    }
  }
  return map;
}

function priceChanged(before, after, threshold = 1) {
  return Math.abs(Number(before) - Number(after)) >= threshold;
}

module.exports = {
  MIN_PROFIT_ARS,
  MAX_PROFIT_ARS,
  CUOTAS_FACTOR,
  CODE_PREMIUM_FLOOR,
  CODE_PREMIUM_PERCENT,
  STEAM_MULT_ACCOUNT,
  STEAM_MULT_CODE,
  CAPTURE_RATE,
  isAccountItem,
  editionKey,
  groupKey,
  canPublish,
  isProfitableVenta,
  applyGroupPricing,
  mergeExcelSteamPrices,
  excelMapFromItems,
  priceChanged,
  cuotasFromVenta,
  smartVenta,
  priceFloor,
  priceCap,
  clampVenta,
  steamCeiling,
};
