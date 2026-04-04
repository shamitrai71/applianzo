'use strict';

const ALLOWED_COUNTRIES = ['in', 'us', 'uk'];

const MARKETPLACES = {
  in: {
    host: 'webservices.amazon.in',
    region: 'eu-west-1',
    marketplace: 'www.amazon.in',
    fallbackTag: process.env.AMAZON_TAG_IN
  },
  us: {
    host: 'webservices.amazon.com',
    region: 'us-east-1',
    marketplace: 'www.amazon.com',
    fallbackTag: process.env.AMAZON_TAG_US
  },
  uk: {
    host: 'webservices.amazon.co.uk',
    region: 'eu-west-1',
    marketplace: 'www.amazon.co.uk',
    fallbackTag: process.env.AMAZON_TAG_UK
  }
};

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN
    },
    body: JSON.stringify(body)
  };
}

function validateCountry(countryCode) {
  const code = (countryCode || '').toLowerCase().trim();
  if (!ALLOWED_COUNTRIES.includes(code)) {
    return { valid: false, code: null };
  }
  return { valid: true, code };
}

function buildCommonParams(countryCode, countryConfig) {
  const config = MARKETPLACES[countryCode];
  return {
    AccessKey: process.env.AMAZON_ACCESS_KEY,
    SecretKey: process.env.AMAZON_SECRET_KEY,
    PartnerTag: countryConfig?.associate_tag || config.fallbackTag,
    PartnerType: 'Associates',
    Marketplace: countryConfig?.marketplace || config.marketplace,
    Host: config.host,
    Region: config.region
  };
}

module.exports = { ALLOWED_COUNTRIES, MARKETPLACES, json, validateCountry, buildCommonParams };
