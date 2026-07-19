"use strict";
const fs = require("fs");
const path = require("path");

const site = path.join(__dirname, "..");
const guia = JSON.parse(fs.readFileSync(path.join(site, "guia-compras.json"), "utf8"));
const data = JSON.parse(fs.readFileSync(path.join(site, "kinguin-price-data.json"), "utf8"));

const badGuia = guia.items.filter((x) => {
  if (x.verificado !== "SI") return false;
  const calc = (x.ventaTransferArs || 0) - (x.compraArs || 0);
  return x.gananciaArs <= 100 || x.gananciaArs !== calc;
});

const badItems = data.items.filter((i) => {
  if (i.hidden || !i.supplyVerified || !i.ventaPublicada) return false;
  const g = i.ventaPublicada - i.compraArs;
  return g <= 100;
});

console.log("guia mismatches", badGuia.length);
badGuia.slice(0, 15).forEach((x) =>
  console.log(x.gananciaArs, x.ventaTransferArs - x.compraArs, x.juego, x.version)
);
console.log("items low profit", badItems.length);
badItems.slice(0, 15).forEach((i) =>
  console.log(i.ventaPublicada - i.compraArs, i.fullName, i.compraArs, i.ventaPublicada)
);

const xlCandidates = [
  path.join(site, "GAMES LIST - AUTO.xlsx"),
  path.join(site, "GAMES LIST - AUTO - salida.xlsx"),
  path.join(site, "guia-compras.xlsx"),
  path.join(process.env.USERPROFILE || "", "Desktop", "GAMES LIST - AUTO.xlsx"),
];
for (const xl of xlCandidates) {
  console.log(xl, fs.existsSync(xl) ? "exists" : "missing");
}
