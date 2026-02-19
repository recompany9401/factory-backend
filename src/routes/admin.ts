import { Router } from "express";
import { prisma } from "../db/prisma";
import { Prisma, BlockoutType, ResourceStatus } from "@prisma/client";

const router = Router();

// 통합 일정 조회
router.get("/schedule/:resourceId", async (req, res) => {
  const { resourceId } = req.params;
  const whereCondition = resourceId === "all" ? {} : { resourceId };

  try {
    const [blockouts, reservations] = await Promise.all([
      prisma.resourceBlockout.findMany({
        where: whereCondition,
        include: { resource: { select: { name: true } } },
      }),
      prisma.reservationItem.findMany({
        where: { ...whereCondition, status: "CONFIRMED" },
        include: {
          resource: { select: { name: true } },
          reservation: {
            include: {
              user: { select: { name: true, phone: true, email: true } },
            },
          },
        },
      }),
    ]);

    const events = [
      ...reservations.map((r) => ({
        id: `res-${r.id}`,
        title: `[예약] ${r.reservation.user.name}`,
        start: r.startAt,
        end: r.endAt,
        backgroundColor: "#91c31d",
        borderColor: "#91c31d",
        extendedProps: {
          type: "RESERVATION",
          resourceName: r.resource.name,
          userName: r.reservation.user.name,
          phone: r.reservation.user.phone,
          email: r.reservation.user.email,
        },
      })),
      ...blockouts.map((b) => ({
        id: `block-${b.id}`,
        title:
          b.type === BlockoutType.BLOCK
            ? `[차단] ${b.reason || "관리자 설정"}`
            : "[특근/허용]",
        start: b.startAt,
        end: b.endAt,
        backgroundColor: b.type === BlockoutType.BLOCK ? "#f64e60" : "#1bc5bd",
        borderColor: b.type === BlockoutType.BLOCK ? "#f64e60" : "#1bc5bd",
        extendedProps: {
          type: b.type,
          reason: b.reason,
          resourceName: b.resource.name,
        },
      })),
    ];

    res.json({
      events,
      holidays: [],
    });
  } catch (error) {
    res.status(500).json({ message: "일정 로드 실패" });
  }
});

// 예약 차단/허용 생성
router.post("/blockout", async (req, res) => {
  const { resourceId, startAt, endAt, reason, type } = req.body;
  const blockType = (type as BlockoutType) || BlockoutType.BLOCK;
  const start = new Date(startAt);
  const end = new Date(endAt);

  try {
    if (resourceId === "all") {
      const allResources = await prisma.resource.findMany({
        where: { status: ResourceStatus.ACTIVE },
        select: { id: true },
      });

      if (allResources.length === 0) {
        return res.status(400).json({ message: "차단할 리소스가 없습니다." });
      }

      await prisma.$transaction(
        allResources.map((res) =>
          prisma.resourceBlockout.create({
            data: {
              resourceId: res.id,
              startAt: start,
              endAt: end,
              reason: reason || "전체 차단 설정",
              type: blockType,
            },
          }),
        ),
      );

      return res.json({ success: true, count: allResources.length });
    } else {
      const blockout = await prisma.resourceBlockout.create({
        data: {
          resourceId,
          startAt: start,
          endAt: end,
          reason: reason || "관리자 설정",
          type: blockType,
        },
      });
      return res.json(blockout);
    }
  } catch (error) {
    console.error("차단 설정 에러:", error);
    res.status(500).json({ message: "차단 설정 실패" });
  }
});

// 차단 해제
router.delete("/blockout/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.resourceBlockout.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "해제 실패" });
  }
});

