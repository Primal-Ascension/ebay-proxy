const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const POKETRACE_KEY = process.env.POKETRACE_KEY;
const SHEET_ID = "530728558219140";
const POKETRACE_ID_COL = 8008365962989444;
const PRICE_COL = 2051927646179204;
const DATE_COL = 6555527273549700;

// Search PokeTrace and return top matches with IDs
app.get("/lookup", async (req, res) => {
  const { q, set } = req.query;
  if (!q) return res.status(400).json({ error: "Missing q" });

  try {
    // Clean the query — remove card numbers and special chars that confuse PokeTrace
    const cleanQ = q.replace(/[#\/\d]+$/, '').replace(/\s+/g, ' ').trim();
    const params = new URLSearchParams({ search: cleanQ, market: "US", limit: "5" });
    if (set) params.append("set", set);

    const ptRes = await fetch(`https://api.poketrace.com/v1/cards?${params}`, {
      headers: { "X-API-Key": POKETRACE_KEY },
    });

    const data = await ptRes.json();
    const cards = data.data || [];

    const results = cards.map(card => ({
      id: card.id,
      name: card.name,
      set: card.set?.name,
      setSlug: card.set?.slug,
      cardNumber: card.cardNumber,
      variant: card.variant,
      rarity: card.rarity,
      nmPrice: card.prices?.ebay?.NEAR_MINT?.avg || card.prices?.tcgplayer?.NEAR_MINT?.avg || null,
      lastUpdated: card.lastUpdated,
    }));

    res.json({ results, count: results.length, query: q });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get price by PokeTrace card ID
app.get("/price/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const ptRes = await fetch(`https://api.poketrace.com/v1/cards/${id}`, {
      headers: { "X-API-Key": POKETRACE_KEY },
    });
    const data = await ptRes.json();
    const card = data.data || data;

    const ebayNM = card.prices?.ebay?.NEAR_MINT;
    const tcgNM = card.prices?.tcgplayer?.NEAR_MINT;

    res.json({
      id: card.id,
      name: card.name,
      set: card.set?.name,
      cardNumber: card.cardNumber,
      ebay: {
        avg: ebayNM?.avg,
        avg7d: ebayNM?.avg7d,
        avg30d: ebayNM?.avg30d,
        lastUpdated: ebayNM?.lastUpdated,
      },
      tcgplayer: {
        avg: tcgNM?.avg,
        avg7d: tcgNM?.avg7d,
        lastUpdated: tcgNM?.lastUpdated,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Bulk price lookup — reads card list from request body, looks up each by PokeTrace ID
app.post("/bulk-price", async (req, res) => {
  const { cards } = req.body; // [{ rowId, poketraceId, name }]
  if (!cards?.length) return res.status(400).json({ error: "Missing cards array" });

  const results = [];
  const errors = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const card of cards) {
    try {
      const ptRes = await fetch(`https://api.poketrace.com/v1/cards/${card.poketraceId}`, {
        headers: { "X-API-Key": POKETRACE_KEY },
      });
      const data = await ptRes.json();
      const c = data.data || data;

      const ebayNM = c.prices?.ebay?.NEAR_MINT;
      const price = ebayNM?.avg7d || ebayNM?.avg || null;
      const updated = ebayNM?.lastUpdated?.slice(0, 10) || today;

      if (price) {
        results.push({
          rowId: card.rowId,
          name: card.name,
          price: `$${parseFloat(price).toFixed(2)} NM eBay avg7d (${updated})`,
        });
      } else {
        errors.push({ name: card.name, reason: "No NM price" });
      }
    } catch (e) {
      errors.push({ name: card.name, reason: e.message });
    }

    // Rate limit: 30 req/10s max, stay safe at ~2/sec
    await new Promise(r => setTimeout(r, 550));
  }

  res.json({ results, errors, count: results.length });
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/health", (req, res) => res.json({
  status: "ok",
  api: "PokeTrace v1",
  poketraceSet: !!POKETRACE_KEY,
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
