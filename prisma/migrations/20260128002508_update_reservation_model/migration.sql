-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "endTime" TIMESTAMP(3),
ADD COLUMN     "resourceId" TEXT,
ADD COLUMN     "startTime" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
