import { PaymentClient } from "@portone/server-sdk";
import { prisma } from "../db/prisma";
import { env } from "../utils/env";

const paymentClient = PaymentClient({ secret: env.PORTONE_API_SECRET });

export function buildPortOnePaymentId(reservationId: string) {
  return `res_${reservationId.replace(/-/g, "")}`;
}

export async function verifyAndApplyPayment(paymentId: string) {
  const pay = await prisma.payment.findFirst({
    where: { providerPaymentId: paymentId },
    include: { reservation: { include: { items: true } } },
  });

  if (!pay)
    return {
      ok: true,
      ignored: true,
      reason: "PAYMENT_NOT_FOUND_IN_DB" as const,
    };

  const p: any = await paymentClient.getPayment({ paymentId });

  const status: string | undefined = p?.status;
  const paidTotal =
    p?.amount?.total ?? p?.amount?.totalAmount ?? p?.totalAmount ?? p?.amount;

  if (Number(paidTotal) !== Number(pay.amount)) {
    await prisma.notificationLog.create({
      data: {
        channel: "EMAIL",
        status: "FAILED",
        userId: pay.reservation.userId,
        reservationId: pay.reservationId,
        title: "Payment verification failed (amount mismatch)",
        message: `paymentId=${paymentId} expected=${pay.amount} got=${paidTotal}`,
        to: null,
        error: "AMOUNT_MISMATCH",
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { reservationId: pay.reservationId },
        data: { status: "FAILED" },
      });
      await tx.reservation.update({
        where: { id: pay.reservationId },
        data: {
          status: "CANCELLED",
          items: { updateMany: { where: {}, data: { status: "CANCELLED" } } },
        },
      });
    });

    return { ok: false, reason: "AMOUNT_MISMATCH" as const };
  }

  if (status === "PAID") {
    if (pay.status === "PAID")
      return { ok: true, alreadyApplied: true, status: "PAID" as const };

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { reservationId: pay.reservationId },
        data: {
          status: "PAID",
          provider: "portone_tosspayments",
          providerPaymentId: paymentId,
          paidAt: new Date(),
        },
      });

      await tx.reservation.update({
        where: { id: pay.reservationId },
        data: {
          status: "CONFIRMED",
          items: { updateMany: { where: {}, data: { status: "CONFIRMED" } } },
        },
      });

      await tx.notificationLog.create({
        data: {
          channel: "EMAIL",
          status: "SENT",
          userId: pay.reservation.userId,
          reservationId: pay.reservationId,
          title: "Payment confirmed (PortOne verify/webhook)",
          message: `paymentId=${paymentId} amount=${pay.amount}`,
          to: null,
          error: null,
        },
      });
    });

    return { ok: true, status: "PAID" as const };
  }

  if (status === "CANCELLED") {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { reservationId: pay.reservationId },
        data: { status: "CANCELLED" },
      });
      await tx.reservation.update({
        where: { id: pay.reservationId },
        data: {
          status: "CANCELLED",
          items: { updateMany: { where: {}, data: { status: "CANCELLED" } } },
        },
      });
    });

    return { ok: true, status: "CANCELLED" as const };
  }

  return { ok: true, status: status ?? "UNKNOWN" };
}
