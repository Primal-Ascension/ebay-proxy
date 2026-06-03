const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const APP_ID = process.env.EBAY_APP_ID;
const CERT_ID = process.env.EBAY_CERT_ID;
const POKETRACE_KEY = process.env.POKETRACE_KEY;

// PokeTrace search — primary pricing source
app.get("/sold", async (req, res) => {
  const { q, grade } = req.query;
  if (!q) return res.status(400).json({ error: "Missing q" });

  try {
    const params = new URLSearchParams({
      search: q,
      market: "US",
      limit: "5",
    });

    const url = `https://api.poketrace.com/v1/cards?${params}`;
    console.log("PokeTrace:", url);

    const ptRes = await fetch(url, {
      headers: { "X-API-Key": POKETRACE_KEY },
    });

    const raw = await ptRes.text();
    console.log("PokeTrace response:", raw.slice(0, 500));

    if (!ptRes.ok) {
      return res.status(500).json({ error: `PokeTrace ${ptRes.status}`, raw: raw.slice(0, 300) });
    }

    const data = JSON.parse(raw);
    const cards = data.data || data.cards || data.results || [];

    // Map PokeTrace response to our standard format
    const results = cards.map(card => ({
      title: `${card.name} — ${card.set?.name || ""}`,
      price: card.prices?.raw?.market || card.prices?.raw?.mid || card.prices?.market || null,
      psa9: card.prices?.psa_9?.market || null,
      psa10: card.prices?.psa_10?.market || null,
      date: card.prices?.updatedAt || card.updatedAt || null,
      url: card.url || card.tcgplayer?.url || null,
      condition: "Raw",
      source: "poketrace",
      cardId: card.id,
    }));

    res.json({ results, query: q, count: results.length, raw_sample: cards[0] || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Diagnostic — test PokeTrace directly and return full first card
app.get("/test-poketrace", async (req, res) => {
  const q = req.query.q || "Charizard Base Set";
  try {
    const params = new URLSearchParams({ search: q, market: "US", limit: "3" });
    const ptRes = await fetch(`https://api.poketrace.com/v1/cards?${params}`, {
      headers: { "X-API-Key": POKETRACE_KEY },
    });
    const raw = await ptRes.text();
    const data = JSON.parse(raw);
    res.json({ status: ptRes.status, keySet: !!POKETRACE_KEY, raw: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/health", (req, res) => res.json({
  status: "ok",
  api: "PokeTrace v1",
  poketraceSet: !!POKETRACE_KEY,
  ebayAppId: APP_ID?.slice(0, 20) + "...",
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
