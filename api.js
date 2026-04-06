'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// APPLIANZO — Single merged Netlify Function
//
// Public routes (GET):
//   /.netlify/functions/api/categories?country=in
//   /.netlify/functions/api/search?country=in&q=air+fryer
//   /.netlify/functions/api/product?country=in&asin=B0XXXXXXXXX
//   /.netlify/functions/api/settings           (returns hero_image_url etc.)
//
// Admin routes (require X-Admin-Token header = ADMIN_TOKEN env var):
//   GET    /api/admin/stats
//   GET    /api/admin/editorial?country=in&asin=B0XXX
//   POST   /api/admin/editorial          body: { asin, country_code, summary, pros, cons, best_for }
//   DELETE /api/admin/editorial?country=in&asin=B0XXX
//   GET    /api/admin/categories?country=in
//   POST   /api/admin/categories          body: { country_code, name, slug, search_keyword }
//   PUT    /api/admin/categories?id=5     body: { name, slug, search_keyword }
//   DELETE /api/admin/categories?id=5
//   GET    /api/admin/countries
//   POST   /api/admin/countries           body: { code, name, amazon_domain, marketplace, ... }
//   PUT    /api/admin/countries?code=in   body: { name, associate_tag, ... }
//   DELETE /api/admin/countries?code=in
//   GET    /api/admin/settings
//   POST   /api/admin/settings  body: { key, value }
//   DELETE /api/admin/settings?key=hero_image_url
// ─────────────────────────────────────────────────────────────────────────────

const { neon }    = require('@neondatabase/serverless');
const amazonPaapi = require('amazon-paapi');

// ── Config ─────────────────────────────────────────────────────────────────────
// All Amazon-present country codes.  Each maps to one of 3 PA-API marketplaces.
const COUNTRY_PAAPI = {
  in:'in', us:'us', ca:'us', mx:'us', br:'us', jp:'us', au:'us', sg:'us',
  uk:'uk', de:'uk', fr:'uk', it:'uk', es:'uk', nl:'uk', pl:'uk', se:'uk',
  be:'uk', tr:'uk', ae:'uk', sa:'uk', eg:'uk', za:'uk',
};
const ALLOWED_COUNTRIES = Object.keys(COUNTRY_PAAPI);

const MARKETPLACES = {
  in: { host: 'webservices.amazon.in',    region: 'eu-west-1', marketplace: 'www.amazon.in',    envTag: 'AMAZON_TAG_IN' },
  us: { host: 'webservices.amazon.com',   region: 'us-east-1', marketplace: 'www.amazon.com',   envTag: 'AMAZON_TAG_US' },
  uk: { host: 'webservices.amazon.co.uk', region: 'eu-west-1', marketplace: 'www.amazon.co.uk', envTag: 'AMAZON_TAG_UK' },
};
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function jsonRes(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
    },
    body: JSON.stringify(body),
  };
}

function validateCountry(raw) {
  const code = (raw || '').toLowerCase().trim();
  if (!ALLOWED_COUNTRIES.includes(code)) return { valid: false, code: null, paapi: null };
  const paapi = COUNTRY_PAAPI[code] || code;
  return { valid: true, code, paapi };
}

function buildCommonParams(countryCode, countryConfig) {
  const cfg = MARKETPLACES[countryCode];
  return {
    AccessKey:   process.env.AMAZON_ACCESS_KEY,
    SecretKey:   process.env.AMAZON_SECRET_KEY,
    PartnerTag:  countryConfig?.associate_tag || process.env[cfg.envTag],
    PartnerType: 'Associates',
    Marketplace: countryConfig?.marketplace || cfg.marketplace,
    Host:        cfg.host,
    Region:      cfg.region,
  };
}

// ── Auth ───────────────────────────────────────────────────────────────────────
function isAdminAuthorised(event) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  return ((event.headers || {})['x-admin-token'] || '') === token;
}

