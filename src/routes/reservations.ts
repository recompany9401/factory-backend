import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { authenticateToken, AuthRequest } from "../middlewares/auth";
import { overlaps, addMinutes, toKstDateTime } from "../utils/time";
import { resolveUnitPrice } from "../modules/pricing";
import { uploadInsurance } from "../middlewares/upload";

const router = Router();

type Slot = { startAt: string; endAt: string };

async function computeAvailability(params: {
  resourceId: string;
  date: string;
  slotMinutes: number;
}) {
  const { resourceId, date, slotMinutes } = params;

  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, bookingUnit: true },
  });

  if (!resource) {
    return {
      ok: false as const,
      resourceId,
      date,
      slotMinutes,
      openTime: null as string | null,
      closeTime: null as string | null,
      slots: [] as Slot[],
      busyCount: 0,
      reason: "RESOURCE_NOT_FOUND" as const,
    };
  }

  if (resource.bookingUnit !== "TIME") {
    return {
      ok: false as const,
      resourceId,
      date,
      slotMinutes,
      openTime: null as string | null,
      closeTime: null as string | null,
      slots: [] as Slot[],
      busyCount: 0,
      reason: "NOT_TIME_UNIT" as const,
    };
  }

  const dayStart = new Date(`${date}T00:00:00+09:00`);
  const dayEnd = new Date(`${date}T00:00:00+09:00`);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const dayOfWeek = new Date(`${date}T00:00:00+09:00`).getDay();

  const exception = await prisma.resourceSchedule.findFirst({
    where: {
      resourceId,
      scheduleType: "EXCEPTION",
      date: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { createdAt: "desc" },
  });

  if (exception?.isClosed) {
    return {
      ok: true as const,
      resourceId,
      date,
      slotMinutes,
      openTime: null,
      closeTime: null,
      slots: [] as Slot[],
      busyCount: 0,
      reason: "CLOSED_EXCEPTION" as const,
    };
  }

  let openTime: string | null = null;
  let closeTime: string | null = null;

  if (exception?.openTime && exception?.closeTime) {
    openTime = exception.openTime;
    closeTime = exception.closeTime;
  } else {
    const weekly = await prisma.resourceSchedule.findFirst({
      where: { resourceId, scheduleType: "WEEKLY", dayOfWeek },
      orderBy: { createdAt: "desc" },
    });

    if (!weekly?.openTime || !weekly?.closeTime) {
      return {
        ok: true as const,
        resourceId,
        date,
        slotMinutes,
        openTime: null,
        closeTime: null,
        slots: [] as Slot[],
        busyCount: 0,
        reason: "NO_SCHEDULE" as const,
      };
    }

    openTime = weekly.openTime;
    closeTime = weekly.closeTime;
  }

  const windowStart = toKstDateTime(date, openTime);
  const windowEnd = toKstDateTime(date, closeTime);

  if (!(windowStart < windowEnd)) {
    return {
      ok: true as const,
      resourceId,
      date,
      slotMinutes,
      openTime,
      closeTime,
      slots: [] as Slot[],
      busyCount: 0,
      reason: "INVALID_SCHEDULE_WINDOW" as const,
    };
  }

  const [blockouts, bookedItems] = await Promise.all([
    prisma.resourceBlockout.findMany({
      where: {
        resourceId,
        startAt: { lt: windowEnd },
        endAt: { gt: windowStart },
      },
      select: { startAt: true, endAt: true },
    }),
    prisma.reservationItem.findMany({
      where: {
        resourceId,
        status: { not: "CANCELLED" },
        startAt: { not: null, lt: windowEnd },
        endAt: { not: null, gt: windowStart },
      },
      select: { startAt: true, endAt: true },
    }),
  ]);

  const busy: Array<{ startAt: Date; endAt: Date }> = [];
  for (const b of blockouts) busy.push({ startAt: b.startAt, endAt: b.endAt });
  for (const it of bookedItems) {
    if (it.startAt && it.endAt)
      busy.push({ startAt: it.startAt, endAt: it.endAt });
  }

  const slots: Slot[] = [];
  for (
    let cur = windowStart;
    cur < windowEnd;
    cur = addMinutes(cur, slotMinutes)
  ) {
    const next = addMinutes(cur, slotMinutes);
    if (next > windowEnd) break;

    const isBusy = busy.some((bi) => overlaps(cur, next, bi.startAt, bi.endAt));
    if (!isBusy)
      slots.push({ startAt: cur.toISOString(), endAt: next.toISOString() });
  }

  return {
    ok: true as const,
    resourceId,
    date,
    slotMinutes,
    openTime,
    closeTime,
    slots,
    busyCount: busy.length,
    reason: null as string | null,
  };
}

