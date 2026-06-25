-- CreateEnum
CREATE TYPE "StudioStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'owner', 'staff', 'client');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('booked', 'cancelled', 'late_cancelled', 'no_show', 'waitlist', 'attended');

-- CreateEnum
CREATE TYPE "MembershipType" AS ENUM ('monthly_unlimited', 'monthly_limited', 'punch_card');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active', 'expired', 'cancelled', 'frozen');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('lead', 'active', 'inactive', 'frozen');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('booked', 'cancelled', 'late_cancelled', 'no_show', 'completed');

-- CreateTable
CREATE TABLE "studios" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "StudioStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_settings" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "cancellation_window_hours" INTEGER NOT NULL DEFAULT 12,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "studio_id" UUID,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "client_status" "ClientStatus",
    "health_declaration" BOOLEAN NOT NULL DEFAULT false,
    "medical_notes" TEXT,
    "birth_date" DATE,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "instructor_id" UUID,
    "capacity" INTEGER NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "recurrence_rule" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "membership_id" UUID,
    "status" "BookingStatus" NOT NULL DEFAULT 'booked',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "type" "MembershipType" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "total_punches" INTEGER,
    "remaining_punches" INTEGER,
    "classes_per_period" INTEGER,
    "classes_used_this_period" INTEGER NOT NULL DEFAULT 0,
    "current_period_start" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "frozen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_blocks" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availability_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "membership_id" UUID,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'booked',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "studios_slug_key" ON "studios"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "studio_settings_studio_id_key" ON "studio_settings"("studio_id");

-- CreateIndex
CREATE INDEX "users_studio_id_idx" ON "users"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_studio_id_email_key" ON "users"("studio_id", "email");

-- CreateIndex
CREATE INDEX "classes_studio_id_idx" ON "classes"("studio_id");

-- CreateIndex
CREATE INDEX "classes_studio_id_start_time_idx" ON "classes"("studio_id", "start_time");

-- CreateIndex
CREATE INDEX "bookings_studio_id_idx" ON "bookings"("studio_id");

-- CreateIndex
CREATE INDEX "bookings_studio_id_class_id_idx" ON "bookings"("studio_id", "class_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_class_id_client_id_key" ON "bookings"("class_id", "client_id");

-- CreateIndex
CREATE INDEX "memberships_studio_id_idx" ON "memberships"("studio_id");

-- CreateIndex
CREATE INDEX "memberships_studio_id_client_id_idx" ON "memberships"("studio_id", "client_id");

-- CreateIndex
CREATE INDEX "services_studio_id_idx" ON "services"("studio_id");

-- CreateIndex
CREATE INDEX "availability_blocks_studio_id_idx" ON "availability_blocks"("studio_id");

-- CreateIndex
CREATE INDEX "availability_blocks_studio_id_provider_id_idx" ON "availability_blocks"("studio_id", "provider_id");

-- CreateIndex
CREATE INDEX "appointments_studio_id_idx" ON "appointments"("studio_id");

-- CreateIndex
CREATE INDEX "appointments_studio_id_provider_id_start_time_idx" ON "appointments"("studio_id", "provider_id", "start_time");

-- AddForeignKey
ALTER TABLE "studio_settings" ADD CONSTRAINT "studio_settings_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
