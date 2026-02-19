-- AlterTable
ALTER TABLE "ReservationItem" ADD COLUMN     "appliedPricingRuleId" TEXT,
ADD COLUMN     "appliedPricingRuleType" "PricingRuleType";
