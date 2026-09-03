import { recalculateFormula } from "./index.js";

/** Multi-serving: per-portion must scale by servingSize, not packageWeight. */
const multi = recalculateFormula({
  formulaType: "Solido",
  packageWeight: 300,
  servingSize: 30,
  lines: [
    {
      source: "BD",
      name: "Proteína",
      percent: 100,
      per100g: { proteina: 50, energiaKcal: 400 },
    },
  ],
});

const prot = multi.nutrients.find((n) => n.id === "proteina");
if (!prot || prot.perServing !== 15) {
  throw new Error(
    `expected perServing protein 15g (50*30/100), got ${prot?.perServing}`,
  );
}

const single = recalculateFormula({
  formulaType: "Solido",
  packageWeight: 30,
  servingSize: 30,
  lines: [
    {
      source: "BD",
      name: "Proteína",
      percent: 100,
      per100g: { proteina: 50 },
    },
  ],
});
const prot2 = single.nutrients.find((n) => n.id === "proteina");
if (!prot2 || prot2.perServing !== 15) {
  throw new Error(`single-serving mismatch: ${prot2?.perServing}`);
}

console.log("[nutrition-engine] serving scale ok", {
  multiServing: prot.perServing,
  singleServing: prot2.perServing,
});