function intersectSlots(lists: Slot[][]): Slot[] {
  if (lists.length === 0) return [];
  const key = (s: Slot) => `${s.startAt}__${s.endAt}`;
  let set: Set<string> = new Set(lists[0].map(key));
  for (let i = 1; i < lists.length; i++) {
    const nextSet: Set<string> = new Set(lists[i].map(key));
    set = new Set([...set].filter((k) => nextSet.has(k)));
    if (set.size === 0) break;
  }
  return [...set]
    .map((k) => {
      const [startAt, endAt] = k.split("__");
      return { startAt, endAt };
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function buildContinuousBlocks(
  slots: Slot[],
  slotMinutes: number,
  durationMinutes: number,
) {
  const k = Math.ceil(durationMinutes / slotMinutes);
  if (k <= 1) {
    return slots.map((s) => ({
      startAt: s.startAt,
      endAt: s.endAt,
      parts: [s],
    }));
  }

  const sorted = [...slots].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const blocks: Array<{ startAt: string; endAt: string; parts: Slot[] }> = [];

  for (let i = 0; i <= sorted.length - k; i++) {
    let ok = true;
    for (let j = 0; j < k - 1; j++) {
      const curEnd = new Date(sorted[i + j].endAt).getTime();
      const nextStart = new Date(sorted[i + j + 1].startAt).getTime();
      if (nextStart !== curEnd) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    const parts = sorted.slice(i, i + k);
    blocks.push({
      startAt: parts[0].startAt,
      endAt: parts[parts.length - 1].endAt,
      parts,
    });
  }
  return blocks;
}

router.get("/booked", async (req, res) => {
  const date = req.query.date as string;
  if (!date) return res.status(400).json({ message: "Date is required" });

  const startOfDay = new Date(`${date}T00:00:00+09:00`);
  const endOfDay = new Date(`${date}T23:59:59+09:00`);

  try {
    const bookedItems = await prisma.reservationItem.findMany({
      where: {
        status: { not: "CANCELLED" },
        startAt: { gte: startOfDay, lte: endOfDay },
      },
      select: {
        resourceId: true,
        startAt: true,
        endAt: true,
      },
    });
    res.json(bookedItems);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch booked items" });
  }
});

router.get("/availability", async (req, res) => {
  const qSchema = z.object({
    resourceId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    slotMinutes: z.coerce.number().int().min(15).max(240).default(60),
  });

  const parsed = qSchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid query", issues: parsed.error.issues });
  }

  const { resourceId, date, slotMinutes } = parsed.data;
  const result = await computeAvailability({ resourceId, date, slotMinutes });

  if (!result.ok) return res.status(400).json(result);

  return res.json({
    resourceId,
    date,
    slotMinutes,
    openTime: result.openTime,
    closeTime: result.closeTime,
    slots: result.slots,
    busyCount: result.busyCount,
    ...(result.reason ? { reason: result.reason } : {}),
  });
});

router.get("/availability-multi", async (req, res) => {
  const qSchema = z.object({
    resourceIds: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    slotMinutes: z.coerce.number().int().min(15).max(240).default(30),
    durationMinutes: z.coerce
      .number()
      .int()
      .min(15)
      .max(8 * 60)
      .optional(),
    includePerResource: z
      .union([z.literal("true"), z.literal("false")])
      .optional()
      .default("false"),
    onlyBlockStartAt: z
      .union([z.literal("true"), z.literal("false")])
      .optional()
      .default("true"),
    limitBlocks: z.coerce.number().int().min(1).max(200).optional().default(50),
  });

  const parsed = qSchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid query", issues: parsed.error.issues });
  }

  const {
    resourceIds,
    date,
    slotMinutes,
    durationMinutes,
    includePerResource,
    onlyBlockStartAt,
    limitBlocks,
  } = parsed.data;

  const ids = resourceIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length < 2)
    return res
      .status(400)
      .json({ message: "resourceIds must contain at least 2 ids" });
  if (ids.length > 10)
    return res.status(400).json({ message: "resourceIds max is 10" });

  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const id of ids) {
    if (!uuidRe.test(id))
      return res.status(400).json({ message: `Invalid resourceId: ${id}` });
  }

  if (durationMinutes !== undefined && durationMinutes % slotMinutes !== 0) {
    return res
      .status(400)
      .json({ message: "durationMinutes must be a multiple of slotMinutes" });
  }

  const per = await Promise.all(
    ids.map((resourceId) =>
      computeAvailability({ resourceId, date, slotMinutes }),
    ),
  );
  const intersectionSlots = intersectSlots(per.map((r) => r.slots));

  let blocksCount: number | null = null;
  let blocks: any = null;

  if (durationMinutes !== undefined) {
    const rawBlocks = buildContinuousBlocks(
      intersectionSlots,
      slotMinutes,
      durationMinutes,
    );
    blocksCount = rawBlocks.length;
    const trimmed = rawBlocks.slice(0, limitBlocks);
    if (onlyBlockStartAt === "true") {
      blocks = trimmed.map((b) => b.startAt);
    } else {
      blocks = trimmed.map((b) => ({ startAt: b.startAt, endAt: b.endAt }));
    }
  }

  const response: any = {
    resourceIds: ids,
    date,
    slotMinutes,
    durationMinutes: durationMinutes ?? null,
    intersectionSlots,
    blocks,
    blocksCount,
    limitBlocks,
    includePerResource: includePerResource === "true",
    onlyBlockStartAt: onlyBlockStartAt === "true",
  };

  if (includePerResource === "true") {
    response.perResource = per;
  }
  return res.json(response);
});

