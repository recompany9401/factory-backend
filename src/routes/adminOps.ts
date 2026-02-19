import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { authenticateToken } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/admin";
import { expirePendingReservations } from "../modules/expirePendingReservations";
import { env } from "../utils/env";
import { refundPercentByPolicy } from "../modules/refundPolicy";
import { PaymentStatus } from "@prisma/client";

const router = Router();

async function assertResource(resourceId: string) {
  const r = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { id: true },
  });
  if (!r) throw new Error("RESOURCE_NOT_FOUND");
}

function kstDateOnlyToDate(date: string) {
  return new Date(`${date}T00:00:00+09:00`);
}

function dateToKstYmd(d: Date) {
  const shifted = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

router.post(
  "/pricing-rules",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const schema = z.object({
      resourceId: z.string().uuid(),
      ruleType: z.enum(["DEFAULT", "TIME_RANGE", "DAY_OF_WEEK", "USER_TYPE"]),
      price: z.number().int().min(0),
      isActive: z.boolean().optional().default(true),

      userType: z.enum(["PERSONAL", "BUSINESS"]).optional(),
      dayOfWeek: z.number().int().min(0).max(6).optional(),
      startTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
      endTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: "Invalid body", issues: parsed.error.issues });

    const b = parsed.data;

    try {
      await assertResource(b.resourceId);
    } catch {
      return res.status(404).json({ message: "Resource not found" });
    }

    if (b.ruleType === "TIME_RANGE") {
      if (!b.startTime || !b.endTime)
        return res
          .status(400)
          .json({ message: "TIME_RANGE requires startTime/endTime" });
    }
    if (b.ruleType === "DAY_OF_WEEK") {
      if (b.dayOfWeek === undefined)
        return res
          .status(400)
          .json({ message: "DAY_OF_WEEK requires dayOfWeek" });
    }
    if (b.ruleType === "USER_TYPE") {
      if (!b.userType)
        return res.status(400).json({ message: "USER_TYPE requires userType" });
    }

    const created = await prisma.pricingRule.create({
      data: {
        resourceId: b.resourceId,
        ruleType: b.ruleType,
        price: b.price,
        isActive: b.isActive,
        userType: b.userType ?? null,
        dayOfWeek: b.dayOfWeek ?? null,
        startTime: b.startTime ?? null,
        endTime: b.endTime ?? null,
      },
    });

    res.status(201).json(created);
  },
);

router.get(
  "/pricing-rules",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const q = z
      .object({ resourceId: z.string().uuid().optional() })
      .safeParse(req.query);
    if (!q.success) return res.status(400).json({ message: "Invalid query" });

    const data = await prisma.pricingRule.findMany({
      where: q.data.resourceId ? { resourceId: q.data.resourceId } : undefined,
      orderBy: [{ resourceId: "asc" }, { createdAt: "desc" }],
    });

    res.json(data);
  },
);

router.delete(
  "/pricing-rules/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const id = req.params.id;

    const exists = await prisma.pricingRule.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ message: "Not Found" });

    await prisma.pricingRule.delete({ where: { id } });
    res.json({ ok: true });
  },
);

