'use strict';

const { getCategoriesByCountry } = require('./db');
const { json, validateCountry } = require('./config');

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes — categories change rarely

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
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return json(405, { message: 'Method not allowed' });
  }

  const params = event.queryStringParameters || {};

  const { valid, code: country } = validateCountry(params.country);
  if (!valid) {
    return json(400, { message: 'Invalid country. Allowed values: in, us, uk' });
  }

  if (!process.env.NEON_DATABASE_URL) {
    return json(500, { message: 'Missing NEON_DATABASE_URL environment variable' });
  }

  const cacheKey = `categories:${country}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return json(200, { country, categories: cached, cached: true });
  }

  try {
    const categories = await getCategoriesByCountry(country);
    cacheSet(cacheKey, categories);
    return json(200, { country, categories });
  } catch (error) {
    console.error('[categories] DB error:', error.message);
    return json(500, {
      message: 'Categories function failed',
      error: error.message || 'Unknown error'
    });
  }
};
