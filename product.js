'use strict';

const amazonPaapi = require('amazon-paapi');
const { getCountryConfig, getEditorialByAsin } = require('./db');
const { json, validateCountry, buildCommonParams } = require('./config');

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes for product details

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Basic ASIN format check (10 alphanumeric characters)
function isValidAsin(asin) {
  return /^[A-Z0-9]{10}$/.test(asin);
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return json(405, { message: 'Method not allowed' });
  }

  const params = event.queryStringParameters || {};

  // Validate country
  const { valid, code: country } = validateCountry(params.country);
  if (!valid) {
    return json(400, { message: 'Invalid country. Allowed values: in, us, uk' });
  }

  // Validate ASIN
  const asin = (params.asin || '').trim().toUpperCase();
  if (!asin) {
    return json(400, { message: 'Missing required parameter: asin' });
  }
  if (!isValidAsin(asin)) {
    return json(400, { message: 'Invalid ASIN format. Must be 10 alphanumeric characters.' });
  }

  if (!process.env.AMAZON_ACCESS_KEY || !process.env.AMAZON_SECRET_KEY) {
    return json(500, { message: 'Missing Amazon PA-API environment variables' });
  }

  const cacheKey = `product:${country}:${asin}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return json(200, { ...cached, cached: true });
  }

  try {
    const countryConfig = await getCountryConfig(country).catch(() => null);
    const commonParameters = buildCommonParams(country, countryConfig);

    const requestParameters = {
      ItemIds: [asin],
      ItemIdType: 'ASIN',
      Resources: [
        'Images.Primary.Large',
        'Images.Variants.Large',
        'ItemInfo.Title',
        'ItemInfo.Features',
        'ItemInfo.ByLineInfo',
        'ItemInfo.ProductInfo',
        'Offers.Listings.Price',
        'Offers.Listings.Availability.Message',
        'Offers.Listings.DeliveryInfo.IsPrimeEligible',
        'Offers.Summaries.LowestPrice',
        'BrowseNodeInfo.BrowseNodes',
        'ParentASIN'
      ]
    };

    const data = await amazonPaapi.GetItems(commonParameters, requestParameters);
    const item = data?.ItemsResult?.Items?.[0];

    if (!item) {
      return json(404, { message: 'Product not found', errors: data?.Errors || [] });
    }

    const editorial = await getEditorialByAsin(country, asin).catch(() => null);

    const result = {
      asin: item.ASIN,
      parentAsin: item?.ParentASIN || null,
      title: item?.ItemInfo?.Title?.DisplayValue || '',
      brand: item?.ItemInfo?.ByLineInfo?.Brand?.DisplayValue || '',
      image: item?.Images?.Primary?.Large?.URL || '',
      gallery: (item?.Images?.Variants || []).map((img) => img?.Large?.URL).filter(Boolean),
      features: item?.ItemInfo?.Features?.DisplayValues || [],
      price: item?.Offers?.Listings?.[0]?.Price?.DisplayAmount || null,
      availability: item?.Offers?.Listings?.[0]?.Availability?.Message || null,
      primeEligible: item?.Offers?.Listings?.[0]?.DeliveryInfo?.IsPrimeEligible || false,
      url: item?.DetailPageURL || '',
      browseNodes: item?.BrowseNodeInfo?.BrowseNodes || [],
      editorial: editorial || null,
      errors: data?.Errors || []
    };

    cacheSet(cacheKey, result);
    return json(200, result);

  } catch (error) {
    console.error('[product] PA-API error:', error.message);
    return json(500, {
      message: 'Product function failed',
      error: error.message || 'Unknown error'
    });
  }
};
