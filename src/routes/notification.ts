import { Router } from "express";
import { prisma } from "../db/prisma";
import { authenticateToken } from "../middlewares/auth";

const router = Router();

router.get("/", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;

  try {
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false },
    });

    res.json({ notifications, unreadCount });
  } catch (error) {
    res.status(500).json({ message: "알림 조회 중 오류가 발생했습니다." });
  }
});

router.patch("/:id/read", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;
  const notificationId = req.params.id;

  try {
    const updated = await prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId: userId,
      },
      data: { isRead: true },
    });

    if (updated.count === 0) {
      return res.status(404).json({ message: "알림을 찾을 수 없습니다." });
    }

    res.json({ message: "읽음 처리되었습니다." });
  } catch (error) {
    res.status(500).json({ message: "처리 실패" });
  }
});

router.patch("/read-all", authenticateToken, async (req: any, res) => {
  const userId = req.user.userId;

  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });

  res.json({ message: "모두 읽음 처리되었습니다." });
});

export default router;