// ── DB helpers ─────────────────────────────────────────────────────────────────
function getDb() {
  if (!process.env.NEON_DATABASE_URL) throw new Error('Missing NEON_DATABASE_URL');
  return neon(process.env.NEON_DATABASE_URL);
}
async function getCountryConfig(code) {
  const sql = getDb();
  const r = await sql`select * from countries where code=${code} limit 1`;
  return r[0] || null;
}
async function getEditorialByAsin(countryCode, asin) {
  const sql = getDb();
  const r = await sql`select * from editorial_content where country_code=${countryCode} and asin=${asin} limit 1`;
  return r[0] || null;
}
async function getCategoriesByCountry(countryCode) {
  const sql = getDb();
  return sql`select id,name,slug,search_keyword,group_name,search_index from categories where country_code=${countryCode} order by group_name asc, name asc`;
}

// ── Cache ──────────────────────────────────────────────────────────────────────
const caches = {
  categories: { store: new Map(), ttl: 30 * 60 * 1000 },
  search:     { store: new Map(), ttl:  5 * 60 * 1000 },
  product:    { store: new Map(), ttl: 10 * 60 * 1000 },
};
const searchLog = [];
const SEARCH_LOG_MAX = 200;

function cacheGet(name, key) {
  const e = caches[name].store.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { caches[name].store.delete(key); return null; }
  return e.data;
}
function cacheSet(name, key, data) {
  caches[name].store.set(key, { data, expiresAt: Date.now() + caches[name].ttl });
}
function cacheInvalidate(name, prefix) {
  for (const k of caches[name].store.keys()) if (k.startsWith(prefix)) caches[name].store.delete(k);
}
function cacheStats() {
  const now = Date.now(); const out = {};
  for (const [n, { store, ttl }] of Object.entries(caches)) {
    let live = 0;
    for (const e of store.values()) if (now <= e.expiresAt) live++;
    out[n] = { total: store.size, live, ttlSeconds: ttl / 1000 };
  }
  return out;
}

// ── Public handlers ────────────────────────────────────────────────────────────
async function handleCategories(params) {
  const { valid, code: country, paapi } = validateCountry(params.country);
  if (!valid) return jsonRes(400, { message: 'Invalid country code' });
  if (!process.env.NEON_DATABASE_URL) return jsonRes(500, { message: 'Missing NEON_DATABASE_URL' });
  // Categories are stored under the paapi marketplace code (in/us/uk)
  const cacheKey = `categories:${paapi}`;
  const cached = cacheGet('categories', cacheKey);
  if (cached) return jsonRes(200, { country, paapi, categories: cached, cached: true });
  try {
    const categories = await getCategoriesByCountry(paapi);
    cacheSet('categories', cacheKey, categories);
    return jsonRes(200, { country, paapi, categories });
  } catch (err) {
    return jsonRes(500, { message: 'Categories lookup failed', error: err.message });
  }
}

