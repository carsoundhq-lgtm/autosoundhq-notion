// scripts/weekly_top5.js — creates a weekly "Top 5" article in Notion from your Products DB
// Requires env: NOTION_TOKEN, NOTION_DB_ARTICLES, NOTION_DB_PRODUCTS

import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ARTICLES = process.env.NOTION_DB_ARTICLES;
const DB_PRODUCTS = process.env.NOTION_DB_PRODUCTS;

if (!DB_ARTICLES || !DB_PRODUCTS) {
  console.error("Missing NOTION_DB_ARTICLES or NOTION_DB_PRODUCTS");
  process.exit(1);
}

// Heuristic category detection if your Products DB doesn't have a "category" property.
function detectCategory(name="") {
  const n = name.toLowerCase();
  if (n.includes("component")) return "Component Speakers";
  if (n.includes("coax") || n.includes("coaxial")) return "Coaxial Speakers";
  if (n.includes("4-channel") || n.includes("4 channel") || n.includes("x4")) return "4-Channel Amps";
  if (n.includes("powered sub") || n.includes("under-seat") || n.includes("pwe-")) return "Powered Subs";
  if (n.includes("head unit") || n.includes("receiver") || n.includes("carplay") || n.includes("dmx")) return "Head Units";
  if (n.includes("subwoofer") || n.match(/^\d{1,2}("|in| inch)/)) return "Subwoofers";
  return "Coaxial Speakers";
}

function pickCategoryOfWeek() {
  // Rotate categories per week
  const cats = ["Coaxial Speakers","Component Speakers","4-Channel Amps","Powered Subs","Head Units","Subwoofers"];
  const week = Math.floor(Date.now()/(7*24*3600*1000));
  return cats[week % cats.length];
}

async function fetchAll(dbId) {
  let out = [], cursor;
  do {
    const res = await notion.databases.query({ database_id: dbId, start_cursor: cursor });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

function titleOf(p){ 
  const props = p.properties||{};
  for (const v of Object.values(props)) if (v?.type==="title") return v.title?.map(t=>t.plain_text).join("")||"";
  return "";
}

function propertyByNameCI(props, names) {
  const keys = Object.keys(props||{});
  const want = names.map(n=>n.toLowerCase());
  const key = keys.find(k=> want.includes(k.toLowerCase()));
  return key ? props[key] : undefined;
}

async function main(){
  const products = await fetchAll(DB_PRODUCTS);
  const enriched = products.map(p=>{
    const props = p.properties||{};
    const name = titleOf(p);
    const catProp = propertyByNameCI(props, ["category","Category"]);
    const category = catProp?.select?.name || detectCategory(name);
    const priceProp = propertyByNameCI(props, ["price","Price"]);
    const price = (priceProp?.number!=null) ? priceProp.number : undefined;
    return { id:p.id, name, category, price };
  });

  const targetCat = pickCategoryOfWeek();
  const candidates = enriched.filter(x=>x.category===targetCat);
  const top5 = (candidates.length? candidates : enriched)
    .sort((a,b)=> (a.price??9999) - (b.price??9999))  // cheapest first if price exists
    .slice(0,5);

  const today = new Date();
  const title = `Top 5 ${targetCat} — Week of ${today.toLocaleDateString(undefined,{month:"short",day:"2-digit",year:"numeric"})}`;
  const description = `Our updated ${targetCat.toLowerCase()} picks this week. Curated from ${candidates.length?targetCat:"our latest inventory"} based on value, performance, and availability.`;

  // Build relation property to selected products
  const relationProp = top5.map(t => ({ id: t.id }));

  // Create the article (Status: Published; Published checkbox true if you use it; Slug auto from title)
  const properties = {};
  properties["Name"] = { title: [{ type:"text", text:{ content: title } }] };

  // common property names — adapt to your schema
  properties["status"] = { select: { name: "Published" } }; // if your Status is Select
  properties["Published"] = { checkbox: true };             // if you also use a checkbox
  properties["description"] = { rich_text: [{ type:"text", text:{ content: description } }] };
  properties["products"] = { relation: relationProp };

  await notion.pages.create({
    parent: { database_id: DB_ARTICLES },
    properties
  });

  console.log("Created weekly Top 5 article:", title);
}

main().catch(err=>{ console.error(err); process.exit(1); });
