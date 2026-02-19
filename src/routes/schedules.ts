import { Router } from "express";
import { prisma } from "../db/prisma";

const router = Router();

router.get("/:resourceId", async (req, res) => {
  const data = await prisma.resourceSchedule.findMany({
    where: { resourceId: req.params.resourceId },
    orderBy: [{ scheduleType: "asc" }, { dayOfWeek: "asc" }, { date: "asc" }],
  });
  res.json(data);
});

export default router;
