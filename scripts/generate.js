// scripts/generate.js (debug + tolerant)
// Works with Node 20, package.json "type":"module"

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Client } from "@notionhq/client";

// ----- ENV -----
const SITE_NAME = process.env.SITE_NAME || "AutoSoundHQ";
const SITE_URL  = process.env.SITE_URL  || "https://autosoundhq-notion.vercel.app";
const SKIM      = process.env.SKIMLINKS_PUB_ID || "";
const GA4       = process.env.GA4_MEASUREMENT_ID || "";
const AMAZON_TAG= process.env.AMAZON_TRACKING_ID || "";
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ARTICLES  = process.env.NOTION_DB_ARTICLES;
const DB_PRODUCTS  = process.env.NOTION_DB_PRODUCTS;

if (!NOTION_TOKEN || !DB_ARTICLES) {
  console.error("Missing env: NOTION_TOKEN or NOTION_DB_ARTICLES");
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

const PUB_DIR = "public";
const TPL_DIR = "templates";

// ---------- helpers ----------
const ensureDir = (p) => fsp.mkdir(p, { recursive: true });
const write = async (rel, content) => {
  const full = path.join(PUB_DIR, rel);
  await ensureDir(path.dirname(full));
  await fsp.writeFile(full, content, "utf8");
};

const read = (f, fb="") => {
  const p = path.join(TPL_DIR, f);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : fb;
};

const YEAR = new Date().getFullYear();

const HEAD = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="icon" href="/assets/img/favicon.ico">
<link rel="stylesheet" href="/assets/css/styles.css"/>
<title>{{TITLE}}</title><meta name="description" content="{{DESC}}"/>
<script async src="https://www.googletagmanager.com/gtag/js?id={{GA4}}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','{{GA4}}');</script>
<script src="https://s.skimresources.com/js/{{SKIM}}.skimlinks.js"></script>
</head><body>`;
const NAV = `<header class="site-header"><div class="container">
<a class="logo" href="/"><span>Auto</span>SoundHQ</a>
<nav><a href="/articles/index.html">Articles</a> <a href="/about.html">About</a> <a href="/contact.html">Contact</a> <a href="/disclosure.html">Affiliate Disclosure</a></nav>
</div></header>`;
const FOOT = `<footer class="site-footer"><div class="container">
<p>© ${YEAR} ${SITE_NAME}. All rights reserved.</p>
<p><a href="/privacy.html">Privacy</a> • <a href="/terms.html">Terms</a> • <a href="/sitemap.xml">Sitemap</a></p>
</div></footer></body></html>`;

const layout = ({title, desc, body}) =>
  (read("head.html", HEAD).replace(/{{TITLE}}/g, title).replace(/{{DESC}}/g, desc||"")
    .replace(/{{GA4}}/g, GA4).replace(/{{SKIM}}/g, SKIM))
  + (read("nav.html", NAV)) + body + (read("footer.html", FOOT));

// -------- Notion tolerant accessors --------
const getFirstTitle = (properties) => {
  for (const [k, v] of Object.entries(properties)) {
    if (v?.type === "title") {
      return v.title?.map(t => t.plain_text).join("") || "";
    }
  }
  return "";
};

const getByNameCI = (properties, names, allowedTypes=[]) => {
  // case-insensitive property lookup
  const keys = Object.keys(properties);
  const wanted = names.map(n => n.toLowerCase());
  const foundKey = keys.find(k => wanted.includes(k.toLowerCase()));
  if (!foundKey) return undefined;
  const prop = properties[foundKey];
  if (allowedTypes.length && !allowedTypes.includes(prop?.type)) return undefined;
  return prop;
};

const textFrom = (prop) => {
  if (!prop) return "";
  if (prop.type === "rich_text") return prop.rich_text?.map(t => t.plain_text).join("") || "";
  if (prop.type === "url") return prop.url || "";
  if (prop.type === "number") return String(prop.number ?? "");
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "multi_select") return prop.multi_select?.map(s => s.name).join(",") || "";
  if (prop.type === "title") return prop.title?.map(t=>t.plain_text).join("") || "";
  return "";
};

const truthyPublished = (properties) => {
  // status(select)=Published OR published(checkbox)=true OR status text contains "published"
  const statusProp = getByNameCI(properties, ["status","Status"], ["select","rich_text","title"]);
  const statusName = textFrom(statusProp).trim();
  const checkboxProp = getByNameCI(properties, ["published","is_published","published_at"], ["checkbox"]);
  const checkbox = checkboxProp?.checkbox === true;
  return checkbox || /^published$/i.test(statusName);
};

const slugFrom = (properties) => {
  const slugProp = getByNameCI(properties, ["slug","Slug","url_slug","permalink"], ["rich_text","title","url"]);
  let slug = (textFrom(slugProp) || "").trim();
  if (!slug) {
    // fallback: slugify title
    const t = getFirstTitle(properties);
    slug = t.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
  }
  return slug;
};

// ---------- fetch ----------
async function fetchAll(dbId) {
  const items = [];
  let cursor;
  do {
    const res = await notion.databases.query({ database_id: dbId, start_cursor: cursor });
    items.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return items;
}

// ---------- main ----------
async function main() {
  // ensure assets
  await ensureDir(path.join(PUB_DIR, "assets/css"));
  await ensureDir(path.join(PUB_DIR, "assets/img"));
  if (fs.existsSync("styles.css")) await fsp.copyFile("styles.css", path.join(PUB_DIR, "assets/css/styles.css"));
  if (fs.existsSync("favicon.ico")) await fsp.copyFile("favicon.ico", path.join(PUB_DIR, "assets/img/favicon.ico"));

  // ARTICLES
  const pages = await fetchAll(DB_ARTICLES);
  console.log(`Articles returned: ${pages.length}`);

  const published = [];

  for (const page of pages) {
    const props = page.properties || {};
    const propKeys = Object.keys(props);
    const title = getFirstTitle(props);
    const slug  = slugFrom(props);
    const isPub = truthyPublished(props);

    // DEBUG: show what we detected for each row
    console.log(`Found article: "${title}" | slug=${slug} | statusPublished=${isPub}`);
    if (title === "" || !slug) {
      console.log(`  ⚠ props for page ${page.id.slice(0,6)} keys=`, propKeys);
    }

    if (!isPub) continue;

    const descProp = getByNameCI(props, ["description","intro","summary","Description"], ["rich_text","title"]);
    const desc = textFrom(descProp);

    // Build simple article page
    const body = `<main class="container">
      <h1>${title}</h1>
      ${desc ? `<p>${desc}</p>` : ""}
      <p><em>Disclosure:</em> We may earn a commission when you buy via links on our site.</p>
    </main>`;
    await write(`articles/${slug}.html`, layout({ title: `${title} — ${SITE_NAME}`, desc, body }));
    published.push({ title, slug });
  }

  // ARTICLES index
const listHtml = published.length
  ? `<ul class="article-list">${published.map(p =>
      `<li><a href="/articles/${p.slug}.html">${p.title}</a></li>`
    ).join("\n")}</ul>`
  : `<p>No published articles yet.</p>`;
  await write("articles/index.html", layout({
    title: `${SITE_NAME} Articles`,
    desc: `All ${SITE_NAME} guides and product roundups.`,
    body: `<main class="container"><h1>Articles & Guides</h1>${listHtml}</main>`
  }));

  // Home + legal + sitemap/robots (light)
  await write("index.html", layout({
    title: `${SITE_NAME} — The Easiest Way to Choose Car Audio`,
    desc: `Expert, no-fluff car audio picks.`,
    body: `<section class="hero"><div class="container">
      <h1>Upgrade Your Car's Sound—Without Guesswork</h1>
      <p>We compare speakers, subs, amps, and head units across budgets and use-cases. Every pick links to trusted retailers. You buy, we may earn a commission.</p>
      <p><a class="btn" href="/articles/index.html">Browse Top Picks</a></p>
    </div></section>`
  }));

  const legal = (t,b)=>layout({title:`${t} — ${SITE_NAME}`,desc:t,body:`<main class="container"><h1>${t}</h1>${b}</main>`});
  await write("about.html", legal("About", `<p>${SITE_NAME} helps drivers upgrade their sound.</p>`));
  await write("contact.html", legal("Contact", `<p>Email: <a href="mailto:carsoundhq@gmail.com">carsoundhq@gmail.com</a></p>`));
  await write("disclosure.html", legal("Affiliate Disclosure", `<p>We may earn a commission when you buy through links on our site. As an Amazon Associate we earn from qualifying purchases.</p>`));
  await write("privacy.html", legal("Privacy Policy", `<p>We use Google Analytics to improve our content.</p>`));
  await write("terms.html", legal("Terms of Use", `<p>All content is for informational purposes only.</p>`));

  await write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  const urls = ["/", "/articles/index.html", ...published.map(p=>`/articles/${p.slug}.html`), "/about.html", "/contact.html", "/disclosure.html", "/privacy.html", "/terms.html"];
  await write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u=>`  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n")}\n</urlset>\n`);

  console.log(`Published articles: ${published.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
