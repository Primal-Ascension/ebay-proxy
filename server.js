const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const APP_ID = process.env.EBAY_APP_ID;
const CERT_ID = process.env.EBAY_CERT_ID;

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const credentials = Buffer.from(`${APP_ID}:${CERT_ID}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token error ${res.status}: ${err}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

app.get("/sold", async (req, res) => {
  const { q, grade } = req.query;
  if (!q) return res.status(400).json({ error: "Missing query param q" });

  try {
    const token = await getToken();
    const searchQuery = grade ? `${q} ${grade}` : q;

    // Browse API - search for recently sold/ended fixed price items
    const params = new URLSearchParams({
      q: searchQuery,
      limit: "5",
      sort: "endingSoonest",
      filter: "buyingOptions:{FIXED_PRICE},conditions:{USED|LIKE_NEW|VERY_GOOD|GOOD|ACCEPTABLE|FOR_PARTS_OR_NOT_WORKING}",
    });

    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`;
    console.log("Calling Browse API:", url);

    const browseRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Content-Type": "application/json",
      },
    });

    const raw = await browseRes.text();
    console.log("Browse response:", raw.slice(0, 500));

    if (!browseRes.ok) {
      return res.status(500).json({ error: `Browse API error ${browseRes.status}`, raw: raw.slice(0, 500) });
    }

    const data = JSON.parse(raw);
    const items = data.itemSummaries || [];

    const results = items.map(item => ({
      title: item.title,
      price: item.price?.value,
      currency: item.price?.currency || "USD",
      date: item.itemEndDate || item.itemCreationDate || null,
      url: item.itemWebUrl,
      condition: item.condition,
      image: item.image?.imageUrl,
    }));

    res.json({ results, query: searchQuery, count: results.length, total: data.total || 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => res.json({ 
  status: "ok", 
  service: "ebay-proxy", 
  api: "Browse API v1",
  appId: APP_ID ? APP_ID.slice(0, 20) + "..." : "NOT SET",
  certSet: !!CERT_ID,
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`eBay proxy running on port ${PORT}`));
