import { Router } from "express";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { getLabCapacity, mapExtraPack, mapPlan } from "../lib/quota.js";
import { requireAuth, requireSuperadmin, requireWrite } from "../middleware/auth.js";

export const plansRouter = Router();

plansRouter.get("/v1/plans", async (_req, res) => {
  try {
    const result = await getPool().query(
      `SELECT * FROM plans ORDER BY tables_included ASC`,
    );
    return res.json({ items: result.rows.map(mapPlan) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "list_plans_failed", message });
  }
});

plansRouter.get("/v1/extra-packs", async (_req, res) => {
  try {
    const result = await getPool().query(
      `SELECT * FROM extra_packs ORDER BY tables_count ASC`,
    );
    return res.json({ items: result.rows.map(mapExtraPack) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "list_extra_packs_failed", message });
  }
});

const planPatch = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  tablesIncluded: z.number().int().positive().optional(),
  adminSeats: z.number().int().positive().optional(),
  readersUnlimited: z.boolean().optional(),
  pdfExport: z.boolean().optional(),
  labelPreview: z.boolean().optional(),
  auditLog: z.boolean().optional(),
  highlight: z.boolean().optional(),
  priceMonthly: z.number().int().nonnegative().optional(),
});

plansRouter.patch("/v1/plans/:id", requireAuth, requireSuperadmin, async (req, res) => {
  const parsed = planPatch.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const d = parsed.data;
  try {
    if (d.highlight === true) {
      await getPool().query(`UPDATE plans SET highlight = false WHERE id <> $1`, [req.params.id]);
    }

    const result = await getPool().query(
      `UPDATE plans SET
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        tables_included = COALESCE($4, tables_included),
        admin_seats = COALESCE($5, admin_seats),
        readers_unlimited = COALESCE($6, readers_unlimited),
        pdf_export = COALESCE($7, pdf_export),
        label_preview = COALESCE($8, label_preview),
        audit_log = COALESCE($9, audit_log),
        highlight = COALESCE($10, highlight),
        price_monthly = COALESCE($11, price_monthly),
        updated_at = now()
      WHERE id = $1
      RETURNING *`,
      [
        req.params.id,
        d.name ?? null,
        d.description ?? null,
        d.tablesIncluded ?? null,
        d.adminSeats ?? null,
        d.readersUnlimited ?? null,
        d.pdfExport ?? null,
        d.labelPreview ?? null,
        d.auditLog ?? null,
        d.highlight ?? null,
        d.priceMonthly ?? null,
      ],
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: "not_found" });
    }

    await writeAudit(req, {
      action: "plan.update",
      detail: `${req.params.id} · ${result.rows[0].name}`,
    });

    return res.json(mapPlan(result.rows[0]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "update_plan_failed", message });
  }
});

plansRouter.get("/v1/labs", requireAuth, requireSuperadmin, async (_req, res) => {
  try {
    const labs = await getPool().query(
      `SELECT id, name, status, plan_id, tables_extra, city, renews_at
       FROM labs ORDER BY name ASC`,
    );

    const items = await Promise.all(
      labs.rows.map(async (row) => {
        const capacity = await getLabCapacity(String(row.id));
        const admin = await getPool().query(
          `SELECT name, email FROM users
           WHERE lab_id = $1 AND role = 'lab_admin' AND active = true
           ORDER BY created_at ASC LIMIT 1`,
          [row.id],
        );
        return {
          id: row.id,
          name: row.name,
          status: row.status,
          planId: row.plan_id,
          tablesExtra: Number(row.tables_extra ?? 0),
          city: row.city,
          renewsAt: row.renews_at ? String(row.renews_at).slice(0, 10) : null,
          tablesUsed: capacity?.used ?? 0,
          tablesTotal: capacity?.total ?? 0,
          adminName: admin.rows[0]?.name ?? null,
          adminEmail: admin.rows[0]?.email ?? null,
          capacity,
        };
      }),
    );

    return res.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "list_labs_failed", message });
  }
});

