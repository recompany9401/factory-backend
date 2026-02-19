import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

router.get("/", async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const activePopups = await prisma.popup.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: startOfToday },
      },
      orderBy: { startDate: "desc" },
    });
    res.json(activePopups);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "팝업 조회 실패" });
  }
});

export default router;
