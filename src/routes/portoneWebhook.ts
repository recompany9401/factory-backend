import { Router } from "express";
import { Webhook } from "@portone/server-sdk";
import { env } from "../utils/env";
import { verifyAndApplyPayment } from "../modules/portone";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const rawBody = req.body as unknown as string;

    const webhook = await Webhook.verify(
      env.PORTONE_WEBHOOK_SECRET,
      rawBody,
      req.headers,
    );

    if (!Webhook.isUnrecognizedWebhook(webhook)) {
      if (webhook.type === "Transaction.Paid") {
        await verifyAndApplyPayment(webhook.data.paymentId);
      }
      if (webhook.type === "Transaction.Cancelled") {
        await verifyAndApplyPayment(webhook.data.paymentId);
      }
    }

    return res.status(200).end();
  } catch {
    return res.status(400).end();
  }
});

export default router;
