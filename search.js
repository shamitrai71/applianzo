'use strict';

const amazonPaapi = require('amazon-paapi');
const { getCountryConfig } = require('./db');
const { json, validateCountry, buildCommonParams } = require('./config');

// Simple in-memory cache: key -> { data, expiresAt }
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

exports.handler = async (event) => {
  // Only allow GET
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return json(405, { message: 'Method not allowed' });
  }

  const params = event.queryStringParameters || {};

  // Validate country
  const { valid, code: country } = validateCountry(params.country);
  if (!valid) {
    return json(400, { message: 'Invalid country. Allowed values: in, us, uk' });
  }

  // Validate query
  const q = (params.q || '').trim();
  if (!q) {
    return json(400, { message: 'Missing required parameter: q (search query)' });
  }
  if (q.length > 200) {
    return json(400, { message: 'Search query too long (max 200 characters)' });
  }

  // Check credentials
  if (!process.env.AMAZON_ACCESS_KEY || !process.env.AMAZON_SECRET_KEY) {
    return json(500, { message: 'Missing Amazon PA-API environment variables' });
  }

  // Cache check
  const cacheKey = `search:${country}:${q}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return json(200, { ...cached, cached: true });
  }

  try {
    const countryConfig = await getCountryConfig(country).catch(() => null);
    const commonParameters = buildCommonParams(country, countryConfig);

    const requestParameters = {
      Keywords: q,
      SearchIndex: 'Kitchen',
      ItemCount: 12,
      Resources: [
        'Images.Primary.Medium',
        'ItemInfo.Title',
        'ItemInfo.Features',
        'Offers.Listings.Price',
        'Offers.Listings.Availability.Message'
      ]
    };

    const data = await amazonPaapi.SearchItems(commonParameters, requestParameters);
    const items = (data?.SearchResult?.Items || []).map((item) => ({
      asin: item.ASIN,
      title: item?.ItemInfo?.Title?.DisplayValue || '',
      image: item?.Images?.Primary?.Medium?.URL || '',
      features: item?.ItemInfo?.Features?.DisplayValues || [],
      price: item?.Offers?.Listings?.[0]?.Price?.DisplayAmount || null,
      availability: item?.Offers?.Listings?.[0]?.Availability?.Message || null,
      url: item?.DetailPageURL || ''
    }));

    const result = { country, query: q, items, errors: data?.Errors || [] };
    cacheSet(cacheKey, result);
    return json(200, result);

  } catch (error) {
    console.error('[search] PA-API error:', error.message);
    return json(500, {
      message: 'Search function failed',
      error: error.message || 'Unknown error'
    });
  }
};
