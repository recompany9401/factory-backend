-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('ACTIVE', 'DELETED');

-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE';