// 예약 목록 조회
router.get("/reservations", async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const startDate = req.query.startDate
      ? new Date(String(req.query.startDate))
      : undefined;
    const endDate = req.query.endDate
      ? new Date(String(req.query.endDate))
      : undefined;

    const whereCondition: any = {};
    if (startDate || endDate) {
      whereCondition.createdAt = {};
      if (startDate) whereCondition.createdAt.gte = startDate;
      if (endDate) {
        const adjustedEndDate = new Date(endDate);
        adjustedEndDate.setHours(23, 59, 59, 999);
        whereCondition.createdAt.lte = adjustedEndDate;
      }
    }

    const totalCount = await prisma.reservation.count({
      where: whereCondition,
    });

    const reservations = await prisma.reservation.findMany({
      where: whereCondition,
      skip,
      take: limit,
      include: {
        user: { select: { name: true, phone: true, email: true } },
        items: { include: { resource: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    const formattedData = reservations.map((res) => ({
      id: res.id,
      userName: res.user?.name || "알 수 없음",
      userPhone: res.user?.phone || "-",
      userEmail: res.user?.email || "-",
      resourceName: res.items[0]?.resource?.name || "정보 없음",
      startTime: res.createdAt,
      insuranceDocUrl: res.insuranceDocUrl,
      status: res.status,
      rejectReason: res.rejectReason,
    }));

    res.json({
      data: formattedData,
      meta: {
        total: totalCount,
        page,
        lastPage: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ message: "예약 로드 실패" });
  }
});

// 예약 상태 변경
router.patch("/reservations/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;

  try {
    const updatedReservation = await prisma.reservation.update({
      where: { id },
      data: {
        status,
        ...(status === "CANCELLED" && reason ? { rejectReason: reason } : {}),
      },
      include: {
        items: {
          include: { resource: true },
        },
      },
    });

    const resourceName =
      updatedReservation.items[0]?.resource.name || "예약 항목";
    let notiTitle = "";
    let notiMessage = "";

    if (status === "CONFIRMED") {
      notiTitle = "예약 승인 완료";
      notiMessage = `신청하신 [${resourceName}] 예약이 승인되었습니다.`;
    } else if (status === "CANCELLED") {
      notiTitle = "예약 반려 알림";
      notiMessage = `신청하신 [${resourceName}] 예약이 반려되었습니다. (사유: ${
        reason || "관리자 사유"
      })`;
    }

    if (notiTitle) {
      await prisma.notification.create({
        data: {
          userId: updatedReservation.userId,
          title: notiTitle,
          message: notiMessage,
          isRead: false,
          type: "RESERVATION",
        },
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("상태 변경 실패:", error);
    res.status(500).json({ message: "상태 변경 실패" });
  }
});

// 리소스 목록 조회
router.get("/resources", async (_req, res) => {
  try {
    const resources = await prisma.resource.findMany({
      where: { status: ResourceStatus.ACTIVE },
      include: {
        pricingRules: { where: { isActive: true }, take: 1 },
        schedules: { where: { scheduleType: "WEEKLY" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(resources);
  } catch (error) {
    res.status(500).json({ message: "리소스 로드 실패" });
  }
});

// 리소스 통합 등록
router.post("/resources", async (req, res) => {
  const { name, type, description, bookingUnit, hourlyPrice, businessHours } =
    req.body;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const resource = await tx.resource.create({
        data: {
          name,
          type,
          description,
          bookingUnit,
          status: ResourceStatus.ACTIVE,
        },
      });
      await tx.pricingRule.create({
        data: {
          resourceId: resource.id,
          ruleType: "DEFAULT",
          price: Number(hourlyPrice),
          isActive: true,
        },
      });
      const times = businessHours.split("-");
      await tx.resourceSchedule.create({
        data: {
          resourceId: resource.id,
          openTime: times[0]?.trim() || "09:00",
          closeTime: times[1]?.trim() || "18:00",
        },
      });
      return resource;
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "등록 실패" });
  }
});

// 리소스 수정
router.patch("/resources/:id", async (req, res) => {
  const { id } = req.params;
  const { name, description, bookingUnit, hourlyPrice, businessHours } =
    req.body;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.resource.update({
        where: { id },
        data: { name, description, bookingUnit },
      });
      if (hourlyPrice !== undefined) {
        await tx.pricingRule.updateMany({
          where: { resourceId: id, ruleType: "DEFAULT" },
          data: { price: Number(hourlyPrice) },
        });
      }
      if (businessHours) {
        const times = businessHours.split("-");
        await tx.resourceSchedule.updateMany({
          where: { resourceId: id, scheduleType: "WEEKLY" },
          data: {
            openTime: times[0]?.trim() || "09:00",
            closeTime: times[1]?.trim() || "18:00",
          },
        });
      }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "수정 실패" });
  }
});

// 리소스 삭제
router.delete("/resources/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.resource.update({
      where: { id },
      data: { status: ResourceStatus.DELETED },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "삭제 실패" });
  }
});

// 회원 목록 조회
router.get("/users", async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = String(req.query.search || "");

    const whereCondition: Prisma.UserWhereInput = {};
    if (search) {
      whereCondition.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
        { companyName: { contains: search } },
      ];
    }

    const totalCount = await prisma.user.count({ where: whereCondition });

    const users = await prisma.user.findMany({
      where: whereCondition,
      skip,
      take: limit,
      include: {
        _count: {
          select: {
            reservations: true,
          },
        },
        reservations: {
          take: 5,
          orderBy: { createdAt: "desc" },
          include: { items: { include: { resource: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const formattedUsers = await Promise.all(
      users.map(async (u) => {
        const noShowCount = await prisma.reservation.count({
          where: { userId: u.id, status: "NOSHOW" },
        });

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          companyName: u.companyName,
          isBlacklisted: u.isBlacklisted,
          adminMemo: u.adminMemo,
          totalReservations: u._count.reservations,
          noShowCount: noShowCount,
          recentReservations: u.reservations,
        };
      }),
    );

    res.json({
      data: formattedUsers,
      meta: {
        total: totalCount,
        page,
        lastPage: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "회원 목록 로드 실패" });
  }
});

// 회원 정보 수정
router.patch("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { isBlacklisted, adminMemo } = req.body;

  try {
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        isBlacklisted,
        adminMemo,
      },
    });
    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: "업데이트 실패" });
  }
});

