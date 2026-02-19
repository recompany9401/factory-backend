import { Router } from "express";
import { prisma } from "../db/prisma";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const resources = await prisma.resource.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        pricingRules: {
          where: { ruleType: "DEFAULT", isActive: true },
          take: 1,
        },
      },
    });

    const formattedResources = resources.map((res: any) => ({
      ...res,
      category: res.type === "SECTION" ? "SPACE" : res.type,
      price: res.pricingRules?.[0]?.price ?? 0,
      description: res.description ?? "설명이 없습니다.",
    }));

    res.json(formattedResources);
  } catch (error) {
    console.error("자원 목록 조회 실패:", error);
    res.status(500).json({ message: "서버 에러 발생" });
  }
});

router.get("/sections", async (_req, res) => {
  const data = await prisma.resource.findMany({
    where: { type: "SECTION" },
    orderBy: { createdAt: "asc" },
  });
  res.json(data);
});

router.get("/equipments", async (_req, res) => {
  const data = await prisma.resource.findMany({
    where: { type: "EQUIPMENT" },
    orderBy: { createdAt: "asc" },
  });
  res.json(data);
});

export default router;