router.post(
  "/multi",
  authenticateToken,
  uploadInsurance.single("insuranceFile"),
  async (req: AuthRequest, res) => {
    const bodySchema = z.object({
      resourceIds: z.preprocess(
        (val: any) => (typeof val === "string" ? JSON.parse(val) : val),
        z.array(z.string().uuid()).min(2).max(10),
      ),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      slotMinutes: z.coerce.number().int().min(15).max(240).default(30),
      durationMinutes: z.coerce
        .number()
        .int()
        .min(15)
        .max(8 * 60)
        .default(30),
      slotIndex: z.coerce.number().int().min(0).optional().default(0),
      preferredStartAt: z.string().datetime().optional(),
      quantities: z.preprocess(
        (val: any) => (val && typeof val === "string" ? JSON.parse(val) : val),
        z.record(z.string(), z.number().int().min(1)).optional(),
      ),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Invalid body", issues: parsed.error.issues });
    }

    const {
      resourceIds,
      date,
      slotMinutes,
      durationMinutes,
      slotIndex,
      preferredStartAt,
      quantities,
    } = parsed.data;

    const insuranceDocUrl = req.file
      ? `/uploads/insurance/${req.file.filename}`
      : null;

    if (durationMinutes % slotMinutes !== 0) {
      return res
        .status(400)
        .json({ message: "durationMinutes must be a multiple of slotMinutes" });
    }

    const perResource = await Promise.all(
      resourceIds.map((resourceId) =>
        computeAvailability({ resourceId, date, slotMinutes }),
      ),
    );
    const intersectionSlots = intersectSlots(perResource.map((r) => r.slots));
    const blocks = buildContinuousBlocks(
      intersectionSlots,
      slotMinutes,
      durationMinutes,
    );

    if (blocks.length === 0) {
      return res
        .status(409)
        .json({ message: "No available continuous slots", resourceIds, date });
    }

    let picked = blocks[slotIndex];
    if (preferredStartAt) {
      const found = blocks.find((b) => b.startAt === preferredStartAt);
      if (!found)
        return res
          .status(409)
          .json({ message: "preferredStartAt is not available" });
      picked = found;
    }

    const startAt = new Date(picked.startAt);
    const endAt = new Date(picked.endAt);

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { userType: true },
    });
    if (!user) return res.status(401).json({ message: "User not found" });

    try {
      const created = await prisma.$transaction(async (tx) => {
        const resources = await tx.resource.findMany({
          where: { id: { in: resourceIds } },
        });
        if (resources.length !== resourceIds.length)
          throw new Error("Resource not found");

        for (const rid of resourceIds) {
          const conflict = await tx.reservationItem.findFirst({
            where: {
              resourceId: rid,
              status: { not: "CANCELLED" },
              startAt: { lt: endAt },
              endAt: { gt: startAt },
            },
          });
          if (conflict)
            throw new Error(`Slot already booked for resource ${rid}`);
        }

        const itemCreates: any[] = [];
        let totalAmount = 0;

        for (const rid of resourceIds) {
          const q = quantities?.[rid] ?? 1;
          const r = await resolveUnitPrice({
            resourceId: rid,
            startAt,
            userType: user.userType,
          });
          const amount = r.unitPrice * q;
          totalAmount += amount;

          itemCreates.push({
            resourceId: rid,
            status: "PENDING",
            unitPrice: r.unitPrice,
            quantity: q,
            amount,
            appliedPricingRuleId: r.ruleId,
            appliedPricingRuleType: r.ruleType,
            startAt,
            endAt,
          });
        }

        const reservation = await tx.reservation.create({
          data: {
            userId: req.user!.userId,
            status: "PENDING",
            totalAmount,
            insuranceDocUrl,
            hasInsurance: !!insuranceDocUrl,
            items: { create: itemCreates },
            payment: { create: { status: "PENDING", amount: totalAmount } },
          },
          include: { items: true, payment: true },
        });

        return reservation;
      });

      return res.status(201).json({ reservation: created });
    } catch (err: any) {
      return res.status(409).json({ message: err.message });
    }
  },
);