async function handleSearch(params) {
  const { valid, code: country, paapi } = validateCountry(params.country);
  if (!valid) return jsonRes(400, { message: 'Invalid country code' });
  const q = (params.q || '').trim();
  if (!q) return jsonRes(400, { message: 'Missing parameter: q' });
  if (q.length > 200) return jsonRes(400, { message: 'Query too long' });
  if (!process.env.AMAZON_ACCESS_KEY || !process.env.AMAZON_SECRET_KEY)
    return jsonRes(500, { message: 'Missing Amazon PA-API credentials' });

  searchLog.push({ country, q, ts: Date.now() });
  if (searchLog.length > SEARCH_LOG_MAX) searchLog.shift();

  const cacheKey = `search:${country}:${q}`;
  const cached = cacheGet('search', cacheKey);
  if (cached) return jsonRes(200, { ...cached, cached: true });

  try {
    const cfg = await getCountryConfig(paapi).catch(() => null);
    // Resolve SearchIndex from category slug, default HomeAndKitchen
    const INDEX_MAP = {
      Kitchen:'HomeAndKitchen', HomeAndKitchen:'HomeAndKitchen',
      Appliances:'Appliances', Tools:'Tools',
      Lighting:'Lighting', HomeImprovement:'HomeImprovement', Electronics:'Electronics',
    };
    let paApiIndex = 'HomeAndKitchen';
    const slugParam = (params && params.slug) ? params.slug : '';
    if (slugParam) {
      try {
        const sqlDb = getDb();
        const cr = await sqlDb`select search_index from categories where country_code=${country} and slug=${slugParam} limit 1`;
        if (cr[0]?.search_index) paApiIndex = INDEX_MAP[cr[0].search_index] || 'HomeAndKitchen';
      } catch {}
    }

    const data = await amazonPaapi.SearchItems(buildCommonParams(paapi, cfg), {
      Keywords: q, SearchIndex: paApiIndex, ItemCount: 12,
      Resources: ['Images.Primary.Medium','ItemInfo.Title','ItemInfo.Features',
        'Offers.Listings.Price','Offers.Listings.Availability.Message'],
    });
    const items = (data?.SearchResult?.Items || []).map(i => ({
      asin: i.ASIN,
      title: i?.ItemInfo?.Title?.DisplayValue || '',
      image: i?.Images?.Primary?.Medium?.URL || '',
      features: i?.ItemInfo?.Features?.DisplayValues || [],
      price: i?.Offers?.Listings?.[0]?.Price?.DisplayAmount || null,
      availability: i?.Offers?.Listings?.[0]?.Availability?.Message || null,
      url: i?.DetailPageURL || '',
    }));
    const result = { country, query: q, slug: slugParam, items, errors: data?.Errors || [] };
    cacheSet('search', cacheKey, result);
    return jsonRes(200, result);
  } catch (err) {
    return jsonRes(500, { message: 'Search failed', error: err.message });
  }
}

async function handleProduct(params) {
  const { valid, code: country, paapi } = validateCountry(params.country);
  if (!valid) return jsonRes(400, { message: 'Invalid country code' });
  const asin = (params.asin || '').trim().toUpperCase();
  if (!asin) return jsonRes(400, { message: 'Missing parameter: asin' });
  if (!/^[A-Z0-9]{10}$/.test(asin)) return jsonRes(400, { message: 'Invalid ASIN format' });
  if (!process.env.AMAZON_ACCESS_KEY || !process.env.AMAZON_SECRET_KEY)
    return jsonRes(500, { message: 'Missing Amazon PA-API credentials' });

  const cacheKey = `product:${country}:${asin}`;
  const cached = cacheGet('product', cacheKey);
  if (cached) return jsonRes(200, { ...cached, cached: true });

  try {
    const cfg  = await getCountryConfig(paapi).catch(() => null);
    const data = await amazonPaapi.GetItems(buildCommonParams(paapi, cfg), {
      ItemIds: [asin], ItemIdType: 'ASIN',
      Resources: ['Images.Primary.Large','Images.Variants.Large','ItemInfo.Title',
        'ItemInfo.Features','ItemInfo.ByLineInfo','ItemInfo.ProductInfo',
        'Offers.Listings.Price','Offers.Listings.Availability.Message',
        'Offers.Listings.DeliveryInfo.IsPrimeEligible','Offers.Summaries.LowestPrice',
        'BrowseNodeInfo.BrowseNodes','ParentASIN'],
    });
    const item = data?.ItemsResult?.Items?.[0];
    if (!item) return jsonRes(404, { message: 'Product not found', errors: data?.Errors || [] });
    const editorial = await getEditorialByAsin(paapi, asin).catch(() => null);
    const result = {
      asin: item.ASIN, parentAsin: item?.ParentASIN || null, paapi,
      title: item?.ItemInfo?.Title?.DisplayValue || '',
      brand: item?.ItemInfo?.ByLineInfo?.Brand?.DisplayValue || '',
      image: item?.Images?.Primary?.Large?.URL || '',
      gallery: (item?.Images?.Variants||[]).map(i=>i?.Large?.URL).filter(Boolean),
      features: item?.ItemInfo?.Features?.DisplayValues || [],
      price: item?.Offers?.Listings?.[0]?.Price?.DisplayAmount || null,
      availability: item?.Offers?.Listings?.[0]?.Availability?.Message || null,
      primeEligible: item?.Offers?.Listings?.[0]?.DeliveryInfo?.IsPrimeEligible || false,
      url: item?.DetailPageURL || '',
      browseNodes: item?.BrowseNodeInfo?.BrowseNodes || [],
      editorial: editorial || null,
      errors: data?.Errors || [],
    };
    cacheSet('product', cacheKey, result);
    return jsonRes(200, result);
  } catch (err) {
    return jsonRes(500, { message: 'Product lookup failed', error: err.message });
  }
}

