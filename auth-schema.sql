-- Applianzo Auth Schema
-- Run in Neon SQL Editor. Safe to re-run.

create table if not exists users (
  id                bigserial primary key,
  email             text unique not null,
  password_hash     text,                        -- null for OAuth-only users
  full_name         text,
  city              text,
  country           text,
  pincode           text,
  role              text not null default 'user', -- 'user' | 'admin' | 'superadmin'
  provider          text not null default 'email',-- 'email' | 'google' | 'facebook'
  provider_id       text,                         -- OAuth provider user ID
  email_verified    boolean not null default false,
  avatar_url        text,
  is_active         boolean not null default true,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists email_verifications (
  id         bigserial primary key,
  user_id    bigint not null references users(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null,
  used       boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists password_resets (
  id         bigserial primary key,
  user_id    bigint not null references users(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null,
  used       boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists sessions (
  id         bigserial primary key,
  user_id    bigint not null references users(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_users_email on users(email);
create index if not exists idx_sessions_token on sessions(token);
create index if not exists idx_ev_token on email_verifications(token);
create index if not exists idx_pr_token on password_resets(token);

-- Super admin seed (password: super123 — bcrypt hash)
-- If you change the password, regenerate the hash and update here.
insert into users (email, password_hash, full_name, role, provider, email_verified, city, country, pincode)
values (
  'esraigroup@gmail.com',
  'applianzo_superadmin_salt_fixed:b67d17e692d349dad746543644af0294ab021cad47d882be11b57935d8dbf225',
  'ESRAI Group',
  'superadmin',
  'email',
  true,
  'Mumbai',
  'India',
  '400001'
)
on conflict (email) do update set
  role = 'superadmin',
  email_verified = true,
  updated_at = now();

-- ── Add country_code column (2-letter Amazon marketplace code) ──────────────
-- Run this if you already ran auth-schema.sql previously.
alter table users add column if not exists country_code text;

-- Update existing super admin row with country_code
update users set country_code = 'in' where email = 'esraigroup@gmail.com' and country_code is null;
