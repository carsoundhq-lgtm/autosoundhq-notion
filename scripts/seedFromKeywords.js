// scripts/seedFromKeywords.js
// Create a new Article row from the first unused Keyword row,
// auto-mapping your Articles DB properties (no hard-coded names).

import { Client } from "@notionhq/client";

const NOTION_TOKEN        = process.env.NOTION_TOKEN;
const DB_KEYWORDS         = process.env.NOTION_DB_KEYWORDS;
const DB_ARTICLES         = process.env.NOTION_DB_ARTICLES;

if (!NOTION_TOKEN || !DB_KEYWORDS || !DB_ARTICLES) {
  console.error("Missing env: NOTION_TOKEN, NOTION_DB_KEYWORDS, or NOTION_DB_ARTICLES.");
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

/* ---------- Helpers ---------- */
function titlePlain(title) {
  if (!Array.isArray(title)) return "";
  return title.map(t => t.plain_text || t.text?.content || "").join("");
}

function firstTitleKey(props) {
  return Object.keys(props || {}).find(k => props[k]?.type === "title") || null;
}

// Find a property by candidate names + allowed types (case-insensitive)
function findPropName(props, candidates, allowedTypes) {
  const keys = Object.keys(props || {});
  for (const k of keys) {
    const def = props[k];
    if (!def) continue;
    const nameMatch = candidates.some(c => c.toLowerCase() === k.toLowerCase());
    const typeMatch = allowedTypes ? allowedTypes.includes(def.type) : true;
    if (nameMatch && typeMatch) return k;
  }
  return null;
}

// Looser search: try contains (for things like "Published Date" etc)
function findPropNameLoose(props, needles, allowedTypes) {
  const keys = Object.keys(props || {});
  for (const k of keys) {
    const def = props[k];
    if (!def) continue;
    const nameLower = k.toLowerCase();
    const nameMatch = needles.some(n => nameLower.includes(n.toLowerCase()));
    const typeMatch = allowedTypes ? allowedTypes.includes(def.type) : true;
    if (nameMatch && typeMatch) return k;
  }
  return null;
}

/* ---------- Get one unused keyword ---------- */
async function getOneUnusedKeyword() {
  // Detect the "Used" checkbox in the Keywords DB (optional)
  const kwDb = await notion.databases.retrieve({ database_id: DB_KEYWORDS });
  const kwProps = kwDb.properties || {};
  const kwTitleKey = firstTitleKey(kwProps);

  if (!kwTitleKey) {
    throw new Error("Keywords DB has no title property.");
  }

  const usedKey =
    findPropName(kwProps, ["Used", "Is Used", "is_used", "used"], ["checkbox"]) ||
    findPropNameLoose(kwProps, ["used"], ["checkbox"]);

  // Query: prefer unused (if checkbox exists), otherwise just take first row
  let query = { database_id: DB_KEYWORDS, page_size: 10 };
  if (usedKey) {
    query.filter = {
      property: usedKey,
      checkbox: { equals: false }
    };
  }

  const res = await notion.databases.query(query);
  const rows = res.results || [];
  if (!rows.length) return { page: null, kwTitleKey, usedKey };

  const page = rows[0];
  const title = titlePlain(page.properties[kwTitleKey]?.title || []);
  return { page, title, kwTitleKey, usedKey };
}

/* ---------- Create Article row ---------- */
async function createArticleFromKeyword(keywordTitle) {
  const db = await notion.databases.retrieve({ database_id: DB_ARTICLES });
  const props = db.properties || {};

  // Detect your Articles DB property names
  const titleKey = firstTitleKey(props);
  if (!titleKey) throw new Error("Articles DB has no title property.");

  const descKey =
    findPropName(props, ["Description", "Intro", "Summary", "Desc", "Blurb"], ["rich_text", "title"]) ||
    findPropNameLoose(props, ["desc", "intro", "summary", "blurb"], ["rich_text", "title"]);

  // Either we have a checkbox or a select for Published/Status
  const publishedCheckboxKey =
    findPropName(props, ["Published", "Is Published", "is_published"], ["checkbox"]) ||
    findPropNameLoose(props, ["published"], ["checkbox"]);

  const statusSelectKey =
    findPropName(props, ["Status"], ["select"]) ||
    findPropNameLoose(props, ["status"], ["select"]);

  const dateKey =
    findPropName(props, ["Published At", "Date", "Published Date"], ["date"]) ||
    findPropNameLoose(props, ["date", "published"], ["date"]);

  // Show mapping we detected
  console.log("Articles DB mapping:");
  console.log("  titleKey     :", titleKey);
  console.log("  descKey      :", descKey || "(none)");
  console.log("  checkbox Pub :", publishedCheckboxKey || "(none)");
  console.log("  select Status:", statusSelectKey || "(none)");
  console.log("  dateKey      :", dateKey || "(none)");

  // Build properties payload
  const todayISO = new Date().toISOString().split("T")[0];
  const properties = {};

  properties[titleKey] = {
    title: [{ text: { content: keywordTitle || "New Article" } }]
  };

  if (descKey) {
    properties[descKey] = {
      [props[descKey].type === "title" ? "title" : "rich_text"]: [
        { text: { content: `Getting started with ${keywordTitle}.` } }
      ]
    };
  }

  if (publishedCheckboxKey) {
    properties[publishedCheckboxKey] = { checkbox: true };
  } else if (statusSelectKey) {
    // Try to set "Published" option if it exists; otherwise use the first option
    const options = props[statusSelectKey]?.select?.options || [];
    const publishedOpt = options.find(o => /published/i.test(o.name)) || options[0];
    if (publishedOpt) {
      properties[statusSelectKey] = { select: { name: publishedOpt.name } };
    }
  }

  if (dateKey) {
    properties[dateKey] = { date: { start: todayISO } };
  }

  // Create the new page
  const created = await notion.pages.create({
    parent: { database_id: DB_ARTICLES },
    properties
  });

  return created;
}

/* ---------- Mark keyword as used (optional) ---------- */
async function markKeywordUsed(page, usedKey) {
  if (!page || !usedKey) return;
  const pageId = page.id;
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: { [usedKey]: { checkbox: true } }
    });
  } catch (e) {
    console.warn("Could not mark keyword as used:", e.message || e);
  }
}

/* ---------- Main ---------- */
(async () => {
  try {
    const { page: kwPage, title, kwTitleKey, usedKey } = await getOneUnusedKeyword();

    if (!kwPage) {
      console.log("No unused keywords found (or Keywords DB is empty). Nothing to seed.");
      return;
    }

    const keyword = title || "New Article";
    console.log("Seeding article for keyword:", `"${keyword}"`);

    const created = await createArticleFromKeyword(keyword);
    console.log("Created article page:", created.id);

    await markKeywordUsed(kwPage, usedKey);
    console.log("Done.");
  } catch (err) {
    console.error("@notionhq/client warn: request fail {");
    console.error("  code:", err.code || "(unknown)");
    console.error("  message:", err.message || String(err));
    console.error("}");
    process.exit(1);
  }
})();
