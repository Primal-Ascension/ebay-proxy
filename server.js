const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const APP_ID = process.env.EBAY_APP_ID;
const CERT_ID = process.env.EBAY_CERT_ID;
const SHEET_ID = "530728558219140";

let cachedToken = null;
let tokenExpiry = 0;

const JUNK = ["lot","bundle","bulk","collection","random","mystery","repack","mixed"];

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const credentials = Buffer.from(`${APP_ID}:${CERT_ID}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });
  if (!res.ok) throw new Error(`Token error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// Try Finding API (true sold listings) first, fall back to Browse API
app.get("/sold", async (req, res) => {
  const { q, grade } = req.query;
  if (!q) return res.status(400).json({ error: "Missing q" });

  const searchQuery = grade ? `${q} ${grade}` : q;

  // --- Attempt 1: Finding API (sold listings) ---
  try {
    const params = new URLSearchParams({
      "OPERATION-NAME": "findCompletedItems",
      "SERVICE-VERSION": "1.0.0",
      "SECURITY-APPNAME": APP_ID,
      "RESPONSE-DATA-FORMAT": "JSON",
      "keywords": searchQuery,
      "itemFilter(0).name": "SoldItemsOnly",
      "itemFilter(0).value": "true",
      "sortOrder": "EndTimeSoonest",
      "paginationInput.entriesPerPage": "10",
    });

    const findingUrl = `https://svcs.ebay.com/services/search/FindingService/v1?${params}`;
    const findRes = await fetch(findingUrl);
    const raw = await findRes.text();
    const findData = JSON.parse(raw);

    const ack = findData?.findCompletedItemsResponse?.[0]?.ack?.[0];
    const errorMsg = findData?.findCompletedItemsResponse?.[0]?.errorMessage?.[0]?.error?.[0];

    console.log(`Finding API ack: ${ack} | error: ${JSON.stringify(errorMsg)}`);

    if (ack === "Success" || ack === "Warning") {
      const items = findData?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
      const filtered = items.filter(item => !JUNK.some(k => (item.title?.[0]||"").toLowerCase().includes(k)));
      const results = filtered.slice(0, 5).map(item => ({
        title: item.title?.[0],
        price: item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__,
        currency: item.sellingStatus?.[0]?.currentPrice?.[0]?.["@currencyId"],
        date: item.listingInfo?.[0]?.endTime?.[0],
        url: item.viewItemURL?.[0],
        condition: item.condition?.[0]?.conditionDisplayName?.[0],
        source: "finding_api_sold",
      }));
      return res.json({ results, query: searchQuery, count: results.length, source: "finding_api" });
    }

    // Finding API failed — log why and fall through to Browse API
    console.log(`Finding API failed (ack=${ack}), errorId=${errorMsg?.errorId?.[0]}, msg=${errorMsg?.message?.[0]} — falling back to Browse API`);

  } catch (e) {
    console.log(`Finding API exception: ${e.message} — falling back to Browse API`);
  }

  // --- Attempt 2: Browse API (active listings, sorted by price low→high as floor) ---
  try {
    await getToken();
    const token = cachedToken;
    const params = new URLSearchParams({
      q: searchQuery,
      limit: "20",
      sort: "price",
      filter: "buyingOptions:{FIXED_PRICE}",
    });

    const browseRes = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    });

    const raw = await browseRes.text();
    if (!browseRes.ok) return res.status(500).json({ error: `Browse API ${browseRes.status}`, raw: raw.slice(0,300) });

    const data = JSON.parse(raw);
    const items = (data.itemSummaries || []).filter(item => !JUNK.some(k => (item.title||"").toLowerCase().includes(k)));
    const results = items.slice(0, 5).map(item => ({
      title: item.title,
      price: item.price?.value,
      currency: item.price?.currency || "USD",
      date: item.itemEndDate || item.itemCreationDate || null,
      url: item.itemWebUrl,
      condition: item.condition,
      source: "browse_api_active",
    }));

    return res.json({ results, query: searchQuery, count: results.length, source: "browse_api_fallback" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Diagnostic endpoint — test Finding API directly and return full response
app.get("/test-finding", async (req, res) => {
  const q = req.query.q || "Charizard Base Set Pokemon";
  const params = new URLSearchParams({
    "OPERATION-NAME": "findCompletedItems",
    "SERVICE-VERSION": "1.0.0",
    "SECURITY-APPNAME": APP_ID,
    "RESPONSE-DATA-FORMAT": "JSON",
    "keywords": q,
    "itemFilter(0).name": "SoldItemsOnly",
    "itemFilter(0).value": "true",
    "sortOrder": "EndTimeSoonest",
    "paginationInput.entriesPerPage": "3",
  });
  try {
    const findRes = await fetch(`https://svcs.ebay.com/services/search/FindingService/v1?${params}`);
    const raw = await findRes.text();
    const data = JSON.parse(raw);
    const ack = data?.findCompletedItemsResponse?.[0]?.ack?.[0];
    const errorMsg = data?.findCompletedItemsResponse?.[0]?.errorMessage;
    const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
    res.json({
      ack,
      errorMsg,
      itemCount: items.length,
      firstItem: items[0] ? { title: items[0].title?.[0], price: items[0].sellingStatus?.[0]?.currentPrice?.[0]?.__value__, date: items[0].listingInfo?.[0]?.endTime?.[0] } : null,
      rawSlice: raw.slice(0, 800),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/health", (req, res) => res.json({ status: "ok", api: "Finding+Browse hybrid", appId: APP_ID?.slice(0,20)+"...", certSet: !!CERT_ID }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`eBay proxy running on port ${PORT}`));
