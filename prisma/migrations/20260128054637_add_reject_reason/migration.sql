-- AlterEnum
ALTER TYPE "ReservationStatus" ADD VALUE 'NOSHOW';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adminMemo" TEXT,
ADD COLUMN     "isBlacklisted" BOOLEAN NOT NULL DEFAULT false;
