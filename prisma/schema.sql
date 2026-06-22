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
-- =============================================================

create extension if not exists "uuid-ossp";

-- -------------------------------------------------------------
-- ENUMS
-- -------------------------------------------------------------

create type studio_status as enum ('active', 'suspended');

create type user_role as enum ('super_admin', 'owner', 'staff', 'client');

create type booking_status as enum ('booked', 'cancelled', 'waitlist', 'attended', 'no_show');

create type membership_type as enum ('monthly_subscription', 'punch_card');

create type membership_status as enum ('active', 'expired', 'cancelled');

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
-- users (studio_id nullable only for super_admin rows)
-- -------------------------------------------------------------
-- NOTE: in practice, `id` is always supplied explicitly by the app
-- to match the corresponding Supabase auth.users.id (see
-- src/lib/auth.ts and src/app/api/studios/route.ts in the Next.js
-- app) — the default below only applies to rows inserted without an
-- explicit id (e.g. ad-hoc scripts).

create table users (
  id         uuid primary key default uuid_generate_v4(),
  studio_id  uuid references studios (id) on delete cascade,
  email      text not null,
  full_name  text not null,
  phone      text,
  role       user_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

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
-- bookings
-- -------------------------------------------------------------

create table bookings (
  id         uuid primary key default uuid_generate_v4(),
  studio_id  uuid not null references studios (id) on delete cascade,
  class_id   uuid not null references classes (id) on delete cascade,
  client_id  uuid not null references users (id),
  status     booking_status not null default 'booked',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_booking_class_client unique (class_id, client_id)
);

create index idx_bookings_studio_id on bookings (studio_id);
create index idx_bookings_studio_class on bookings (studio_id, class_id);

-- -------------------------------------------------------------
-- memberships
-- -------------------------------------------------------------

create table memberships (
  id                uuid primary key default uuid_generate_v4(),
  studio_id         uuid not null references studios (id) on delete cascade,
  client_id         uuid not null references users (id),
  type              membership_type not null,
  status            membership_status not null default 'active',
  total_punches     integer,
  remaining_punches integer,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint chk_punches_nonnegative check (remaining_punches is null or remaining_punches >= 0)
);

create index idx_memberships_studio_id on memberships (studio_id);
create index idx_memberships_studio_client on memberships (studio_id, client_id);

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
create trigger trg_users_updated_at before update on users
  for each row execute function set_updated_at();
create trigger trg_classes_updated_at before update on classes
  for each row execute function set_updated_at();
create trigger trg_bookings_updated_at before update on bookings
  for each row execute function set_updated_at();
create trigger trg_memberships_updated_at before update on memberships
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

create policy tenant_isolation_users on users
  using (studio_id = current_setting('app.current_studio_id', true)::uuid);

create policy tenant_isolation_classes on classes
  using (studio_id = current_setting('app.current_studio_id', true)::uuid);

create policy tenant_isolation_bookings on bookings
  using (studio_id = current_setting('app.current_studio_id', true)::uuid);

create policy tenant_isolation_memberships on memberships
  using (studio_id = current_setting('app.current_studio_id', true)::uuid);

-- =============================================================
-- FUTURE MODULE (Phase 2) — Service / Appointment tables
-- =============================================================
-- create table services (
--   id           uuid primary key default uuid_generate_v4(),
--   studio_id    uuid not null references studios (id) on delete cascade,
--   name         text not null,
--   duration_min integer not null,
--   price        numeric(10,2) not null,
--   created_at   timestamptz not null default now()
-- );
--
-- create table appointments (
--   id           uuid primary key default uuid_generate_v4(),
--   studio_id    uuid not null references studios (id) on delete cascade,
--   service_id   uuid not null references services (id),
--   provider_id  uuid not null references users (id),
--   client_id    uuid not null references users (id),
--   start_time   timestamptz not null,
--   end_time     timestamptz not null,
--   status       booking_status not null default 'booked',
--   created_at   timestamptz not null default now()
-- );
-- Same studio_id pattern — no changes needed to middleware or RLS approach.