router.post(
  "/",
  authenticateToken,
  uploadInsurance.single("insuranceFile"),
  async (req: AuthRequest, res) => {
    const bodySchema = z.object({
      items: z.preprocess(
        (val: any) => (typeof val === "string" ? JSON.parse(val) : val),
        z
          .array(
            z.object({
              resourceId: z.string().uuid(),
              startAt: z.string().datetime(),
              endAt: z.string().datetime(),
              quantity: z.number().int().min(1).default(1),
            }),
          )
          .min(1)
          .max(20),
      ),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Invalid body", issues: parsed.error.issues });
    }

    const insuranceDocUrl = req.file
      ? `/uploads/insurance/${req.file.filename}`
      : null;
    const items = parsed.data.items.map((it) => ({
      ...it,
      startAt: new Date(it.startAt),
      endAt: new Date(it.endAt),
    }));

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { userType: true },
    });
    if (!user) return res.status(401).json({ message: "User not found" });

    try {
      const created = await prisma.$transaction(async (tx) => {
        const itemCreates: any[] = [];
        let totalAmount = 0;

        for (const it of items) {
          const conflict = await tx.reservationItem.findFirst({
            where: {
              resourceId: it.resourceId,
              status: { not: "CANCELLED" },
              startAt: { lt: it.endAt },
              endAt: { gt: it.startAt },
            },
          });

          if (conflict) {
            throw new Error(
              `해당 시간대에 이미 예약이 존재합니다. (자원: ${it.resourceId})`,
            );
          }

          const r = await resolveUnitPrice({
            resourceId: it.resourceId,
            startAt: it.startAt,
            userType: user.userType,
          });
          const amount = r.unitPrice * it.quantity;
          totalAmount += amount;

          itemCreates.push({
            resourceId: it.resourceId,
            status: "PENDING",
            unitPrice: r.unitPrice,
            quantity: it.quantity,
            amount,
            appliedPricingRuleId: r.ruleId,
            appliedPricingRuleType: r.ruleType,
            startAt: it.startAt,
            endAt: it.endAt,
          });
        }

        return await tx.reservation.create({
          data: {
            userId: req.user!.userId,
            status: "PENDING",
            totalAmount,
            insuranceDocUrl,
            hasInsurance: !!insuranceDocUrl,
            items: { create: itemCreates },
            payment: { create: { status: "PENDING", amount: totalAmount } },
          },
          include: { items: true, payment: true },
        });
      });

      return res.status(201).json(created);
    } catch (err: any) {
      console.error(err);
      return res
        .status(409)
        .json({ message: err.message || "Reservation creation failed" });
    }
  },
);

router.get("/my", authenticateToken, async (req: AuthRequest, res) => {
  const data = await prisma.reservation.findMany({
    where: { userId: req.user!.userId },
    orderBy: { createdAt: "desc" },
    include: { items: true, payment: true },
  });
  res.json(data);
});

router.get("/:id", authenticateToken, async (req: AuthRequest, res) => {
  const id = req.params.id;
  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: { items: true, payment: true },
  });
  if (!reservation) return res.status(404).json({ message: "Not Found" });

  const isOwner = reservation.userId === req.user!.userId;
  const isAdmin = req.user!.role === "ADMIN";
  if (!isOwner && !isAdmin)
    return res.status(403).json({ message: "Forbidden" });

  res.json(reservation);
});

router.post("/:id/cancel", authenticateToken, async (req: AuthRequest, res) => {
  const id = req.params.id;
  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: { items: true, payment: true },
  });
  if (!reservation) return res.status(404).json({ message: "Not Found" });

  const isOwner = reservation.userId === req.user!.userId;
  const isAdmin = req.user!.role === "ADMIN";
  if (!isOwner && !isAdmin)
    return res.status(403).json({ message: "Forbidden" });

  if (reservation.status === "CANCELLED")
    return res.status(200).json(reservation);

  const updated = await prisma.reservation.update({
    where: { id },
    data: {
      status: "CANCELLED",
      items: { updateMany: { where: {}, data: { status: "CANCELLED" } } },
      payment: reservation.payment
        ? { update: { status: "CANCELLED" } }
        : undefined,
    },
    include: { items: true, payment: true },
  });
  res.json(updated);
});

export default router;
