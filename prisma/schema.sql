-- =============================================================
-- PostgreSQL Schema — Multi-Tenant Studio SaaS Platform
-- =============================================================
-- This is the raw-SQL equivalent of prisma/schema.prisma.
-- Generated for reference / for teams running migrations outside
-- Prisma Migrate (e.g. directly in Supabase SQL editor).
--
-- Tenancy model: single database, shared schema, studio_id FK on
-- every tenant-scoped table. Row Level Security (RLS) policies are
-- included as defense-in-depth for Supabase deployments — even
-- though the app layer also enforces studio_id filtering.
--
-- Two parallel booking tracks:
--   Track A (classes/bookings)               — fixed-schedule group classes
--   Track B (services/availability_blocks/appointments) — 1-on-1, on-demand
-- =============================================================

create extension if not exists "uuid-ossp";

-- -------------------------------------------------------------
-- ENUMS
-- -------------------------------------------------------------

create type studio_status as enum ('active', 'suspended');

create type user_role as enum ('super_admin', 'owner', 'staff', 'client');

create type booking_status as enum (
  'booked', 'cancelled', 'late_cancelled', 'no_show', 'waitlist', 'attended'
);

create type membership_type as enum ('monthly_unlimited', 'monthly_limited', 'punch_card');

create type membership_status as enum ('active', 'expired', 'cancelled', 'frozen');

create type client_status as enum ('lead', 'active', 'inactive', 'frozen');

create type appointment_status as enum (
  'booked', 'cancelled', 'late_cancelled', 'no_show', 'completed'
);

-- -------------------------------------------------------------
-- TENANT ROOT: studios
-- -------------------------------------------------------------

