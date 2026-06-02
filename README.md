# eBay Proxy — Card Data

Proxies eBay Finding API calls to avoid CORS restrictions.
Credentials live server-side only — never exposed to browser.

## Deploy to Railway

1. Push this folder to a GitHub repo (or drag-drop on Railway)
1. Set environment variables in Railway dashboard:
- EBAY_APP_ID=SamuelLa-CardData-PRD-551f17915-303d26cf
- EBAY_CERT_ID=your-rotated-cert-id
1. Deploy — Railway auto-detects Node.js

## Endpoints

GET /sold?q=Charizard Base Set&grade=PSA 9
Returns last 5 eBay sold listings for the query.

GET /
Health check.