router.post("/schedules", authenticateToken, requireAdmin, async (req, res) => {
  const schema = z.object({
    resourceId: z.string().uuid(),
    scheduleType: z.enum(["WEEKLY", "EXCEPTION"]),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    openTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    closeTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),

    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    isClosed: z.boolean().optional().default(false),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid body", issues: parsed.error.issues });
  }

  const b = parsed.data;

  try {
    await assertResource(b.resourceId);
  } catch {
    return res.status(404).json({ message: "Resource not found" });
  }

  if (b.scheduleType === "WEEKLY") {
    if (b.dayOfWeek === undefined || !b.openTime || !b.closeTime) {
      return res
        .status(400)
        .json({ message: "WEEKLY requires dayOfWeek/openTime/closeTime" });
    }

    const created = await prisma.resourceSchedule.create({
      data: {
        resourceId: b.resourceId,
        scheduleType: "WEEKLY",
        dayOfWeek: b.dayOfWeek,
        openTime: b.openTime,
        closeTime: b.closeTime,
        date: null,
        isClosed: false,
      },
    });

    return res.status(201).json({
      ...created,
      exceptionDate: null,
    });
  }

  if (!b.date)
    return res.status(400).json({ message: "EXCEPTION requires date" });
  if (!b.isClosed && (!b.openTime || !b.closeTime)) {
    return res
      .status(400)
      .json({ message: "EXCEPTION open/close required unless isClosed=true" });
  }

  const dayStart = kstDateOnlyToDate(b.date);
  const dayEnd = kstDateOnlyToDate(b.date);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const existing = await prisma.resourceSchedule.findFirst({
    where: {
      resourceId: b.resourceId,
      scheduleType: "EXCEPTION",
      date: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    const updated = await prisma.resourceSchedule.update({
      where: { id: existing.id },
      data: {
        date: dayStart,
        isClosed: b.isClosed ?? false,
        openTime: b.isClosed ? null : (b.openTime ?? null),
        closeTime: b.isClosed ? null : (b.closeTime ?? null),
      },
    });

    return res.status(200).json({
      ...updated,
      exceptionDate: updated.date ? dateToKstYmd(updated.date) : null,
      deduped: true,
    });
  }

  const created = await prisma.resourceSchedule.create({
    data: {
      resourceId: b.resourceId,
      scheduleType: "EXCEPTION",
      dayOfWeek: null,
      openTime: b.isClosed ? null : (b.openTime ?? null),
      closeTime: b.isClosed ? null : (b.closeTime ?? null),
      date: dayStart,
      isClosed: b.isClosed ?? false,
    },
  });

  return res.status(201).json({
    ...created,
    exceptionDate: created.date ? dateToKstYmd(created.date) : null,
    deduped: false,
  });
});

router.get("/schedules", authenticateToken, requireAdmin, async (req, res) => {
  const qSchema = z.object({
    resourceId: z.string().uuid().optional(),
    scheduleType: z.enum(["WEEKLY", "EXCEPTION"]).optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  });

  const parsed = qSchema.safeParse(req.query);
  if (!parsed.success)
    return res
      .status(400)
      .json({ message: "Invalid query", issues: parsed.error.issues });

  const { resourceId, scheduleType, from, to } = parsed.data;

  const where: any = {};
  if (resourceId) where.resourceId = resourceId;
  if (scheduleType) where.scheduleType = scheduleType;

  if ((from || to) && (!scheduleType || scheduleType === "EXCEPTION")) {
    where.date = {};
    if (from) where.date.gte = kstDateOnlyToDate(from);
    if (to) {
      const endExclusive = kstDateOnlyToDate(to);
      endExclusive.setDate(endExclusive.getDate() + 1);
      where.date.lt = endExclusive;
    }
  }

  const data = await prisma.resourceSchedule.findMany({
    where,
    orderBy: [
      { resourceId: "asc" },
      { scheduleType: "asc" },
      { dayOfWeek: "asc" },
      { date: "asc" },
    ],
  });

  res.json(
    data.map((s) => ({
      ...s,
      exceptionDate: s.date ? dateToKstYmd(s.date) : null,
    })),
  );
});

function buildSummaryPatch(reservation: any) {
  return {
    reservationId: reservation.id,
    status: reservation.status,
    paymentStatus: reservation.payment?.status ?? null,
    totalAmount: reservation.totalAmount,
    updatedAt: reservation.updatedAt,
  };
}

router.get(
  "/reservations/summary",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const qSchema = z.object({
      status: z
        .enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"])
        .optional(),
      paymentStatus: z
        .enum(["PENDING", "PAID", "CANCELLED", "FAILED"])
        .optional(),
      resourceId: z.string().uuid().optional(),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      q: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional().default(50),
      cursor: z.string().uuid().optional(),
    });

    const parsed = qSchema.safeParse(req.query);
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: "Invalid query", issues: parsed.error.issues });

    const { status, paymentStatus, resourceId, from, to, q, limit, cursor } =
      parsed.data;

    let fromDt: Date | undefined;
    let toDtExclusive: Date | undefined;
    if (from) fromDt = new Date(`${from}T00:00:00+09:00`);
    if (to) {
      toDtExclusive = new Date(`${to}T00:00:00+09:00`);
      toDtExclusive.setDate(toDtExclusive.getDate() + 1);
    }

    const where: any = {};
    if (status) where.status = status;

    if (paymentStatus) {
      where.payment = { is: { status: paymentStatus } };
    }

    if (q && q.trim().length > 0) {
      const kw = q.trim();
      where.user = {
        is: {
          OR: [
            { email: { contains: kw, mode: "insensitive" } },
            { name: { contains: kw, mode: "insensitive" } },
            { phone: { contains: kw } },
          ],
        },
      };
    }

    const itemWhere: any = {};
    if (resourceId) itemWhere.resourceId = resourceId;
    if (fromDt)
      itemWhere.startAt = { ...(itemWhere.startAt ?? {}), gte: fromDt };
    if (toDtExclusive)
      itemWhere.startAt = { ...(itemWhere.startAt ?? {}), lt: toDtExclusive };

    if (Object.keys(itemWhere).length > 0) {
      where.items = { some: itemWhere };
    }

    const rows = await prisma.reservation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            userType: true,
          },
        },
        payment: { select: { status: true } },
        items: {
          select: { resourceId: true, startAt: true, endAt: true },
        },
      },
    });

    const allResourceIds = Array.from(
      new Set(rows.flatMap((r) => r.items.map((it) => it.resourceId))),
    );

    const resources = await prisma.resource.findMany({
      where: { id: { in: allResourceIds } },
      select: { id: true, name: true, type: true },
    });

    const resourceMap = new Map(resources.map((r) => [r.id, r]));

    const data = rows.map((r) => {
      const itemCount = r.items.length;

      let startAtMin: string | null = null;
      let endAtMax: string | null = null;

      for (const it of r.items) {
        if (it.startAt) {
          if (!startAtMin || new Date(it.startAt).toISOString() < startAtMin) {
            startAtMin = new Date(it.startAt).toISOString();
          }
        }
        if (it.endAt) {
          if (!endAtMax || new Date(it.endAt).toISOString() > endAtMax) {
            endAtMax = new Date(it.endAt).toISOString();
          }
        }
      }

      const uniqueResourceIds = Array.from(
        new Set(r.items.map((it) => it.resourceId)),
      );
      const resourceSummaries = uniqueResourceIds
        .map((id) => resourceMap.get(id))
        .filter(Boolean)
        .map((x) => ({ id: x!.id, name: x!.name, type: x!.type }));

      return {
        reservationId: r.id,
        status: r.status,
        paymentStatus: r.payment?.status ?? null,
        totalAmount: r.totalAmount,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        user: r.user,
        itemCount,
        resources: resourceSummaries,
        timeRange: { startAt: startAtMin, endAt: endAtMax },
      };
    });

    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

    res.json({ data, nextCursor });
  },
);