const assignBody = z.object({
  planId: z.string().min(1),
  /** Si se envía, reemplaza tables_extra. Si no, se puede sumar pack. */
  tablesExtra: z.number().int().nonnegative().optional(),
  extraPackId: z.string().optional().nullable(),
  status: z.enum(["activo", "pendiente", "suspendido"]).optional(),
  renewsAt: z.string().optional().nullable(),
  note: z.string().optional(),
});

plansRouter.post(
  "/v1/labs/:id/assign",
  requireAuth,
  requireSuperadmin,
  async (req, res) => {
    const parsed = assignBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    }

    const d = parsed.data;
    const pool = getPool();

    try {
      const plan = await pool.query(`SELECT * FROM plans WHERE id = $1`, [d.planId]);
      if (!plan.rows[0]) {
        return res.status(404).json({ error: "plan_not_found" });
      }

      const lab = await pool.query(`SELECT * FROM labs WHERE id = $1`, [req.params.id]);
      if (!lab.rows[0]) {
        return res.status(404).json({ error: "lab_not_found" });
      }

      let tablesExtra = d.tablesExtra;
      if (tablesExtra === undefined) {
        tablesExtra = Number(lab.rows[0].tables_extra ?? 0);
        if (d.extraPackId) {
          const pack = await pool.query(`SELECT * FROM extra_packs WHERE id = $1`, [
            d.extraPackId,
          ]);
          if (!pack.rows[0]) {
            return res.status(404).json({ error: "extra_pack_not_found" });
          }
          tablesExtra += Number(pack.rows[0].tables_count);
        }
      }

      const renewsAt =
        d.renewsAt === undefined
          ? lab.rows[0].renews_at
          : d.renewsAt;

      const updated = await pool.query(
        `UPDATE labs SET
          plan_id = $2,
          tables_extra = $3,
          status = COALESCE($4, status),
          renews_at = COALESCE($5::date, renews_at),
          updated_at = now()
        WHERE id = $1
        RETURNING *`,
        [
          req.params.id,
          d.planId,
          tablesExtra,
          d.status ?? null,
          renewsAt,
        ],
      );

      await writeAudit(req, {
        labId: String(req.params.id),
        action: "lab.assign_plan",
        detail: [
          `plan=${d.planId}`,
          `extras=${tablesExtra}`,
          d.extraPackId ? `pack=${d.extraPackId}` : null,
          d.note ? `nota=${d.note}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });

      const capacity = await getLabCapacity(String(req.params.id));
      return res.json({
        lab: {
          id: updated.rows[0].id,
          name: updated.rows[0].name,
          status: updated.rows[0].status,
          planId: updated.rows[0].plan_id,
          tablesExtra: Number(updated.rows[0].tables_extra),
          renewsAt: updated.rows[0].renews_at
            ? String(updated.rows[0].renews_at).slice(0, 10)
            : null,
        },
        capacity,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: "assign_plan_failed", message });
    }
  },
);

/** Solicitud de pack extra desde el lab (queda en auditoría; superadmin confirma). */
plansRouter.post("/v1/lab/extra-requests", requireAuth, requireWrite, async (req, res) => {
  const body = z.object({ packId: z.string().min(1), note: z.string().optional() }).safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "invalid_body", details: body.error.flatten() });
  }

  try {
    if (!req.user?.labId) {
      return res.status(403).json({ error: "lab_required" });
    }
    const pack = await getPool().query(`SELECT * FROM extra_packs WHERE id = $1`, [
      body.data.packId,
    ]);
    if (!pack.rows[0]) {
      return res.status(404).json({ error: "extra_pack_not_found" });
    }

    await writeAudit(req, {
      labId: req.user.labId,
      action: "lab.extra_request",
      detail: `${pack.rows[0].name} (+${pack.rows[0].tables_count})${body.data.note ? ` · ${body.data.note}` : ""}`,
    });

    return res.status(201).json({
      ok: true,
      message: "Solicitud registrada. Enerxis la activará tras confirmar el pago.",
      pack: mapExtraPack(pack.rows[0]),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: "extra_request_failed", message });
  }
});
