import { prisma } from "../db/prisma";

function hhmmToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function kstParts(d: Date) {
  const shifted = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return {
    dayOfWeek: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

export async function resolveUnitPrice(params: {
  resourceId: string;
  startAt: Date;
  userType: "PERSONAL" | "BUSINESS";
}) {
  const { resourceId, startAt, userType } = params;

  const { dayOfWeek, minutes } = kstParts(startAt);

  const rules = await prisma.pricingRule.findMany({
    where: { resourceId, isActive: true },
    orderBy: { createdAt: "desc" },
  });

  const matchTimeRange = (r: any) => {
    if (r.ruleType !== "TIME_RANGE") return false;
    if (!r.startTime || !r.endTime) return false;

    const s = hhmmToMinutes(r.startTime);
    const e = hhmmToMinutes(r.endTime);

    return minutes >= s && minutes < e;
  };

  const matchDayOfWeek = (r: any) =>
    r.ruleType === "DAY_OF_WEEK" && r.dayOfWeek === dayOfWeek;

  const matchUserType = (r: any) =>
    r.ruleType === "USER_TYPE" && r.userType === userType;

  const matchDefault = (r: any) => r.ruleType === "DEFAULT";

  const picked =
    rules.find(matchTimeRange) ||
    rules.find(matchDayOfWeek) ||
    rules.find(matchUserType) ||
    rules.find(matchDefault);

  if (!picked) throw new Error("NO_PRICING_RULE");

  return {
    unitPrice: picked.price,
    ruleId: picked.id,
    ruleType: picked.ruleType as string,
  };
}