router.delete(
  "/schedules/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const id = req.params.id;

    const exists = await prisma.resourceSchedule.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ message: "Not Found" });

    await prisma.resourceSchedule.delete({ where: { id } });
    res.json({ ok: true });
  },
);

router.post("/blockouts", authenticateToken, requireAdmin, async (req, res) => {
  const schema = z.object({
    resourceId: z.string().uuid(),
    reason: z.string().optional(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ message: "Invalid body", issues: parsed.error.issues });

  const b = parsed.data;
  const startAt = new Date(b.startAt);
  const endAt = new Date(b.endAt);

  if (!(startAt < endAt))
    return res.status(400).json({ message: "Invalid time range" });

  try {
    await assertResource(b.resourceId);
  } catch {
    return res.status(404).json({ message: "Resource not found" });
  }

  const created = await prisma.resourceBlockout.create({
    data: {
      resourceId: b.resourceId,
      reason: b.reason ?? null,
      startAt,
      endAt,
    },
  });

  res.status(201).json(created);
});

router.get("/blockouts", authenticateToken, requireAdmin, async (req, res) => {
  const q = z
    .object({ resourceId: z.string().uuid().optional() })
    .safeParse(req.query);
  if (!q.success) return res.status(400).json({ message: "Invalid query" });

  const data = await prisma.resourceBlockout.findMany({
    where: q.data.resourceId ? { resourceId: q.data.resourceId } : undefined,
    orderBy: [{ resourceId: "asc" }, { startAt: "asc" }],
  });

  res.json(data);
});

router.delete(
  "/blockouts/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const id = req.params.id;

    const exists = await prisma.resourceBlockout.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ message: "Not Found" });

    await prisma.resourceBlockout.delete({ where: { id } });
    res.json({ ok: true });
  },
);