// ── Admin handlers ─────────────────────────────────────────────────────────────
async function adminStats() {
  const now = Date.now(), window = 60*60*1000;
  const recent = searchLog.filter(e => now - e.ts < window);
  const freq = {};
  for (const { q, country } of recent) { const k=`${country}:${q}`; freq[k]=(freq[k]||0)+1; }
  const topQueries = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,10)
    .map(([k,count])=>{ const [c,...r]=k.split(':'); return { country:c, query:r.join(':'), count }; });
  return jsonRes(200, {
    cache: cacheStats(),
    searches: { lastHour: recent.length, total: searchLog.length, topQueries },
    serverTime: new Date().toISOString(),
  });
}

async function adminGetEditorial(params) {
  const sql = getDb();
  if (params.asin && params.country) {
    const r = await sql`select * from editorial_content where asin=${params.asin.toUpperCase()} and country_code=${params.country}`;
    return jsonRes(200, { editorial: r[0]||null });
  }
  const r = await sql`select * from editorial_content order by updated_at desc limit 200`;
  return jsonRes(200, { editorial: r });
}

async function adminUpsertEditorial(body) {
  const { asin, country_code, summary, pros, cons, best_for } = body||{};
  if (!asin||!country_code) return jsonRes(400, { message: 'asin and country_code required' });
  const sql = getDb();
  await sql`
    insert into editorial_content (asin,country_code,summary,pros,cons,best_for)
    values (${asin.toUpperCase()},${country_code},${summary||null},${pros||null},${cons||null},${best_for||null})
    on conflict (asin,country_code) do update set
      summary=excluded.summary, pros=excluded.pros, cons=excluded.cons,
      best_for=excluded.best_for, updated_at=now()`;
  cacheInvalidate('product', `product:${country_code}:`);
  return jsonRes(200, { message: 'Editorial saved' });
}

async function adminDeleteEditorial(params) {
  if (!params.asin||!params.country) return jsonRes(400, { message: 'asin and country required' });
  const sql = getDb();
  await sql`delete from editorial_content where asin=${params.asin.toUpperCase()} and country_code=${params.country}`;
  cacheInvalidate('product', `product:${params.country}:`);
  return jsonRes(200, { message: 'Editorial deleted' });
}

async function adminGetCategories(params) {
  const sql = getDb();
  const r = params.country
    ? await sql`select * from categories where country_code=${params.country} order by group_name asc, name asc`
    : await sql`select * from categories order by country_code, group_name asc, name asc`;
  return jsonRes(200, { categories: r });
}

async function adminCreateCategory(body) {
  const { country_code, name, slug, search_keyword, group_name, search_index } = body||{};
  if (!country_code||!name||!slug) return jsonRes(400, { message: 'country_code, name, slug required' });
  const sql = getDb();
  const r = await sql`
    insert into categories (country_code,name,slug,search_keyword,group_name,search_index)
    values (${country_code},${name},${slug},${search_keyword||null},
            ${group_name||'Kitchen Appliances'},${search_index||'HomeAndKitchen'})
    on conflict (country_code,slug) do update set
      name=excluded.name, search_keyword=excluded.search_keyword,
      group_name=excluded.group_name, search_index=excluded.search_index,
      updated_at=now()
    returning *`;
  cacheInvalidate('categories', `categories:${country_code}`);
  return jsonRes(200, { message: 'Category saved', category: r[0] });
}

