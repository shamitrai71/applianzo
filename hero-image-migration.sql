-- Applianzo — site_settings table migration
-- Run this ONCE in your Neon SQL Editor after the initial seed.
-- Safe to re-run: uses IF NOT EXISTS and ON CONFLICT DO NOTHING.

create table if not exists site_settings (
  key         text primary key,
  value       text,
  description text,
  updated_at  timestamptz default now()
);

-- Seed the hero_image key with empty value (no image = use SVG default)
insert into site_settings (key, value, description)
values (
  'hero_image_url',
  '',
  'URL of the hero background image. Leave empty to use the default SVG illustration. Recommended size: 1400 × 520 px, JPEG or WebP, max 500 KB.'
)
on conflict (key) do nothing;