router.post(
  "/schedules/cleanup-exceptions",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const schema = z.object({
      resourceId: z.string().uuid().optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      mode: z
        .enum(["keepLatest", "deleteAll"])
        .optional()
        .default("keepLatest"),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: "Invalid body", issues: parsed.error.issues });

    const { resourceId, from, to, mode } = parsed.data;

    const fromStart = kstDateOnlyToDate(from);
    const toEndExclusive = kstDateOnlyToDate(to);
    toEndExclusive.setDate(toEndExclusive.getDate() + 1);

    const rows = await prisma.resourceSchedule.findMany({
      where: {
        ...(resourceId ? { resourceId } : {}),
        scheduleType: "EXCEPTION",
        date: { gte: fromStart, lt: toEndExclusive },
      },
      orderBy: [{ resourceId: "asc" }, { date: "asc" }, { createdAt: "desc" }],
    });

    const key = (r: any) => `${r.resourceId}__${dateToKstYmd(r.date)}`;
    const groups = new Map<string, any[]>();
    for (const r of rows) {
      const k = key(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }

    let deleted = 0;
    const deletedIds: string[] = [];

    for (const [k, arr] of groups.entries()) {
      if (arr.length <= 1) continue;

      if (mode === "deleteAll") {
        const ids = arr.map((x) => x.id);
        await prisma.resourceSchedule.deleteMany({
          where: { id: { in: ids } },
        });
        deleted += ids.length;
        deletedIds.push(...ids);
      } else {
        const keep = arr[0];
        const toDelete = arr.slice(1).map((x) => x.id);
        await prisma.resourceSchedule.deleteMany({
          where: { id: { in: toDelete } },
        });
        deleted += toDelete.length;
        deletedIds.push(...toDelete);
      }
    }

    res.json({
      ok: true,
      mode,
      range: { from, to, resourceId: resourceId ?? null },
      duplicatesFound: Array.from(groups.values()).filter((g) => g.length > 1)
        .length,
      deleted,
      deletedIds,
    });
  },
);

router.post(
  "/maintenance/expire-pending",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const schema = z.object({
      ttlMinutes: z
        .number()
        .int()
        .min(1)
        .max(24 * 60)
        .optional()
        .default(15),
    });

    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Invalid body", issues: parsed.error.issues });
    }

    const result = await expirePendingReservations(parsed.data.ttlMinutes);
    res.json({ ok: true, ...result });
  },
);

router.get(
  "/reservations",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const qSchema = z.object({
      status: z
        .enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"])
        .optional(),
      paymentStatus: z
        .enum(["PENDING", "PAID", "CANCELLED", "FAILED"])
        .optional(),
      resourceId: z.string().uuid().optional(),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      q: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional().default(50),
      cursor: z.string().uuid().optional(),
    });

    const parsed = qSchema.safeParse(req.query);
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: "Invalid query", issues: parsed.error.issues });

    const { status, paymentStatus, resourceId, from, to, q, limit, cursor } =
      parsed.data;

    let fromDt: Date | undefined;
    let toDtExclusive: Date | undefined;
    if (from) fromDt = new Date(`${from}T00:00:00+09:00`);
    if (to) {
      toDtExclusive = new Date(`${to}T00:00:00+09:00`);
      toDtExclusive.setDate(toDtExclusive.getDate() + 1);
    }

    const where: any = {};
    if (status) where.status = status;

    if (paymentStatus) {
      where.payment = { is: { status: paymentStatus } };
    }

    if (q && q.trim().length > 0) {
      const kw = q.trim();
      where.user = {
        is: {
          OR: [
            { email: { contains: kw, mode: "insensitive" } },
            { name: { contains: kw, mode: "insensitive" } },
            { phone: { contains: kw } },
          ],
        },
      };
    }

    const itemWhere: any = {};
    if (resourceId) itemWhere.resourceId = resourceId;
    if (fromDt)
      itemWhere.startAt = { ...(itemWhere.startAt ?? {}), gte: fromDt };
    if (toDtExclusive)
      itemWhere.startAt = { ...(itemWhere.startAt ?? {}), lt: toDtExclusive };

    if (Object.keys(itemWhere).length > 0) {
      where.items = { some: itemWhere };
    }

    const data = await prisma.reservation.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            userType: true,
          },
        },
        items: true,
        payment: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const nextCursor = data.length === limit ? data[data.length - 1].id : null;

    res.json({ data, nextCursor });
  },
);