async function adminUpdateCategory(params, body) {
  const id = parseInt(params.id, 10);
  if (!id) return jsonRes(400, { message: 'id required' });
  const { name, slug, search_keyword, group_name, search_index } = body||{};
  const sql = getDb();
  const r = await sql`
    update categories set
      name=coalesce(${name||null},name),
      slug=coalesce(${slug||null},slug),
      search_keyword=coalesce(${search_keyword||null},search_keyword),
      group_name=coalesce(${group_name||null},group_name),
      search_index=coalesce(${search_index||null},search_index),
      updated_at=now()
    where id=${id} returning *`;
  if (r[0]) cacheInvalidate('categories', `categories:${r[0].country_code}`);
  return jsonRes(200, { message: 'Category updated', category: r[0]||null });
}

async function adminDeleteCategory(params) {
  const id = parseInt(params.id, 10);
  if (!id) return jsonRes(400, { message: 'id required' });
  const sql = getDb();
  const r = await sql`delete from categories where id=${id} returning country_code`;
  if (r[0]) cacheInvalidate('categories', `categories:${r[0].country_code}`);
  return jsonRes(200, { message: 'Category deleted' });
}

async function adminGetCountries() {
  const sql = getDb();
  const r = await sql`select * from countries order by name asc`;
  return jsonRes(200, { countries: r });
}

async function adminUpsertCountry(body) {
  const { code, name, amazon_domain, marketplace, default_language, currency, associate_tag } = body||{};
  if (!code||!name||!marketplace) return jsonRes(400, { message: 'code, name, marketplace required' });
  const sql = getDb();
  await sql`
    insert into countries (code,name,amazon_domain,marketplace,default_language,currency,associate_tag)
    values (${code.toLowerCase()},${name},${amazon_domain||null},${marketplace},${default_language||null},${currency||null},${associate_tag||null})
    on conflict (code) do update set
      name=excluded.name, amazon_domain=excluded.amazon_domain, marketplace=excluded.marketplace,
      default_language=excluded.default_language, currency=excluded.currency,
      associate_tag=excluded.associate_tag, updated_at=now()`;
  return jsonRes(200, { message: 'Country saved' });
}

async function adminUpdateCountry(params, body) {
  const code = (params.code||'').toLowerCase();
  if (!code) return jsonRes(400, { message: 'code required' });
  const { name, amazon_domain, marketplace, default_language, currency, associate_tag } = body||{};
  const sql = getDb();
  await sql`
    update countries set
      name=coalesce(${name||null},name),
      amazon_domain=coalesce(${amazon_domain||null},amazon_domain),
      marketplace=coalesce(${marketplace||null},marketplace),
      default_language=coalesce(${default_language||null},default_language),
      currency=coalesce(${currency||null},currency),
      associate_tag=coalesce(${associate_tag||null},associate_tag),
      updated_at=now()
    where code=${code}`;
  cacheInvalidate('categories', `categories:${code}`);
  return jsonRes(200, { message: 'Country updated' });
}

async function adminDeleteCountry(params) {
  const code = (params.code||'').toLowerCase();
  if (!code) return jsonRes(400, { message: 'code required' });
  const sql = getDb();
  await sql`delete from countries where code=${code}`;
  cacheInvalidate('categories', `categories:${code}`);
  return jsonRes(200, { message: 'Country deleted' });
}

// ── Site settings DB helpers ──────────────────────────────────────────────────
async function getAllSettings() {
  const sql = getDb();
  return sql`select key, value, description, updated_at from site_settings order by key asc`;
}

async function getSetting(key) {
  const sql = getDb();
  const r = await sql`select key, value from site_settings where key=${key} limit 1`;
  return r[0] || null;
}

async function upsertSetting(key, value) {
  const sql = getDb();
  await sql`
    insert into site_settings (key, value)
    values (${key}, ${value})
    on conflict (key) do update set value=excluded.value, updated_at=now()`;
}

async function deleteSetting(key) {
  const sql = getDb();
  await sql`delete from site_settings where key=${key}`;
}

