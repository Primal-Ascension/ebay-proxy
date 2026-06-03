
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const APP_ID = process.env.EBAY_APP_ID;
const CERT_ID = process.env.EBAY_CERT_ID;

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

app.get("/sold", async (req, res) => {
  const { q, grade } = req.query;
  if (!q) return res.status(400).json({ error: "Missing q" });
  try {
    const token = await getToken();
    const searchQuery = grade ? `${q} ${grade}` : q;
    const params = new URLSearchParams({ q: searchQuery, limit: "20", sort: "endingSoonest", filter: "buyingOptions:{FIXED_PRICE}" });
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
    }));
    res.json({ results, query: searchQuery, count: results.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.get("/health", (req, res) => res.json({ status: "ok", api: "Browse API v1", appId: APP_ID?.slice(0,20)+"...", certSet: !!CERT_ID }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`eBay proxy running on port ${PORT}`));