router.get(
  "/reservations/:id",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const id = req.params.id;

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            userType: true,
            userRole: true,
          },
        },
        items: true,
        payment: true,
      },
    });

    if (!reservation) return res.status(404).json({ message: "Not Found" });

    const resourceIds = Array.from(
      new Set(reservation.items.map((it) => it.resourceId)),
    );
    const resources = await prisma.resource.findMany({
      where: { id: { in: resourceIds } },
      select: { id: true, name: true, type: true },
    });

    const resourceMap = new Map(resources.map((r) => [r.id, r]));

    let startAtMin: string | null = null;
    let endAtMax: string | null = null;

    for (const it of reservation.items) {
      if (it.startAt) {
        const s = new Date(it.startAt).toISOString();
        if (!startAtMin || s < startAtMin) startAtMin = s;
      }
      if (it.endAt) {
        const e = new Date(it.endAt).toISOString();
        if (!endAtMax || e > endAtMax) endAtMax = e;
      }
    }

    const viewItems = reservation.items.map((it) => {
      const r = resourceMap.get(it.resourceId);
      return {
        ...it,
        resource: r ? { id: r.id, name: r.name, type: r.type } : null,
      };
    });

    res.json({
      reservationId: reservation.id,
      status: reservation.status,
      totalAmount: reservation.totalAmount,
      createdAt: reservation.createdAt,
      updatedAt: reservation.updatedAt,
      user: reservation.user,
      payment: reservation.payment,
      itemCount: reservation.items.length,
      resources,
      timeRange: { startAt: startAtMin, endAt: endAtMax },
      items: viewItems,
    });
  },
);