// 게시글 목록 조회
router.get("/posts", async (req, res) => {
  try {
    const { type, page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (type) where.type = type;

    const total = await prisma.post.count({ where });
    const posts = await prisma.post.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: "desc" },
    });

    res.json({
      data: posts,
      meta: { total, page, lastPage: Math.ceil(total / Number(limit)) },
    });
  } catch (e) {
    res.status(500).json({ message: "로드 실패" });
  }
});

// 게시글 작성, 수정, 삭제
router.post("/posts", async (req, res) => {
  try {
    const post = await prisma.post.create({ data: req.body });
    res.json(post);
  } catch (e) {
    res.status(500).json({ message: "작성 실패" });
  }
});

router.patch("/posts/:id", async (req, res) => {
  try {
    const post = await prisma.post.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(post);
  } catch (e) {
    res.status(500).json({ message: "수정 실패" });
  }
});

router.delete("/posts/:id", async (req, res) => {
  try {
    await prisma.post.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: "삭제 실패" });
  }
});

// 팝업 목록 조회
router.get("/popups", async (req, res) => {
  try {
    const popups = await prisma.popup.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    });
    res.json(popups);
  } catch (e) {
    res.status(500).json({ message: "팝업 로드 실패" });
  }
});

// 팝업 등록
router.post("/popups", async (req, res) => {
  try {
    const { isActive } = req.body;

    if (isActive) {
      const activeCount = await prisma.popup.count({
        where: { isActive: true },
      });
      if (activeCount >= 5) {
        return res
          .status(400)
          .json({ message: "팝업은 동시에 최대 5개까지만 띄울 수 있습니다." });
      }
    }

    const popup = await prisma.popup.create({ data: req.body });
    res.json(popup);
  } catch (e) {
    res.status(500).json({ message: "팝업 등록 실패" });
  }
});

// 팝업 상태 수정
router.patch("/popups/:id", async (req, res) => {
  try {
    const { isActive } = req.body;

    if (isActive) {
      const activeCount = await prisma.popup.count({
        where: { isActive: true },
      });
      if (activeCount >= 5) {
        return res.status(400).json({
          message: "활성 팝업은 최대 5개입니다. 다른 팝업을 끄고 시도하세요.",
        });
      }
    }

    const popup = await prisma.popup.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(popup);
  } catch (e) {
    res.status(500).json({ message: "수정 실패" });
  }
});

router.delete("/popups/:id", async (req, res) => {
  try {
    await prisma.popup.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: "삭제 실패" });
  }
});

export default router;
