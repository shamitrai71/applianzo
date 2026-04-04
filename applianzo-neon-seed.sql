-- Applianzo Neon seed file
-- Run this in the Neon SQL Editor to set up your database.
-- Safe to re-run: all inserts use ON CONFLICT DO UPDATE.

create table if not exists countries (
  code text primary key,
  name text not null,
  amazon_domain text,
  marketplace text not null,
  default_language text,
  currency text,
  associate_tag text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists editorial_content (
  id bigserial primary key,
  asin text not null,
  country_code text not null references countries(code) on delete cascade,
  summary text,
  pros text,
  cons text,
  best_for text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (asin, country_code)
);

create table if not exists categories (
  id bigserial primary key,
  country_code text not null references countries(code) on delete cascade,
  name text not null,
  slug text not null,
  search_keyword text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (country_code, slug)
);

-- ── Countries ─────────────────────────────────────────────────────────────────
-- Replace associate_tag values with your actual Amazon Associates tags.
insert into countries (code, name, amazon_domain, marketplace, default_language, currency, associate_tag)
values
  ('in', 'India',          'amazon.in',     'www.amazon.in',     'en_IN', 'INR', 'REPLACE_WITH_YOUR_IN_TAG'),
  ('us', 'United States',  'amazon.com',    'www.amazon.com',    'en_US', 'USD', 'REPLACE_WITH_YOUR_US_TAG'),
  ('uk', 'United Kingdom', 'amazon.co.uk',  'www.amazon.co.uk',  'en_GB', 'GBP', 'REPLACE_WITH_YOUR_UK_TAG')
on conflict (code) do update set
  name             = excluded.name,
  amazon_domain    = excluded.amazon_domain,
  marketplace      = excluded.marketplace,
  default_language = excluded.default_language,
  currency         = excluded.currency,
  associate_tag    = excluded.associate_tag,
  updated_at       = now();

-- ── Categories ────────────────────────────────────────────────────────────────
insert into categories (country_code, name, slug, search_keyword)
values
  ('in', 'Air Fryers',     'air-fryers',     'air fryer'),
  ('in', 'Knife Sets',     'knife-sets',      'knife set'),
  ('in', 'Cookware',       'cookware',        'cookware set'),
  ('in', 'Mixer Grinders', 'mixer-grinders',  'mixer grinder'),
  ('us', 'Air Fryers',     'air-fryers',      'air fryer'),
  ('us', 'Coffee Makers',  'coffee-makers',   'coffee maker'),
  ('us', 'Cookware',       'cookware',        'cookware set'),
  ('us', 'Instant Pots',   'instant-pots',    'instant pot'),
  ('uk', 'Air Fryers',     'air-fryers',      'air fryer'),
  ('uk', 'Mixer Grinders', 'mixer-grinders',  'mixer grinder'),
  ('uk', 'Cookware',       'cookware',        'cookware set'),
  ('uk', 'Kettles',        'kettles',         'electric kettle')
on conflict (country_code, slug) do update set
  name           = excluded.name,
  search_keyword = excluded.search_keyword,
  updated_at     = now();

-- ── Editorial content (example — replace ASIN with a real product ASIN) ───────
-- To add more: copy this block, change the asin and country_code, update the content.
insert into editorial_content (asin, country_code, summary, pros, cons, best_for)
values (
  'B0EXAMPLE123',
  'in',
  'A compact digital air fryer suited to everyday home cooking, with a simple control layout and enough capacity for small families.',
  'Easy controls; compact footprint; useful for quick snacks and weeknight meals.',
  'May be too small for large families; feature set depends on seller listing consistency.',
  'Small kitchens, first-time air fryer buyers, and users who want fast everyday cooking.'
)
on conflict (asin, country_code) do update set
  summary    = excluded.summary,
  pros       = excluded.pros,
  cons       = excluded.cons,
  best_for   = excluded.best_for,
  updated_at = now();