router.post(
  "/reservations/:id/action",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const id = req.params.id;

    const schema = z.object({
      action: z.enum(["CONFIRM", "CANCEL", "MARK_PAID"]),
      reason: z.string().optional(),
      provider: z.string().optional(),
      providerPaymentId: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Invalid body", issues: parsed.error.issues });
    }

    const { action, reason, provider, providerPaymentId } = parsed.data;

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: { payment: true, items: true },
    });
    if (!reservation) return res.status(404).json({ message: "Not Found" });

    if (reservation.status === "CANCELLED" && action !== "MARK_PAID") {
      return res.status(409).json({ message: "Already cancelled" });
    }

    if (action === "CANCEL") {
      if (!reservation.payment) {
        return res
          .status(409)
          .json({ message: "No payment record for reservation" });
      }

      const starts = reservation.items
        .map((it) => it.startAt)
        .filter(Boolean) as Date[];
      if (starts.length === 0) {
        return res
          .status(409)
          .json({ message: "No startAt on reservation items" });
      }
      const startAtMin = new Date(Math.min(...starts.map((d) => d.getTime())));

      if (reservation.payment.status === "PENDING") {
        const updated = await prisma.reservation.update({
          where: { id },
          data: {
            status: "CANCELLED",
            items: { updateMany: { where: {}, data: { status: "CANCELLED" } } },
            payment: { update: { status: "CANCELLED" } },
          },
          include: { items: true, payment: true },
        });

        await prisma.notificationLog.create({
          data: {
            channel: "EMAIL",
            status: "SENT",
            userId: updated.userId,
            reservationId: updated.id,
            title: "Reservation cancelled (ADMIN)",
            message: `Admin cancelled PENDING reservation. reason=${
              reason ?? "N/A"
            }`,
            to: null,
            error: null,
          },
        });

        return res.json({
          ok: true,
          action,
          summaryPatch: buildSummaryPatch(updated),
          reservation: updated,
        });
      }

      if (reservation.payment.status !== "PAID") {
        return res.status(409).json({
          message: `Cannot refund in payment status=${reservation.payment.status}`,
        });
      }

      const paymentId = reservation.payment.providerPaymentId;
      if (!paymentId) {
        return res
          .status(409)
          .json({ message: "Missing providerPaymentId(paymentId)" });
      }

      const total = reservation.payment.amount;

      const percent = refundPercentByPolicy(startAtMin, new Date());
      if (percent <= 0) {
        return res.status(409).json({
          message: "Refund not allowed by policy (already started)",
          policy: { startAt: startAtMin.toISOString(), refundPercent: 0 },
        });
      }

      const refundAmount = Math.floor(total * percent);
      if (refundAmount <= 0) {
        return res
          .status(409)
          .json({ message: "Refund amount is 0 by policy" });
      }

      const idemKey = `admin-cancel-${reservation.id}`;

      const resp = await fetch(
        `https://api.portone.io/payments/${encodeURIComponent(
          paymentId,
        )}/cancel`,
        {
          method: "POST",
          headers: {
            Authorization: `PortOne ${env.PORTONE_API_SECRET}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idemKey,
          },
          body: JSON.stringify({
            storeId: env.PORTONE_STORE_ID,
            amount: refundAmount,
            reason: reason ?? "ADMIN_CANCEL_POLICY_REFUND",
            requester: "MERCHANT",
          }),
        },
      );

      const json = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        await prisma.notificationLog.create({
          data: {
            channel: "EMAIL",
            status: "FAILED",
            userId: reservation.userId,
            reservationId: reservation.id,
            title: "Refund failed (PortOne)",
            message: `paymentId=${paymentId} resp=${JSON.stringify(json)}`,
            to: null,
            error: "REFUND_FAILED",
          },
        });
        return res
          .status(502)
          .json({ message: "Refund request failed", portone: json });
      }

      const nextPaymentStatus: PaymentStatus =
        refundAmount >= total
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED;

      const updated = await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { reservationId: reservation.id },
          data: {
            status: nextPaymentStatus,
            refundedAmount: refundAmount,
            refundedAt: new Date(),
            refundReason: reason ?? "ADMIN_CANCEL_POLICY_REFUND",
          },
        });

        const rsv = await tx.reservation.update({
          where: { id: reservation.id },
          data: {
            status: "CANCELLED",
            items: { updateMany: { where: {}, data: { status: "CANCELLED" } } },
          },
          include: { items: true, payment: true },
        });

        await tx.notificationLog.create({
          data: {
            channel: "EMAIL",
            status: "SENT",
            userId: reservation.userId,
            reservationId: reservation.id,
            title: "Reservation cancelled+refunded (ADMIN policy)",
            message: `paymentId=${paymentId} startAt=${startAtMin.toISOString()} percent=${percent} refundAmount=${refundAmount}/${total} reason=${
              reason ?? "N/A"
            }`,
            to: null,
            error: null,
          },
        });

        return rsv;
      });

      return res.json({
        ok: true,
        action,
        policy: {
          startAt: startAtMin.toISOString(),
          refundPercent: percent,
          refundAmount,
          totalAmount: total,
        },
        portone: json,
        summaryPatch: buildSummaryPatch(updated),
        reservation: updated,
      });
    }

    if (action === "CONFIRM") {
      const updated = await prisma.reservation.update({
        where: { id },
        data: {
          status: "CONFIRMED",
          items: { updateMany: { where: {}, data: { status: "CONFIRMED" } } },
        },
        include: { items: true, payment: true },
      });

      return res.json({
        ok: true,
        action,
        summaryPatch: buildSummaryPatch(updated),
        reservation: updated,
      });
    }

    if (action === "MARK_PAID") {
      if (!reservation.payment) {
        return res
          .status(409)
          .json({ message: "No payment record for reservation" });
      }

      const updated = await prisma.reservation.update({
        where: { id },
        data: {
          status:
            reservation.status === "PENDING" ? "CONFIRMED" : reservation.status,
          items:
            reservation.status === "PENDING"
              ? { updateMany: { where: {}, data: { status: "CONFIRMED" } } }
              : undefined,
          payment: {
            update: {
              status: "PAID",
              provider: provider ?? reservation.payment.provider ?? null,
              providerPaymentId:
                providerPaymentId ??
                reservation.payment.providerPaymentId ??
                null,
              paidAt: new Date(),
            },
          },
        },
        include: { items: true, payment: true },
      });

      await prisma.notificationLog.create({
        data: {
          channel: "EMAIL",
          status: "SENT",
          userId: updated.userId,
          reservationId: updated.id,
          title: "Payment marked as PAID (ADMIN)",
          message: `Admin marked payment PAID. provider=${
            provider ?? "N/A"
          } providerPaymentId=${providerPaymentId ?? "N/A"}`,
          to: null,
          error: null,
        },
      });

      return res.json({
        ok: true,
        action,
        summaryPatch: buildSummaryPatch(updated),
        reservation: updated,
      });
    }

    return res.status(400).json({ message: "Unsupported action" });
  },
);

router.get(
  "/maintenance/expire-logs",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const qSchema = z.object({
      limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    });

    const parsed = qSchema.safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ message: "Invalid query" });

    const logs = await prisma.notificationLog.findMany({
      where: { title: "Reservation expired (TTL)" },
      orderBy: { createdAt: "desc" },
      take: parsed.data.limit,
    });

    res.json({ data: logs });
  },
);

router.post(
  "/reservations/:id/refund",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const id = req.params.id;

    const schema = z.object({
      reason: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: "Invalid body", issues: parsed.error.issues });

    const rsv = await prisma.reservation.findUnique({
      where: { id },
      include: { payment: true, items: { select: { startAt: true } } },
    });
    if (!rsv) return res.status(404).json({ message: "Not Found" });
    if (!rsv.payment) return res.status(409).json({ message: "No payment" });
    if (rsv.payment.status !== "PAID")
      return res.status(409).json({ message: "Payment is not PAID" });

    const starts = rsv.items.map((x) => x.startAt).filter(Boolean) as Date[];
    if (starts.length === 0)
      return res.status(409).json({ message: "No startAt in items" });

    const startAtMin = new Date(Math.min(...starts.map((d) => d.getTime())));
    const percent = refundPercentByPolicy(startAtMin, new Date());

    if (percent <= 0) {
      return res.status(409).json({
        message: "Refund not allowed by policy (already started)",
        policy: { startAt: startAtMin.toISOString(), refundPercent: 0 },
      });
    }

    const total = rsv.payment.amount;
    const refundAmount = Math.floor(total * percent);

    const paymentId = rsv.payment.providerPaymentId;
    if (!paymentId)
      return res
        .status(409)
        .json({ message: "Missing providerPaymentId(paymentId)" });

    const idemKey = `"refund-${paymentId}-${id}"`;

    const resp = await fetch(
      `https://api.portone.io/payments/${encodeURIComponent(paymentId)}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `PortOne ${env.PORTONE_API_SECRET}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idemKey,
        },
        body: JSON.stringify({
          storeId: env.PORTONE_STORE_ID,
          amount: refundAmount,
          reason: parsed.data.reason,
          requester: "MERCHANT",
        }),
      },
    );

    const json = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      await prisma.notificationLog.create({
        data: {
          channel: "EMAIL",
          status: "FAILED",
          userId: rsv.userId,
          reservationId: rsv.id,
          title: "Refund failed (PortOne)",
          message: `paymentId=${paymentId} resp=${JSON.stringify(json)}`,
          to: null,
          error: "REFUND_FAILED",
        },
      });
      return res
        .status(502)
        .json({ message: "Refund request failed", portone: json });
    }

    const nextStatus =
      refundAmount >= total ? "REFUNDED" : "PARTIALLY_REFUNDED";

    const updated = await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { reservationId: rsv.id },
        data: {
          status: nextStatus,
          refundedAmount: refundAmount,
          refundedAt: new Date(),
          refundReason: parsed.data.reason,
        },
      });

      const updatedRsv = await tx.reservation.update({
        where: { id: rsv.id },
        data: {
          status: "CANCELLED",
          items: { updateMany: { where: {}, data: { status: "CANCELLED" } } },
        },
        include: { items: true, payment: true },
      });

      await tx.notificationLog.create({
        data: {
          channel: "EMAIL",
          status: "SENT",
          userId: rsv.userId,
          reservationId: rsv.id,
          title: "Refund applied (policy)",
          message: `paymentId=${paymentId} startAt=${startAtMin.toISOString()} percent=${percent} refundAmount=${refundAmount}/${total} reason=${
            parsed.data.reason
          }`,
          to: null,
          error: null,
        },
      });

      return updatedRsv;
    });

    return res.json({
      ok: true,
      policy: {
        startAt: startAtMin.toISOString(),
        refundPercent: percent,
        refundAmount,
        totalAmount: total,
      },
      portone: json,
      reservation: updated,
    });
  },
);

export default router;
