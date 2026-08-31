/**
 * Smoke: resolveBillingCycle (cupo por ciclo mensual).
 * Run: npx tsx src/lib/quota-cycle.smoke.ts
 */
import {
  addUtcMonths,
  resolveBillingCycle,
  toDateString,
} from "./quota.js";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const now = new Date(Date.UTC(2026, 7, 27)); // 27 ago 2026

{
  const c = resolveBillingCycle("2026-09-15", now);
  assert(c.rolled === false, "futuro no debe rodar");
  assert(toDateString(c.cycleEnd) === "2026-09-15", "fin = renews_at");
  assert(toDateString(c.cycleStart) === "2026-08-15", "inicio = −1 mes");
}

{
  const c = resolveBillingCycle("2026-08-15", now);
  assert(c.rolled === true, "vencido debe rodar");
  assert(toDateString(c.cycleEnd) === "2026-09-15", "avanza un mes");
  assert(toDateString(c.cycleStart) === "2026-08-15", "nuevo inicio");
}

{
  const c = resolveBillingCycle("2026-06-15", now);
  assert(c.rolled === true, "muy vencido");
  assert(toDateString(c.cycleEnd) === "2026-09-15", "avanza hasta futuro");
}

{
  const c = resolveBillingCycle(null, now);
  assert(c.rolled === true, "null fuerza ciclo");
  assert(toDateString(c.cycleEnd) === "2026-09-27", "hoy + 1 mes");
}

{
  const d = addUtcMonths(new Date(Date.UTC(2026, 0, 31)), 1);
  assert(toDateString(d) === "2026-02-28", "31 ene + 1 mes → 28 feb");
}

console.log("quota-cycle.smoke: ok");
