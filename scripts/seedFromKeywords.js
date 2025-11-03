// scripts/seedFromKeywords.js
// Creates one new Notion article per run from the Keywords DB and marks the keyword as Used.

import { Client } from "@notionhq/client";

const NOTION_TOKEN     = process.env.NOTION_TOKEN;
const DB_ARTICLES      = process.env.NOTION_DB_ARTICLES;   // Articles database ID
const DB_KEYWORDS      = process.env.NOTION_DB_KEYWORDS;   // Keywords database ID

if (!NOTION_TOKEN || !DB_ARTICLES || !DB_KEYWORDS) {
  console.error("Missing NOTION_TOKEN or DB ids (NOTION_DB_ARTICLES / NOTION_DB_KEYWORDS).");
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

// --- helpers to find props case-insensitively
function propKeyByName(properties, names) {
  const keys = Object.keys(properties || {});
  const wanted = names.map(n => n.toLowerCase());
  return keys.find(k => wanted.includes(k.toLowerCase()));
}

function textFrom(prop) {
  if (!prop) return "";
  if (prop.type === "title")     return (prop.title || []).map(t => t.plain_text).join("");
  if (prop.type === "rich_text") return (prop.rich_text || []).map(t => t.plain_text).join("");
  return "";
}

// fetch all pages in a DB (simple pagination)
async function fetchAll(dbId) {
  const out = [];
  let cursor;
  do {
    const res = await notion.databases.query({ database_id: dbId, start_cursor: cursor });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function main() {
  // 1) Get unused keyword
  const allKw = await fetchAll(DB_KEYWORDS);

  // try to detect "Used" checkbox prop name
  const sampleProps = allKw[0]?.properties || {};
  const usedKey = propKeyByName(sampleProps, ["Used","used","Is Used","is_used"]);
  const titleKey = propKeyByName(sampleProps, ["Title","Keyword","Name"]);
  const descKey  = propKeyByName(sampleProps, ["Description","Desc","Notes"]);

  const candidates = allKw.filter(p => {
    if (!titleKey) return false;
    const used = usedKey ? (p.properties[usedKey]?.checkbox === true) : false;
    const title = textFrom(p.properties[titleKey]).trim();
    return !used && !!title;
  });

  if (!candidates.length) {
    console.log("No unused keywords found. Nothing to seed today.");
    return;
  }

  const kw = candidates[0];
  const kwTitle = textFrom(kw.properties[titleKey]).trim();
  const kwDesc  = descKey ? textFrom(kw.properties[descKey]).trim() : "";

  // 2) Create an Article page (Published)
  // We must map properties generically: Title, Description/Intro/Summary, Published/Status
  // We'll create the minimal properties safely; Notion will accept unknown props.
  const articleProps = {};

  // Title (required)
  articleProps[titleKey || "Title"] = {
    title: [{ type: "text", text: { content: kwTitle } }]
  };

  // Description (optional)
  const articleDescKey = "Description";
  articleProps[articleDescKey] = {
    rich_text: [{ type: "text", text: { content: kwDesc || `Guide: ${kwTitle}` } }]
  };

  // Published (checkbox) — common pattern in your setup
  articleProps["Published"] = { checkbox: true };

  // Date (optional)
  articleProps["Published At"] = { date: { start: new Date().toISOString() } };

  // Create page in Articles DB
  const created = await notion.pages.create({
    parent: { database_id: DB_ARTICLES },
    properties: articleProps
  });

  console.log("Created article page:", created.id, kwTitle);

  // 3) Mark keyword as Used = true
  if (usedKey) {
    await notion.pages.update({
      page_id: kw.id,
      properties: { [usedKey]: { checkbox: true } }
    });
    console.log("Marked keyword as used.");
  } else {
    console.log("No 'Used' checkbox property found in Keywords DB; skipping mark.");
  }
}

main().catch(err => { console.error(err); process.exit(1); });
