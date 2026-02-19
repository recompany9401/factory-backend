import { prisma } from "../db/prisma";

export type ExpireResult = {
  cutoff: string;
  ttlMinutes: number;
  expiredCount: number;
  expiredReservationIds: string[];
};

export async function expirePendingReservations(
  ttlMinutes: number,
): Promise<ExpireResult> {
  const cutoffDate = new Date(Date.now() - ttlMinutes * 60_000);

  const targets = await prisma.reservation.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: cutoffDate },
      payment: { is: { status: "PENDING" } },
    },
    select: { id: true, userId: true, totalAmount: true, createdAt: true },
  });

  if (targets.length === 0) {
    return {
      cutoff: cutoffDate.toISOString(),
      ttlMinutes,
      expiredCount: 0,
      expiredReservationIds: [],
    };
  }

  const ids = targets.map((t) => t.id);

  await prisma.$transaction(async (tx) => {
    await tx.reservation.updateMany({
      where: { id: { in: ids }, status: "PENDING" },
      data: { status: "CANCELLED" },
    });

    await tx.reservationItem.updateMany({
      where: { reservationId: { in: ids }, status: "PENDING" },
      data: { status: "CANCELLED" },
    });

    await tx.payment.updateMany({
      where: { reservationId: { in: ids }, status: "PENDING" },
      data: { status: "CANCELLED" },
    });

    await tx.notificationLog.createMany({
      data: targets.map((t) => ({
        channel: "EMAIL",
        status: "SENT",
        userId: t.userId,
        reservationId: t.id,
        to: null,
        title: "Reservation expired (TTL)",
        message: `Auto-cancelled pending reservation due to TTL (${ttlMinutes} min). amount=${t.totalAmount}`,
        error: null,
      })),
    });
  });

  return {
    cutoff: cutoffDate.toISOString(),
    ttlMinutes,
    expiredCount: ids.length,
    expiredReservationIds: ids,
  };
}
