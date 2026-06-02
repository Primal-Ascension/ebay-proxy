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
    const searchQuery = grade ? `${q} ${grade}` : q;

    // Finding API - findCompletedItems (true sold listings)
    const params = new URLSearchParams({
      "OPERATION-NAME": "findCompletedItems",
      "SERVICE-VERSION": "1.0.0",
      "SECURITY-APPNAME": APP_ID,
      "RESPONSE-DATA-FORMAT": "JSON",
      "keywords": searchQuery,
      "itemFilter(0).name": "SoldItemsOnly",
      "itemFilter(0).value": "true",
      "itemFilter(1).name": "ListingType",
      "itemFilter(1).value": "AuctionWithBIN",
      "itemFilter(2).name": "ListingType",
      "itemFilter(2).value(0)": "FixedPrice",
      "itemFilter(2).value(1)": "Auction",
      "sortOrder": "EndTimeSoonest",
      "paginationInput.entriesPerPage": "5",
    });

    const findingUrl = `https://svcs.ebay.com/services/search/FindingService/v1?${params}`;
    console.log("Calling:", findingUrl);

    const findRes = await fetch(findingUrl);
    const raw = await findRes.text();
    console.log("Raw response:", raw.slice(0, 500));

    let findData;
    try {
      findData = JSON.parse(raw);
    } catch (e) {
      return res.status(500).json({ error: "Failed to parse eBay response", raw: raw.slice(0, 300) });
    }

    const ack = findData?.findCompletedItemsResponse?.[0]?.ack?.[0];
    const errorMsg = findData?.findCompletedItemsResponse?.[0]?.errorMessage;

    if (ack !== "Success" && ack !== "Warning") {
      return res.status(500).json({ error: "eBay API error", ack, errorMsg, raw: raw.slice(0, 500) });
    }

    const items = findData?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];

    const results = items.map(item => ({
      title: item.title?.[0],
      price: item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__,
      currency: item.sellingStatus?.[0]?.currentPrice?.[0]?.["@currencyId"],
      date: item.listingInfo?.[0]?.endTime?.[0],
      url: item.viewItemURL?.[0],
      condition: item.condition?.[0]?.conditionDisplayName?.[0],
    }));

    res.json({ results, query: searchQuery, count: results.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => res.json({ status: "ok", service: "ebay-proxy", appId: APP_ID?.slice(0, 15) + "..." }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`eBay proxy running on port ${PORT}`));
