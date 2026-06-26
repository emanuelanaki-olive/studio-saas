-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'meeting_scheduled', 'trial_scheduled', 'converted', 'lost');

-- CreateEnum
CREATE TYPE "LeadTaskType" AS ENUM ('follow_up', 'call', 'meeting', 'other');

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_lost_reasons" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_lost_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "source_id" UUID,
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "assigned_to_id" UUID,
    "lost_reason_id" UUID,
    "notes" TEXT,
    "converted_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_tasks" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "assigned_to_id" UUID,
    "type" "LeadTaskType" NOT NULL DEFAULT 'follow_up',
    "description" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_sources_studio_id_idx" ON "lead_sources"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_studio_id_name_key" ON "lead_sources"("studio_id", "name");

-- CreateIndex
CREATE INDEX "lead_lost_reasons_studio_id_idx" ON "lead_lost_reasons"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_lost_reasons_studio_id_name_key" ON "lead_lost_reasons"("studio_id", "name");

-- CreateIndex
CREATE INDEX "leads_studio_id_idx" ON "leads"("studio_id");

-- CreateIndex
CREATE INDEX "leads_studio_id_status_idx" ON "leads"("studio_id", "status");

-- CreateIndex
CREATE INDEX "lead_tasks_studio_id_idx" ON "lead_tasks"("studio_id");

-- CreateIndex
CREATE INDEX "lead_tasks_studio_id_due_at_idx" ON "lead_tasks"("studio_id", "due_at");

-- AddForeignKey
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_lost_reasons" ADD CONSTRAINT "lead_lost_reasons_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_lost_reason_id_fkey" FOREIGN KEY ("lost_reason_id") REFERENCES "lead_lost_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_user_id_fkey" FOREIGN KEY ("converted_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