// Public: GET /api/settings — returns non-sensitive settings for the frontend
async function handleSettings() {
  if (!process.env.NEON_DATABASE_URL) {
    // Graceful fallback if DB not configured yet
    return jsonRes(200, { settings: {} });
  }
  try {
    const rows = await getAllSettings();
    // Only expose safe keys to the public (never credentials)
    const PUBLIC_KEYS = ['hero_image_url'];
    const settings = {};
    for (const row of rows) {
      if (PUBLIC_KEYS.includes(row.key)) settings[row.key] = row.value || '';
    }
    return jsonRes(200, { settings });
  } catch (err) {
    console.error('[settings]', err.message);
    return jsonRes(200, { settings: {} }); // Fail silently on frontend
  }
}

// Admin: settings CRUD
async function adminGetSettings() {
  const rows = await getAllSettings();
  return jsonRes(200, { settings: rows });
}

async function adminUpsertSetting(body) {
  const { key, value } = body || {};
  if (!key) return jsonRes(400, { message: 'key is required' });
  if (typeof value === 'undefined') return jsonRes(400, { message: 'value is required' });
  await upsertSetting(key, String(value));
  return jsonRes(200, { message: 'Setting saved' });
}

async function adminDeleteSetting(params) {
  const { key } = params;
  if (!key) return jsonRes(400, { message: 'key is required' });
  await deleteSetting(key);
  return jsonRes(200, { message: 'Setting deleted' });
}

async function handleAdmin(event, subRoute, params) {
  if (!isAdminAuthorised(event)) return jsonRes(401, { message: 'Unauthorised. Provide X-Admin-Token header.' });
  let body = {};
  try { if (event.body) body = JSON.parse(event.body); } catch {}
  const m = event.httpMethod;
  try {
    switch (subRoute) {
      case 'stats':      return adminStats();
      case 'editorial':
        if (m==='GET')    return adminGetEditorial(params);
        if (m==='POST')   return adminUpsertEditorial(body);
        if (m==='DELETE') return adminDeleteEditorial(params);
        break;
      case 'categories':
        if (m==='GET')    return adminGetCategories(params);
        if (m==='POST')   return adminCreateCategory(body);
        if (m==='PUT')    return adminUpdateCategory(params, body);
        if (m==='DELETE') return adminDeleteCategory(params);
        break;
      case 'countries':
        if (m==='GET')    return adminGetCountries();
        if (m==='POST')   return adminUpsertCountry(body);
        if (m==='PUT')    return adminUpdateCountry(params, body);
        if (m==='DELETE') return adminDeleteCountry(params);
        break;
      case 'settings':
        if (m==='GET')    return adminGetSettings();
        if (m==='POST')   return adminUpsertSetting(body);
        if (m==='DELETE') return adminDeleteSetting(params);
        break;
      default:
        return jsonRes(404, { message: `Unknown admin route: ${subRoute}` });
    }
    return jsonRes(405, { message: 'Method not allowed' });
  } catch (err) {
    console.error(`[admin/${subRoute}]`, err.message);
    return jsonRes(500, { message: 'Admin operation failed', error: err.message });
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
      },
      body: '',
    };
  }

  const pathParts = (event.path || '').split('/').filter(Boolean);
  const apiIdx    = pathParts.indexOf('api');
  const segments  = apiIdx >= 0 ? pathParts.slice(apiIdx + 1) : [];
  const route     = segments[0] || '';
  const subRoute  = segments[1] || '';
  const params    = event.queryStringParameters || {};

  if (route === 'admin') return handleAdmin(event, subRoute, params);
  if (event.httpMethod !== 'GET') return jsonRes(405, { message: 'Method not allowed' });

  switch (route) {
    case 'categories': return handleCategories(params);
    case 'search':     return handleSearch(params);
    case 'product':    return handleProduct(params);
    case 'settings':   return handleSettings();
    default:
      return jsonRes(404, { message: 'Unknown route. Available: /api/categories /api/search /api/product' });
  }
};
