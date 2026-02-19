import { Router } from "express";
import resourcesRouter from "./resources";
import postsRouter from "./posts";
import pricingRouter from "./pricing";
import schedulesRouter from "./schedules";
import authRouter from "./auth";
import reservationsRouter from "./reservations";
import adminOpsRouter from "./adminOps";
import paymentsRouter from "./payments";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

router.use("/resources", resourcesRouter);
router.use("/posts", postsRouter);
router.use("/pricing", pricingRouter);
router.use("/schedules", schedulesRouter);
router.use("/auth", authRouter);
router.use("/reservations", reservationsRouter);
router.use("/admin", adminOpsRouter);
router.use("/payments", paymentsRouter);

export default router;