create table studios (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  slug       text not null unique,
  status     studio_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_studios_slug on studios (slug);

-- -------------------------------------------------------------
-- studio_settings (1:1 with studios — operational policy config)
-- -------------------------------------------------------------

create table studio_settings (
  id                        uuid primary key default uuid_generate_v4(),
  studio_id                 uuid not null unique references studios (id) on delete cascade,
  -- Hours before a class/appointment start time a client can still
  -- cancel WITHOUT losing their credit. Cancelling inside this
  -- window -> status becomes late_cancelled, credit not refunded.
  cancellation_window_hours integer not null default 12,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- -------------------------------------------------------------
-- users (studio_id nullable only for super_admin rows)
-- -------------------------------------------------------------
-- NOTE: in practice, `id` is always supplied explicitly by the app
-- to match the corresponding Supabase auth.users.id (see
-- src/lib/auth.ts and src/app/api/studios/route.ts in the Next.js
-- app) — the default below only applies to rows inserted without an
-- explicit id (e.g. ad-hoc scripts).

create table users (
  id                 uuid primary key default uuid_generate_v4(),
  studio_id          uuid references studios (id) on delete cascade,
  email              text not null,
  full_name          text not null,
  phone              text,
  role               user_role not null,
  -- CRM fields (clients only, but harmless on staff/owner rows)
  client_status      client_status,
  health_declaration boolean not null default false,
  medical_notes      text,
  birth_date         date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint uq_users_studio_email unique (studio_id, email)
);

create index idx_users_studio_id on users (studio_id);

-- -------------------------------------------------------------
-- classes
-- -------------------------------------------------------------

create table classes (
  id              uuid primary key default uuid_generate_v4(),
  studio_id       uuid not null references studios (id) on delete cascade,
  title           text not null,
  instructor_id   uuid references users (id),
  capacity        integer not null check (capacity > 0),
  start_time      timestamptz not null,
  end_time        timestamptz not null,
  recurrence_rule text, -- iCal RRULE string, e.g. 'FREQ=WEEKLY;BYDAY=MO,WE'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint chk_class_time_order check (end_time > start_time)
);

create index idx_classes_studio_id on classes (studio_id);
create index idx_classes_studio_start on classes (studio_id, start_time);

-- -------------------------------------------------------------
-- memberships
-- -------------------------------------------------------------

create table memberships (
  id                       uuid primary key default uuid_generate_v4(),
  studio_id                uuid not null references studios (id) on delete cascade,
  client_id                uuid not null references users (id),
  type                     membership_type not null,
  status                   membership_status not null default 'active',

  -- punch_card fields: fixed pool, never resets
  total_punches            integer,
  remaining_punches        integer,

  -- monthly_limited fields: resets each period
  classes_per_period       integer,
  classes_used_this_period integer not null default 0,
  current_period_start     timestamptz,

  -- monthly_unlimited & monthly_limited: expiry
  expires_at               timestamptz,

  -- freeze tracking: when frozen, expires_at does not advance.
  -- frozen_at records when the freeze started so unfreezing can push
  -- expires_at forward by exactly the frozen duration.
  frozen_at                timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint chk_punches_nonnegative check (remaining_punches is null or remaining_punches >= 0)
);

create index idx_memberships_studio_id on memberships (studio_id);
create index idx_memberships_studio_client on memberships (studio_id, client_id);

-- -------------------------------------------------------------
-- bookings
-- -------------------------------------------------------------

create table bookings (
  id            uuid primary key default uuid_generate_v4(),
  studio_id     uuid not null references studios (id) on delete cascade,
  class_id      uuid not null references classes (id) on delete cascade,
  client_id     uuid not null references users (id),
  -- Which membership this booking drew a credit from, if any (null
  -- for monthly_unlimited, which never decrements anything). Storing
  -- this — rather than re-deriving "the client's active membership"
  -- at cancellation time — is what makes refunds exact even if a
  -- client has switched memberships between booking and cancelling.
  membership_id uuid references memberships (id),
  status        booking_status not null default 'booked',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint uq_booking_class_client unique (class_id, client_id)
);

create index idx_bookings_studio_id on bookings (studio_id);
create index idx_bookings_studio_class on bookings (studio_id, class_id);

-- -------------------------------------------------------------
-- services (Track B: 1-on-1 offerings, e.g. "Personal Training - 60min")
-- -------------------------------------------------------------

create table services (
  id           uuid primary key default uuid_generate_v4(),
  studio_id    uuid not null references studios (id) on delete cascade,
  name         text not null,
  duration_min integer not null,
  description  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_services_studio_id on services (studio_id);

-- -------------------------------------------------------------
-- availability_blocks — recurring working hours per instructor
-- -------------------------------------------------------------
-- e.g. "Mondays 08:00-12:00" -> day_of_week=1, start_minute=480,
-- end_minute=720. Appointments are only bookable inside a block
-- that belongs to the chosen provider and doesn't already overlap
-- another appointment for that provider (enforced application-side,
-- the same way bookings.ts enforces class capacity).

create table availability_blocks (
  id           uuid primary key default uuid_generate_v4(),
  studio_id    uuid not null references studios (id) on delete cascade,
  provider_id  uuid not null references users (id),
  day_of_week  integer not null check (day_of_week between 0 and 6), -- 0 = Sunday
  start_minute integer not null check (start_minute >= 0 and start_minute < 1440),
  end_minute   integer not null check (end_minute > 0 and end_minute <= 1440),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint chk_availability_time_order check (end_minute > start_minute)
);

create index idx_availability_studio_id on availability_blocks (studio_id);
create index idx_availability_studio_provider on availability_blocks (studio_id, provider_id);

-- -------------------------------------------------------------
-- appointments — 1-on-1, on-demand bookings against a provider's
-- availability, distinct from the fixed-schedule classes table.
-- -------------------------------------------------------------

create table appointments (
  id            uuid primary key default uuid_generate_v4(),
  studio_id     uuid not null references studios (id) on delete cascade,
  service_id    uuid not null references services (id),
  provider_id   uuid not null references users (id),
  client_id     uuid not null references users (id),
  membership_id uuid references memberships (id),
  start_time    timestamptz not null,
  end_time      timestamptz not null,
  status        appointment_status not null default 'booked',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint chk_appointment_time_order check (end_time > start_time)
);

create index idx_appointments_studio_id on appointments (studio_id);
create index idx_appointments_studio_provider_start on appointments (studio_id, provider_id, start_time);

-- -------------------------------------------------------------
-- updated_at auto-touch trigger (applied to every tenant table)
-- -------------------------------------------------------------

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_studios_updated_at before update on studios
  for each row execute function set_updated_at();
create trigger trg_studio_settings_updated_at before update on studio_settings
  for each row execute function set_updated_at();
create trigger trg_users_updated_at before update on users
  for each row execute function set_updated_at();
create trigger trg_classes_updated_at before update on classes
  for each row execute function set_updated_at();
create trigger trg_bookings_updated_at before update on bookings
  for each row execute function set_updated_at();
create trigger trg_memberships_updated_at before update on memberships
  for each row execute function set_updated_at();
create trigger trg_services_updated_at before update on services
  for each row execute function set_updated_at();
create trigger trg_availability_blocks_updated_at before update on availability_blocks
  for each row execute function set_updated_at();
create trigger trg_appointments_updated_at before update on appointments
  for each row execute function set_updated_at();

-- =============================================================
-- ROW LEVEL SECURITY (defense-in-depth for Supabase)
-- =============================================================
-- This assumes the app sets a Postgres session variable
-- `app.current_studio_id` per request (see src/lib/db.ts).
-- If you are NOT on Supabase / not using session variables,
-- you can skip this section and rely solely on app-layer filtering —
-- but it is strongly recommended as a second line of defense.
-- =============================================================

alter table users enable row level security;
alter table classes enable row level security;
alter table bookings enable row level security;
alter table memberships enable row level security;
alter table services enable row level security;
alter table availability_blocks enable row level security;
alter table appointments enable row level security;
alter table studio_settings enable row level security;

create policy tenant_isolation_users on users
  using (studio_id = current_setting('app.current_studio_id', true)::uuid);

create policy tenant_isolation_classes on classes
  using (studio_id = current_setting('app.current_studio_id', true)::uuid);

create policy tenant_isolation_bookings on bookings
  using (studio_id = current_setting('app.current_studio_id', true)::uuid);

create policy tenant_isolation_memberships on memberships
  using (studio_id = current_setting('app.current_studio_id', true)::uuid);

create policy tenant_isolation_services on services
  using (studio_id = current_setting('app.current_studio_id', true)::uuid);

create policy tenant_isolation_availability_blocks on availability_blocks
  using (studio_id = current_setting('app.current_studio_id', true)::uuid);

create policy tenant_isolation_appointments on appointments
  using (studio_id = current_setting('app.current_studio_id', true)::uuid);

create policy tenant_isolation_studio_settings on studio_settings
  using (studio_id = current_setting('app.current_studio_id', true)::uuid);
