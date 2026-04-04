'use strict';

const { neon } = require('@neondatabase/serverless');

const connectionString = process.env.NEON_DATABASE_URL;

function getDb() {
  if (!connectionString) {
    throw new Error('Missing NEON_DATABASE_URL environment variable');
  }
  return neon(connectionString);
}

async function getCountryConfig(countryCode) {
  const sql = getDb();
  const rows = await sql`
    select code, name, amazon_domain, marketplace, default_language, currency, associate_tag
    from countries
    where code = ${countryCode}
    limit 1
  `;
  return rows[0] || null;
}

async function getEditorialByAsin(countryCode, asin) {
  const sql = getDb();
  const rows = await sql`
    select asin, country_code, summary, pros, cons, best_for
    from editorial_content
    where country_code = ${countryCode} and asin = ${asin}
    limit 1
  `;
  return rows[0] || null;
}

async function getCategoriesByCountry(countryCode) {
  const sql = getDb();
  const rows = await sql`
    select id, name, slug, search_keyword
    from categories
    where country_code = ${countryCode}
    order by name asc
  `;
  return rows;
}

module.exports = { getDb, getCountryConfig, getEditorialByAsin, getCategoriesByCountry };
