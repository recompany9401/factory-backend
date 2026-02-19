import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { authenticateToken, AuthRequest } from "../middlewares/auth";
import { env } from "../utils/env";
import {
  buildPortOnePaymentId,
  verifyAndApplyPayment,
} from "../modules/portone";

const router = Router();

router.post("/checkout", authenticateToken, async (req: AuthRequest, res) => {
  const schema = z.object({
    reservationId: z.string().uuid(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ message: "Invalid body", issues: parsed.error.issues });

  const { reservationId } = parsed.data;

  const rsv = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { payment: true, user: true },
  });

  if (!rsv) return res.status(404).json({ message: "Not Found" });
  if (rsv.userId !== req.user!.userId)
    return res.status(403).json({ message: "Forbidden" });
  if (!rsv.payment)
    return res.status(409).json({ message: "No payment record" });
  if (rsv.payment.status !== "PENDING")
    return res.status(409).json({ message: "Payment not pending" });

  const paymentId =
    rsv.payment.providerPaymentId ?? buildPortOnePaymentId(reservationId);

  if (!rsv.payment.providerPaymentId) {
    await prisma.payment.update({
      where: { reservationId },
      data: { provider: "portone_tosspayments", providerPaymentId: paymentId },
    });
  }

  return res.json({
    storeId: env.PORTONE_STORE_ID,
    channelKey: env.PORTONE_CHANNEL_KEY,
    paymentId,
    orderName: `Reservation ${reservationId.slice(0, 8)}`,
    totalAmount: rsv.payment.amount,
    currency: "KRW",
    customer: {
      customerId: rsv.userId,
      fullName: rsv.user?.name ?? undefined,
      phoneNumber: rsv.user?.phone ?? undefined,
      email: rsv.user?.email ?? undefined,
    },
    customData: {
      reservationId,
      userId: rsv.userId,
      expectedAmount: rsv.payment.amount,
    },
  });
});

router.post("/complete", authenticateToken, async (req: AuthRequest, res) => {
  const schema = z.object({ paymentId: z.string().min(6).max(64) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ message: "Invalid body", issues: parsed.error.issues });

  try {
    console.log(`[결제 검증 시작] Payment ID: ${parsed.data.paymentId}`);
    const result = await verifyAndApplyPayment(parsed.data.paymentId);
    console.log(`[결제 검증 성공]`, result);
    return res.json(result);
  } catch (error: any) {
    console.error("====================================");
    console.error("[결제 검증 실패 - 상세 에러 로그]");
    console.error("Error Name:", error.name);
    console.error("Error Message:", error.message);
    if (error.cause) console.error("Cause:", error.cause);
    console.error("====================================");

    return res.status(500).json({
      message: "결제 검증 실패",
      error: error.message,
    });
  }
});

export default router;
