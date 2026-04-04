# Applianzo

Applianzo is a country-aware Amazon kitchen discovery site built for a GitHub → Netlify → Neon workflow.

## Project structure

```
applianzo/
├── index.html                    # Static frontend
├── netlify.toml                  # Netlify build & redirect config
├── package.json                  # Dependencies
├── .env.example                  # Environment variable template
├── .gitignore                    # Keeps .env and node_modules out of git
├── applianzo-neon-seed.sql       # Database schema + seed data
├── README.md
└── netlify/
    └── functions/
        ├── config.js             # Shared: MARKETPLACES, validation, CORS, helpers
        ├── db.js                 # Neon database queries
        ├── search.js             # GET /.netlify/functions/search
        ├── product.js            # GET /.netlify/functions/product
        └── categories.js         # GET /.netlify/functions/categories
```

## Deployment checklist

1. Push this folder to a GitHub repository.
2. Import the repository into Netlify.
3. Add the environment variables (see below).
4. Create a Neon project, open the SQL Editor, and run `applianzo-neon-seed.sql`.
5. **Replace the placeholder associate tags** in the seed SQL with your actual Amazon Associates tags before running it.
6. Deploy.
7. Set `ALLOWED_ORIGIN` in Netlify to your actual deployed URL.
8. Test:
   - `/.netlify/functions/categories?country=in`
   - `/.netlify/functions/search?country=in&q=air+fryer`
   - `/.netlify/functions/product?country=in&asin=REAL_ASIN`

## Netlify environment variables

Add all of these in Netlify → Site settings → Environment variables:

| Variable           | Description                                              |
| ------------------ | -------------------------------------------------------- |
| AMAZON_ACCESS_KEY  | Your Amazon PA-API access key                            |
| AMAZON_SECRET_KEY  | Your Amazon PA-API secret key                            |
| AMAZON_TAG_IN      | Your Amazon India Associates tag (e.g. yourtag-21)       |
| AMAZON_TAG_US      | Your Amazon US Associates tag (e.g. yourtag-20)          |
| AMAZON_TAG_UK      | Your Amazon UK Associates tag (e.g. yourtag-21)          |
| NEON_DATABASE_URL  | Your Neon PostgreSQL connection string                   |
| ALLOWED_ORIGIN     | Your deployed site URL (e.g. https://applianzo.netlify.app) |

## Local development

```bash
cp .env.example .env
# Fill in your real values in .env
npm install
npm run dev
```

## Before launch — mandatory

- [ ] Replace all `REPLACE_WITH_YOUR_*_TAG` placeholders in the SQL seed with real Associate tags
- [ ] Set `ALLOWED_ORIGIN` to your actual Netlify URL (not `*`)
- [ ] Add real product ASINs to the `editorial_content` table
- [ ] Create `/privacy` and `/terms` pages (linked in the footer)
- [ ] Verify the affiliate disclosure bar is visible on all pages

## API endpoints

### `GET /.netlify/functions/categories?country=in`
Returns the list of categories for a given country from Neon.

### `GET /.netlify/functions/search?country=in&q=air+fryer`
Searches Amazon PA-API for matching products. Results are cached in memory for 5 minutes.

### `GET /.netlify/functions/product?country=in&asin=B0XXXXXXXXX`
Fetches full product detail from Amazon PA-API and merges any editorial content from Neon. Results are cached for 10 minutes.
