import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

router.get("/", async (req, res) => {
  try {
    const now = new Date();

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const [
      totalUsers,
      pendingReservations,
      todayReservations,
      activeResources,
      recentReservations,
      reservationStats,
    ] = await Promise.all([
      prisma.user.count(),

      prisma.reservation.count({
        where: { status: "PENDING" },
      }),

      prisma.reservation.count({
        where: {
          startTime: {
            gte: startOfToday,
            lte: endOfToday,
          },
          status: { not: "CANCELLED" },
        },
      }),

      prisma.resource ? prisma.resource.count() : 0,

      prisma.reservation.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true, email: true } },
          resource: { select: { name: true } },
        },
      }),

      prisma.reservation.findMany({
        take: 100,
        where: { startTime: { not: null } },
        orderBy: { startTime: "asc" },
        select: { startTime: true },
      }),
    ]);

    const chartDataMap = new Map<string, number>();

    reservationStats.forEach((r) => {
      if (!r.startTime) return;
      const date = new Date(r.startTime);
      const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      chartDataMap.set(monthStr, (chartDataMap.get(monthStr) || 0) + 1);
    });

    const chartData = Array.from(chartDataMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(-6);

    res.json({
      counts: {
        totalUsers,
        pendingReservations,
        todayReservations,
        activeResources,
      },
      recentReservations: recentReservations.map((r) => ({
        ...r,
        usageDate: r.startTime
          ? new Date(r.startTime).toLocaleDateString()
          : "미정",
        appliedAt: new Date(r.createdAt).toLocaleDateString(),
      })),
      chartData,
    });
  } catch (error) {
    console.error("대시보드 에러:", error);
    res.status(500).json({ message: "서버 에러 발생" });
  }
});

export default router;
