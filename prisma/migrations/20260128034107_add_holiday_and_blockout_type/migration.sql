-- CreateEnum
CREATE TYPE "BlockoutType" AS ENUM ('BLOCK', 'ALLOW');

-- AlterTable
ALTER TABLE "ResourceBlockout" ADD COLUMN     "type" "BlockoutType" NOT NULL DEFAULT 'BLOCK';

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");
