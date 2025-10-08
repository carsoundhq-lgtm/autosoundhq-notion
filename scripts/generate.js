// scripts/generate.js — articles + product cards + SEO (tolerant + debug)

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Client } from "@notionhq/client";

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
{{JSONLD}}
</head><body>`;
const NAV = `<header class="site-header"><div class="container">
<a class="logo" href="/"><span>Auto</span>SoundHQ</a>
<nav><a href="/articles/index.html">Articles</a> <a href="/about.html">About</a> <a href="/contact.html">Contact</a> <a href="/disclosure.html">Affiliate Disclosure</a></nav>
</div></header>`;
const FOOT = `<footer class="site-footer"><div class="container">
<p>© ${YEAR} ${SITE_NAME}. All rights reserved.</p>
<p><a href="/privacy.html">Privacy</a> • <a href="/terms.html">Terms</a> • <a href="/sitemap.xml">Sitemap</a></p>
</div></footer></body></html>`;

const pageLayout = ({title, desc, body, jsonld=""}) =>
  (read("head.html", HEAD)
    .replace(/{{TITLE}}/g, title)
    .replace(/{{DESC}}/g, desc||"")
    .replace(/{{GA4}}/g, GA4)
    .replace(/{{SKIM}}/g, SKIM)
    .replace(/{{JSONLD}}/g, jsonld))
  + read("nav.html", NAV) + body + read("footer.html", FOOT);

// -------- tolerant Notion helpers --------
const getByNameCI = (properties, names, types=[]) => {
  const keys = Object.keys(properties||{});
  const wanted = names.map(n=>n.toLowerCase());
  const key = keys.find(k => wanted.includes(k.toLowerCase()));
  if (!key) return undefined;
  const p = properties[key];
  if (types.length && !types.includes(p?.type)) return undefined;
  return p;
};
const textFrom = (prop) => {
  if (!prop) return "";
  const t = prop.type;
  if (t === "title") return prop.title?.map(i=>i.plain_text).join("") || "";
  if (t === "rich_text") return prop.rich_text?.map(i=>i.plain_text).join("") || "";
  if (t === "url") return prop.url || "";
  if (t === "number") return String(prop.number ?? "");
  if (t === "select") return prop.select?.name || "";
  if (t === "multi_select") return prop.multi_select?.map(s=>s.name).join(",") || "";
  if (t === "date") return prop.date?.start || "";
  return "";
};
const firstTitle = (props) => {
  for (const v of Object.values(props||{})) if (v?.type==="title")
    return v.title?.map(i=>i.plain_text).join("") || "";
  return "";
};
const slugFrom = (props) => {
  let slug = textFrom(getByNameCI(props, ["slug","Slug","url_slug","permalink"], ["rich_text","title","url"])).trim();
  if (!slug) slug = firstTitle(props).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
  return slug;
};
const isPublished = (props) => {
  const status = textFrom(getByNameCI(props, ["status","Status"], ["select","rich_text","title"]));
  const pubBox = getByNameCI(props, ["published","is_published"], ["checkbox"])?.checkbox === true;
  return pubBox || /^published$/i.test(status.trim());
};
const relIds = (prop) => (prop?.relation || []).map(r => r.id);

// --------- fetch all pages from a DB ----------
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

// --------- MAIN ----------
async function main() {
  // assets
  await ensureDir(path.join(PUB_DIR, "assets/css"));
  await ensureDir(path.join(PUB_DIR, "assets/img"));
  if (fs.existsSync("styles.css")) await fsp.copyFile("styles.css", path.join(PUB_DIR, "assets/css/styles.css"));
  if (fs.existsSync("favicon.ico")) await fsp.copyFile("favicon.ico", path.join(PUB_DIR, "assets/img/favicon.ico"));

  // PRODUCTS (optional but recommended)
  const pMap = {};
  if (DB_PRODUCTS) {
    const products = await fetchAll(DB_PRODUCTS);
    console.log(`Products returned: ${products.length}`);
    for (const p of products) {
      const pr = p.properties || {};
      const name = firstTitle(pr);
      const img  = textFrom(getByNameCI(pr, ["image_url","Image","image","photo"], ["url","rich_text"]));
      let link   = textFrom(getByNameCI(pr, ["affiliate_link","url","link","purchase_url"], ["url","rich_text"]));
      if (AMAZON_TAG && /amazon\./i.test(link)) {
        try { const u=new URL(link); u.searchParams.set("tag", AMAZON_TAG); link=u.toString(); } catch {}
      }
      const brand = textFrom(getByNameCI(pr, ["brand"], ["rich_text","select","title"]));
      const price = textFrom(getByNameCI(pr, ["price","price_bucket","msrp"], ["rich_text","number","select"]));
      const desc  = textFrom(getByNameCI(pr, ["description","blurb","summary"], ["rich_text","title"]));
      pMap[p.id] = { name, img, link, brand, price, desc };
    }
  }

  // ARTICLES
  const pages = await fetchAll(DB_ARTICLES);
  console.log(`Articles returned: ${pages.length}`);

  const published = [];

  for (const page of pages) {
    const props = page.properties || {};
    const title = firstTitle(props);
    const slug  = slugFrom(props);
    const pub   = isPublished(props);
    console.log(`Found article: "${title}" | slug=${slug} | statusPublished=${pub}`);
    if (!pub) continue;

    const desc  = textFrom(getByNameCI(props, ["description","intro","summary","Description"], ["rich_text","title"]));
    const rel   = getByNameCI(props, ["products","Products"], ["relation"]);
    const ids   = relIds(rel);

    // Product cards (up to 8)
    let cards = "";
    if (ids.length) {
      cards = `<section class="picks"><h2>Top Picks</h2><div class="grid">` +
        ids.slice(0,8).map(id => {
          const pr = pMap[id] || {};
          const name = pr.name || "Product";
          const href = pr.link || "#";
          const img  = pr.img ? `<img src="${pr.img}" alt="${name}">` : "";
          const meta = [pr.brand, pr.price].filter(Boolean).join(" • ");
          return `<article class="card">
            ${img}
            <h3>${name}</h3>
            ${meta ? `<p class="meta">${meta}</p>` : ""}
            ${pr.desc ? `<p>${pr.desc}</p>` : ""}
            <p><a class="btn" href="${href}" target="_blank" rel="sponsored noopener">View</a></p>
          </article>`;
        }).join("") + `</div></section>`;
    }

    const body = `<main class="container">
      <h1>${title}</h1>
      ${desc ? `<p>${desc}</p>` : ""}
      ${cards}
      <p><em>Disclosure:</em> We may earn a commission when you buy via links on our site.</p>
    </main>`;

    // Article JSON-LD
    const jsonld = `<script type="application/ld+json">${JSON.stringify({
      "@context":"https://schema.org",
      "@type":"Article",
      "headline": title,
      "description": desc || "",
      "mainEntityOfPage": `${SITE_URL}/articles/${slug}.html`,
      "publisher": { "@type":"Organization", "name": SITE_NAME }
    })}</script>`;

    await write(`articles/${slug}.html`, pageLayout({
      title: `${title} — ${SITE_NAME}`,
      desc,
      body,
      jsonld
    }));
    published.push({ title, slug });
  }

  // Articles index
  const listHtml = published.length
    ? `<ul class="article-list">${published.map(p=>`<li><a href="/articles/${p.slug}.html">${p.title}</a></li>`).join("\n")}</ul>`
    : `<p>No published articles yet.</p>`;
  await write("articles/index.html", pageLayout({
    title: `${SITE_NAME} Articles`,
    desc: `All ${SITE_NAME} guides and product roundups.`,
    body: `<main class="container"><h1>Articles & Guides</h1>${listHtml}</main>`
  }));

  // Home + simple legal + robots/sitemap
  await write("index.html", pageLayout({
    title: `${SITE_NAME} — The Easiest Way to Choose Car Audio`,
    desc: `Expert, no-fluff car audio picks.`,
    body: `<section class="hero"><div class="container">
      <h1>Upgrade Your Car's Sound—Without Guesswork</h1>
      <p>We compare speakers, subs, amps, and head units across budgets and use-cases. Every pick links to trusted retailers. You buy, we may earn a commission.</p>
      <p><a class="btn" href="/articles/index.html">Browse Top Picks</a></p>
    </div></section>`
  }));

  const legal = (t,b)=>pageLayout({title:`${t} — ${SITE_NAME}`, desc:t, body:`<main class="container"><h1>${t}</h1>${b}</main>`});
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
