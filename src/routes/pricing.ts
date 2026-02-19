import { Router } from "express";
import { prisma } from "../db/prisma";

const router = Router();

router.get("/:resourceId", async (req, res) => {
  const data = await prisma.pricingRule.findMany({
    where: { resourceId: req.params.resourceId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(data);
});

export default router;
