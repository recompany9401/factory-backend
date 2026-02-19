import "dotenv/config";
import { prisma } from "../src/db/prisma";
import bcrypt from "bcrypt";
import {
  PostType,
  PostStatus,
  UserRole,
  UserType,
  ResourceType,
  BookingUnit,
} from "@prisma/client";

async function main() {
  const adminLoginId = "admin";
  const adminPlainPassword = "koad9401!@";
  const adminPasswordHash = await bcrypt.hash(adminPlainPassword, 10);

  console.log("데이터 시딩 시작...");

  const admin = await prisma.user.upsert({
    where: {
      loginId: adminLoginId,
    } as any,
    update: {
      passwordHash: adminPasswordHash,
      name: "최고관리자",
      userRole: UserRole.ADMIN,
      userType: UserType.BUSINESS,
    },
    create: {
      loginId: adminLoginId,
      passwordHash: adminPasswordHash,
      name: "최고관리자",
      userRole: UserRole.ADMIN,
      userType: UserType.BUSINESS,
      companyName: "팝업 팩토리",
      businessNumber: "000-00-00000",
    },
  });

  console.log("기존 데이터 초기화 중...");
  await prisma.pricingRule.deleteMany({});
  await prisma.resourceSchedule.deleteMany({});
  await prisma.resourceBlockout.deleteMany({});
  await prisma.reservationItem.deleteMany({});
  await prisma.reservation.deleteMany({});
  await prisma.post.deleteMany({});

  const sectionNames = ["Section A", "Section B", "Section C", "Section D"];
  const sections: Array<{ id: string; name: string }> = [];

  for (const name of sectionNames) {
    const existing = await prisma.resource.findFirst({
      where: { type: ResourceType.SECTION, name },
      select: { id: true, name: true },
    });

    if (existing) {
      const updated = await prisma.resource.update({
        where: { id: existing.id },
        data: {
          description: `${name} 워크스페이스`,
          bookingUnit: BookingUnit.TIME,
          mainSectionId: null,
        },
        select: { id: true, name: true },
      });
      sections.push(updated);
    } else {
      const created = await prisma.resource.create({
        data: {
          type: ResourceType.SECTION,
          name,
          description: `${name} 워크스페이스`,
          bookingUnit: BookingUnit.TIME,
        },
        select: { id: true, name: true },
      });
      sections.push(created);
    }
  }

  const sectionAId = sections[0].id;

  const equipmentSeeds = [
    { name: "레이저 커터", description: "기본 레이저 커팅 장비" },
    { name: "3D 프린터", description: "FDM 방식 3D 프린팅 장비" },
  ];

  for (const e of equipmentSeeds) {
    const existing = await prisma.resource.findFirst({
      where: { type: ResourceType.EQUIPMENT, name: e.name },
      select: { id: true },
    });

    if (existing) {
      await prisma.resource.update({
        where: { id: existing.id },
        data: {
          description: e.description,
          bookingUnit: BookingUnit.TIME,
          mainSectionId: sectionAId,
        },
      });
    } else {
      await prisma.resource.create({
        data: {
          type: ResourceType.EQUIPMENT,
          name: e.name,
          description: e.description,
          bookingUnit: BookingUnit.TIME,
          mainSectionId: sectionAId,
        },
      });
    }
  }

  const consultingSeeds = [
    { name: "제조 컨설팅", description: "공정 / 비용 / 소싱 가이드" },
    { name: "디자인 리뷰", description: "프로토타입 디자인 검토 세션" },
  ];

  for (const c of consultingSeeds) {
    const existing = await prisma.resource.findFirst({
      where: { type: ResourceType.CONSULTING, name: c.name },
      select: { id: true },
    });

    if (existing) {
      await prisma.resource.update({
        where: { id: existing.id },
        data: {
          description: c.description,
          bookingUnit: BookingUnit.TIME,
          mainSectionId: null,
        },
      });
    } else {
      await prisma.resource.create({
        data: {
          type: ResourceType.CONSULTING,
          name: c.name,
          description: c.description,
          bookingUnit: BookingUnit.TIME,
        },
      });
    }
  }

  for (const s of sections) {
    await prisma.pricingRule.create({
      data: {
        resourceId: s.id,
        ruleType: "DEFAULT",
        price: 50000,
        isActive: true,
      },
    });

    for (let dow = 1; dow <= 5; dow++) {
      await prisma.resourceSchedule.create({
        data: {
          resourceId: s.id,
          scheduleType: "WEEKLY",
          dayOfWeek: dow,
          openTime: "09:00",
          closeTime: "18:00",
        },
      });
    }
  }

  await prisma.post.createMany({
    data: [
      {
        type: PostType.GOV_SUPPORT,
        status: PostStatus.PUBLISHED,
        title: "2026년도 창업 성장 기술개발사업 공고",
        content: "<p>스타트업을 위한 기술개발 지원사업 공고 내용입니다...</p>",
        thumbnailUrl: "https://placehold.co/150?text=GovSupport",
      },
      {
        type: PostType.POLICY,
        status: PostStatus.PUBLISHED,
        title: "소상공인 정책자금 운용 계획 알림",
        content: "<p>정책자금 운용 계획에 대한 상세 안내입니다...</p>",
        thumbnailUrl: "https://placehold.co/150?text=Policy",
      },
      {
        type: PostType.NOTICE,
        status: PostStatus.PUBLISHED,
        title: "팝업 팩토리 설 연휴 휴관 안내",
        content:
          "<p>설 연휴 기간 동안 휴관하오니 이용에 착오 없으시길 바랍니다.</p>",
        thumbnailUrl: "https://placehold.co/150?text=Notice",
      },
      {
        type: PostType.PRESS,
        status: PostStatus.PUBLISHED,
        title: "팝업 팩토리, 지역 제조 혁신 거점으로 선정",
        content: "<p>관련 보도자료 내용입니다...</p>",
        thumbnailUrl: "https://placehold.co/150?text=Press",
      },
    ],
  });

  console.log("Seed 완료:", {
    adminId: admin.id,
    adminLoginId,
    sections: sections.map((s) => s.name),
  });
}

main()
  .catch((e) => {
    console.error("Seed 에러 발생:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
