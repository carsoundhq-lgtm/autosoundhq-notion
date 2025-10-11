// scripts/weekly_top5.js — creates a weekly "Top 5" article in Notion from your Products DB
// Env required: NOTION_TOKEN, NOTION_DB_ARTICLES, NOTION_DB_PRODUCTS
// Node: >=18 ; package.json: { "type": "module" }

import { Client } from "@notionhq/client";

/* ===== Env checks ===== */
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ARTICLES = process.env.NOTION_DB_ARTICLES;
const DB_PRODUCTS = process.env.NOTION_DB_PRODUCTS;

if (!NOTION_TOKEN) {
  console.error("Missing NOTION_TOKEN");
  process.exit(1);
}
if (!DB_ARTICLES || !DB_PRODUCTS) {
  console.error("Missing NOTION_DB_ARTICLES or NOTION_DB_PRODUCTS");
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

/* ===== Helpers ===== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Case-insensitive property getter (by name list). */
function propertyByNameCI(props, names) {
  const keys = Object.keys(props || {});
  const want = names.map((n) => n.toLowerCase());
  const key = keys.find((k) => want.includes(k.toLowerCase()));
  return key ? { key, prop: props[key] } : undefined;
}

/** Find the Title property key from a database schema. */
async function getTitleKeyForDatabase(databaseId) {
  const db = await notion.databases.retrieve({ database_id: databaseId });
  // Notion API marks title prop with type === "title"
  for (const [k, v] of Object.entries(db.properties || {})) {
    if (v?.type === "title") return k;
  }
  // Fallback heuristics
  const keys = Object.keys(db.properties || {});
  const guess = keys.find((k) => /^name$/i.test(k)) || keys[0];
  return guess;
}

/** Fetch all pages from a DB. */
async function fetchAll(databaseId) {
  let out = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
    });
    out = out.concat(res.results || []);
    cursor = res.has_more ? res.next_cursor : undefined;
    // Be gentle on large DBs
    if (cursor) await sleep(60);
  } while (cursor);
  return out;
}

/** Extract a page title (string). */
function titleOf(page) {
  const props = page.properties || {};
  for (const v of Object.values(props)) {
    if (v?.type === "title") {
      return (v.title || []).map((t) => t.plain_text).join("") || "";
    }
  }
  return "";
}

/** Detect a category when Products DB doesn't have one. */
function detectCategory(name = "") {
  const n = name.toLowerCase();
  if (n.includes("component")) return "Component Speakers";
  if (n.includes("coax") || n.includes("coaxial")) return "Coaxial Speakers";
  if (n.includes("4-channel") || n.includes("4 channel") || n.includes("x4"))
    return "4-Channel Amps";
  if (n.includes("powered sub") || n.includes("under-seat") || n.includes("pwe-"))
    return "Powered Subs";
  if (n.includes("head unit") || n.includes("receiver") || n.includes("carplay") || n.includes("dmx"))
    return "Head Units";
  if (n.includes("subwoofer") || /^\d{1,2}("|in| inch)/.test(n)) return "Subwoofers";
  return "Coaxial Speakers";
}

/** Rotate a category each calendar week. */
function pickCategoryOfWeek() {
  const cats = [
    "Coaxial Speakers",
    "Component Speakers",
    "4-Channel Amps",
    "Powered Subs",
    "Head Units",
    "Subwoofers",
  ];
  const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  return cats[week % cats.length];
}

/* ===== Main ===== */
async function main() {
  // Read Articles DB schema to learn actual property keys
  const dbArticles = await notion.databases.retrieve({ database_id: DB_ARTICLES });
  const articleProps = dbArticles.properties || {};

  const titleKey = await getTitleKeyForDatabase(DB_ARTICLES);

  // Optional properties (case-insensitive)
  const statusInfo = propertyByNameCI(articleProps, ["status", "Status"]);
  const publishedInfo = propertyByNameCI(articleProps, ["published", "is_published", "Published"]);
  const descInfo = propertyByNameCI(articleProps, ["description", "Description", "summary", "Summary"]);
  const productsInfo = propertyByNameCI(articleProps, ["products", "Products"]);

  // Pull all products and enrich
  const products = await fetchAll(DB_PRODUCTS);

  // Products DB: try to detect its schema
  const dbProducts = await notion.databases.retrieve({ database_id: DB_PRODUCTS });
  const productProps = dbProducts.properties || {};
  const productCategoryKey = (propertyByNameCI(productProps, ["category", "Category"]) || {}).key;
  const productPriceKey = (propertyByNameCI(productProps, ["price", "Price", "msrp"]) || {}).key;

  const enriched = products.map((p) => {
    const props = p.properties || {};
    const name = titleOf(p);
    const category =
      (productCategoryKey && props[productCategoryKey]?.select?.name) ||
      detectCategory(name);
    let price;
    if (productPriceKey) {
      const pr = props[productPriceKey];
      if (pr?.type === "number") price = pr.number ?? undefined;
      // Some folks store price as rich_text
      if (pr?.type === "rich_text") {
        const txt = (pr.rich_text || []).map((t) => t.plain_text).join("");
        const num = Number(String(txt).replace(/[^0-9.]/g, ""));
        if (!Number.isNaN(num)) price = num;
      }
      // Select buckets treated as undefined for sorting
    }
    return { id: p.id, name, category, price };
  });

  const targetCat = pickCategoryOfWeek();
  const candidates = enriched.filter((x) => x.category === targetCat);
  const top5 = (candidates.length ? candidates : enriched)
    .slice() // copy
    .sort((a, b) => (a.price ?? 999999) - (b.price ?? 999999)) // cheap→expensive if prices exist
    .slice(0, 5);

  const today = new Date();
  const title = `Top 5 ${targetCat} — Week of ${today.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
  })}`;
  const description = `Our updated ${targetCat.toLowerCase()} picks this week. Curated from ${
    candidates.length ? targetCat : "our latest inventory"
  } based on value, performance, and availability.`;

  // Build Notion page properties, only including keys that exist in the DB
  const properties = {};

  // Title
  properties[titleKey] = {
    title: [{ text: { content: title } }],
  };

  // Description (rich_text) if present
  if (descInfo?.key) {
    properties[descInfo.key] = {
      rich_text: [{ text: { content: description } }],
    };
  }

  // Status (select) if present
  if (statusInfo?.key && articleProps[statusInfo.key]?.type === "select") {
    properties[statusInfo.key] = { select: { name: "Published" } };
  }

  // Published (checkbox) if present
  if (publishedInfo?.key && articleProps[publishedInfo.key]?.type === "checkbox") {
    properties[publishedInfo.key] = { checkbox: true };
  }

  // Products relation if present
  if (productsInfo?.key && articleProps[productsInfo.key]?.type === "relation") {
    properties[productsInfo.key] = {
      relation: top5.map((t) => ({ id: t.id })),
    };
  }

  // Create the page
  await notion.pages.create({
    parent: { database_id: DB_ARTICLES },
    properties,
  });

  console.log("Created weekly Top 5 article:", title);
}

main().catch((err) => {
  console.error("weekly_top5.js failed:", err?.message || err);
  process.exit(1);
});
