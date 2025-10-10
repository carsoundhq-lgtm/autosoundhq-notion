// scripts/generate.js — AutoSoundHQ static site generator (full, consolidated)
// Node >= 18; package.json should have: { "type": "module" }

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Client } from "@notionhq/client";

/* ========= ENV ========= */
const SITE_NAME      = process.env.SITE_NAME || "AutoSoundHQ";
const SITE_URL       = process.env.SITE_URL  || "https://autosoundhq-notion.vercel.app";
const SKIM_PUB_ID    = process.env.SKIMLINKS_PUB_ID || "";
const GA4            = process.env.GA4_MEASUREMENT_ID || "";
const AMAZON_TAG     = process.env.AMAZON_TRACKING_ID || "autosoundhq-20"; // your Associate tag
const BREVO_FORM_URL = process.env.BREVO_FORM_URL || "";

const NOTION_TOKEN   = process.env.NOTION_TOKEN;
const DB_ARTICLES    = process.env.NOTION_DB_ARTICLES;
const DB_PRODUCTS    = process.env.NOTION_DB_PRODUCTS;

if (!NOTION_TOKEN || !DB_ARTICLES) {
  console.error("Missing env: NOTION_TOKEN or NOTION_DB_ARTICLES");
  process.exit(1);
}

/* ========= Notion + paths ========= */
const notion  = new Client({ auth: NOTION_TOKEN });
const PUB_DIR = "public";
const TPL_DIR = "templates";

/* ========= fs helpers ========= */
const ensureDir = (p) => fsp.mkdir(p, { recursive: true });
const write = async (rel, content) => {
  const full = path.join(PUB_DIR, rel);
  await ensureDir(path.dirname(full));
  await fsp.writeFile(full, content, "utf8");
};
const read = (f, fallback = "") => {
  const p = path.join(TPL_DIR, f);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : fallback;
};

/* ========= HTML shells (with GA4 beacon + OG/Twitter) ========= */
const YEAR = new Date().getFullYear();

const HEAD = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="icon" href="/assets/img/favicon.ico">
<link rel="stylesheet" href="/assets/css/styles.css"/>
<title>{{TITLE}}</title>
<meta name="description" content="{{DESC}}"/>

<!-- Open Graph -->
<meta property="og:type" content="{{OG_TYPE}}">
<meta property="og:title" content="{{OG_TITLE}}">
<meta property="og:description" content="{{OG_DESC}}">
<meta property="og:url" content="{{OG_URL}}">
<meta property="og:image" content="{{OG_IMAGE}}">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{{OG_TITLE}}">
<meta name="twitter:description" content="{{OG_DESC}}">
<meta name="twitter:image" content="{{OG_IMAGE}}">

${GA4 ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config','${GA4}', { transport_type: 'beacon' });

// OPTIONAL: enable GA4 debug (view in Admin → DebugView)
// gtag('set', 'debug_mode', true);

function sendAffiliateEvent(name, href){
  try {
    gtag('event', 'affiliate_click', {
      event_category: 'affiliate',
      event_label: name || href,
      merchant: /amazon\\./i.test(href) ? 'amazon' : (/crutchfield\\./i.test(href) ? 'crutchfield' : 'other'),
      product_name: name || '',
      destination: href,
      transport_type: 'beacon',
      event_timeout: 2000
    });
  } catch(e) {}
  // Fallback attempt for very strict blockers
  try {
    if (navigator.sendBeacon) {
      const data = new Blob([], { type: 'application/x-www-form-urlencoded' });
      navigator.sendBeacon('https://www.google-analytics.com/g/collect?v=2&tid=${GA4}&en=affiliate_click&dl='+encodeURIComponent(location.href), data);
    }
  } catch(e) {}
}

// Capture clicks on product buttons/links
addEventListener('click', function(e){
  const a = e.target.closest('a');
  if(!a) return;
  const cls = (a.getAttribute('class')||'').toLowerCase();
  const rel = (a.getAttribute('rel')||'').toLowerCase();
  const isAffiliate = cls.includes('btn') || rel.includes('sponsored');
  if(!isAffiliate) return;

  const card = a.closest('.card');
  const name = card ? (card.querySelector('h3')?.textContent || '') : '';
  const href = a.href || '';

  sendAffiliateEvent(name, href);
}, true);
</script>` : ""}

${SKIM_PUB_ID ? `<script src="https://s.skimresources.com/js/${SKIM_PUB_ID}.skimlinks.js"></script>` : ""}

{{JSONLD}}
</head><body>`;

const NAV = `<header class="site-header"><div class="container">
  <a class="logo" href="/"><span>Auto</span>SoundHQ</a>
  <nav>
    <a href="/articles/index.html">Articles</a>
    <a href="/about.html">About</a>
    <a href="/contact.html">Contact</a>
    <a href="/disclosure.html">Affiliate Disclosure</a>
  </nav>
</div></header>`;

const FOOT = `<footer class="site-footer"><div class="container">
  <p>© ${YEAR} ${SITE_NAME}. All rights reserved.</p>
  <p><a href="/privacy.html">Privacy</a> • <a href="/terms.html">Terms</a> • <a href="/sitemap.xml">Sitemap</a></p>
</div></footer></body></html>`;

/** Build a page with OG/Twitter placeholders filled per-page */
function pageLayout({ title, desc, body, jsonld = "", og = {} }) {
  const ogDefaults = {
    type: og.type || "website",
    title: og.title || title,
    desc: og.desc || (desc || ""),
    url: og.url || SITE_URL,
    image: og.image || `${SITE_URL}/assets/img/og-default.jpg`
  };
  return (
    read("head.html", HEAD)
      .replace(/{{TITLE}}/g, title)
      .replace(/{{DESC}}/g, desc || "")
      .replace(/{{OG_TYPE}}/g, ogDefaults.type)
      .replace(/{{OG_TITLE}}/g, ogDefaults.title)
      .replace(/{{OG_DESC}}/g, ogDefaults.desc)
      .replace(/{{OG_URL}}/g, ogDefaults.url)
      .replace(/{{OG_IMAGE}}/g, ogDefaults.image)
      .replace("{{JSONLD}}", jsonld)
    + read("nav.html", NAV)
    + body
    + read("footer.html", FOOT)
  );
}

/* ========= Notion helpers ========= */
const getByNameCI = (properties, names, types = []) => {
  const keys = Object.keys(properties || {});
  const wanted = names.map(n => n.toLowerCase());
  const key = keys.find(k => wanted.includes(k.toLowerCase()));
  if (!key) return undefined;
  const prop = properties[key];
  if (types.length && !types.includes(prop?.type)) return undefined;
  return prop;
};

const textFrom = (prop) => {
  if (!prop) return "";
  const t = prop.type;
  if (t === "title")       return prop.title?.map(i => i.plain_text).join("") || "";
  if (t === "rich_text")   return prop.rich_text?.map(i => i.plain_text).join("") || "";
  if (t === "url")         return prop.url || "";
  if (t === "number")      return String(prop.number ?? "");
  if (t === "select")      return prop.select?.name || "";
  if (t === "multi_select")return prop.multi_select?.map(s => s.name).join(",") || "";
  if (t === "date")        return prop.date?.start || "";
  if (t === "checkbox")    return prop.checkbox ? "true" : "";
  return "";
};

const firstTitle = (props) => {
  for (const v of Object.values(props || {})) {
    if (v?.type === "title") return v.title?.map(i => i.plain_text).join("") || "";
  }
  return "";
};

const slugFrom = (props) => {
  let slug = textFrom(getByNameCI(props, ["slug","url_slug","permalink"], ["rich_text","title","url"])).trim();
  if (!slug) slug = firstTitle(props).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
  return slug;
};

const isPublished = (props) => {
  const status = textFrom(getByNameCI(props, ["status"], ["select","rich_text","title"])).trim();
  const checked = getByNameCI(props, ["published","is_published"], ["checkbox"])?.checkbox === true;
  return checked || /^published$/i.test(status);
};

const relIds = (prop) => (prop?.relation || []).map(r => r.id);

/* ========= Fetch all from Notion DB ========= */
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

/* ========= Affiliate link builder ========= */
/** Always use an Amazon SEARCH link with tag (never 404s). Others unchanged (Skimlinks handles). */
function affiliateURL(name, raw) {
  if (!raw) raw = "";
  const isAmazon = /(^https?:\/\/)?([a-z0-9.-]*\.)?amazon\./i.test(raw) || /amazon/i.test(name);
  const isCrutch = /crutchfield\.com/i.test(raw);
  const isSonic  = /sonicelectronix\.com/i.test(raw);
  
  if (isAmazon) {
    const q = encodeURIComponent(name || "");
    return `https://www.amazon.com/s?k=${q}&tag=${encodeURIComponent(AMAZON_TAG)}`;
  }

  // Crutchfield & Sonic = pass through directly
  if (isCrutch || isSonic) return raw;

  // Everything else → wrap with Skimlinks publisher redirect
  if (SKIM_PUB_ID) {
    const enc = encodeURIComponent(raw);
    return `https://go.skimresources.com/?id=${SKIM_PUB_ID}&xs=1&url=${enc}`;
  }

  // Default fallback
  return raw;
}

/* ========= MAIN ========= */
async function main() {
  // assets
  await ensureDir(path.join(PUB_DIR, "assets/css"));
  await ensureDir(path.join(PUB_DIR, "assets/img"));
  if (fs.existsSync("styles.css"))
    await fsp.copyFile("styles.css", path.join(PUB_DIR, "assets/css/styles.css"));
  if (fs.existsSync("favicon.ico"))
    await fsp.copyFile("favicon.ico", path.join(PUB_DIR, "assets/img/favicon.ico"));
  // Optional default OG image (create one if you want a nice social card)
  if (fs.existsSync("og-default.jpg"))
    await fsp.copyFile("og-default.jpg", path.join(PUB_DIR, "assets/img/og-default.jpg"));

  // ----- PRODUCTS
  const productsMap = {};
  if (DB_PRODUCTS) {
    const products = await fetchAll(DB_PRODUCTS);
    for (const p of products) {
      const pr = p.properties || {};
      const name  = firstTitle(pr);
      const img   = textFrom(getByNameCI(pr, ["image_url","Image","image","photo"], ["url","rich_text"]));
      const link  = textFrom(getByNameCI(pr, ["affiliate_link","url","link","purchase_url"], ["url","rich_text"]));
      const brand = textFrom(getByNameCI(pr, ["brand"], ["rich_text","select","title"]));
      const price = textFrom(getByNameCI(pr, ["price","price_bucket","msrp"], ["rich_text","number","select"]));
      const desc  = textFrom(getByNameCI(pr, ["description","blurb","summary"], ["rich_text","title"]));
      productsMap[p.id] = { name, img, link, brand, price, desc };
    }
    console.log(`Loaded products: ${Object.keys(productsMap).length}`);
  }

  // ----- ARTICLES
  const pages = await fetchAll(DB_ARTICLES);
  console.log(`Articles returned: ${pages.length}`);

  const published = [];

  for (const page of pages) {
    const props = page.properties || {};
    const title = firstTitle(props);
    const slug  = slugFrom(props);
    const pub   = isPublished(props);

    console.log(`Article: "${title}" (slug=${slug}) published=${pub}`);
    if (!pub) continue;

    const desc = textFrom(getByNameCI(props, ["description","intro","summary","Description"], ["rich_text","title"]));
    const rel  = getByNameCI(props, ["products","Products"], ["relation"]);
    const ids  = relIds(rel);

    // Product cards
    let cards = "";
    if (ids.length) {
      const cardHTML = ids.map(id => {
        const pr = productsMap[id] || {};
        const name = pr.name || "Product";
        const href = affiliateURL(name, pr.link || "");
        const img  = pr.img || "";
        const meta = [pr.brand, pr.price].filter(Boolean).join(" • ");
        const safeDesc = pr.desc || "";

        return `<article class="card">
          ${img ? `<img src="${img}" alt="${name}">` : ""}
          <h3>${name}</h3>
          ${meta ? `<p class="meta">${meta}</p>` : ""}
          ${safeDesc ? `<p>${safeDesc}</p>` : ""}
          <p><a class="btn" href="${href}" target="_blank" rel="sponsored noopener">View</a></p>
        </article>`;
      }).join("");

      cards = `<section class="picks">
        <div class="container">
          <h2>Top Picks</h2>
          <div class="grid">${cardHTML}</div>
          <p class="muted">We may earn a commission when you buy via our links.</p>
        </div>
      </section>`;
    }

    const body = `<main class="container">
      <h1>${title}</h1>
      ${desc ? `<p>${desc}</p>` : ""}
    </main>
    ${cards}`;

    // JSON-LD (Article)
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
      jsonld,
      og: {
        type: "article",
        title,
        desc,
        url: `${SITE_URL}/articles/${slug}.html`,
        // use first product image as OG if available, else default
        image: (ids.length && productsMap[ids[0]]?.img) ? productsMap[ids[0]].img : `${SITE_URL}/assets/img/og-default.jpg`
      }
    }));

    published.push({ title, slug });
  }

  // Articles index
  const listHtml = published.length
    ? `<ul class="article-list">${published.map(p => `<li><a href="/articles/${p.slug}.html">${p.title}</a></li>`).join("")}</ul>`
    : `<p>No published articles yet.</p>`;
  await write("articles/index.html", pageLayout({
    title: `${SITE_NAME} Articles`,
    desc: `All ${SITE_NAME} guides and product roundups.`,
    body: `<main class="container"><h1>Articles & Guides</h1>${listHtml}</main>`,
    og: {
      type: "website",
      title: `${SITE_NAME} Articles`,
      desc: `All ${SITE_NAME} guides and product roundups.`,
      url: `${SITE_URL}/articles/`,
      image: `${SITE_URL}/assets/img/og-default.jpg`
    }
  }));

  // Home with Brevo subscribe
  const subscribeBlock = BREVO_FORM_URL
    ? `<section class="subscribe">
         <div class="container">
           <h2>Get our best picks by email</h2>
           <p class="muted">No spam. Just 1–2 top recommendations a month.</p>
           <iframe class="subscribe-iframe" src="${BREVO_FORM_URL}" loading="lazy"></iframe>
         </div>
       </section>`
    : "";

  await write("index.html", pageLayout({
    title: `${SITE_NAME} — The Easiest Way to Choose Car Audio`,
    desc: `Expert, no-fluff car audio picks.`,
    body: `<section class="hero"><div class="container">
             <h1>Upgrade Your Car's Sound—Without Guesswork</h1>
             <p>We compare speakers, subs, amps, and head units across budgets and use-cases. Every pick links to trusted retailers. You buy, we may earn a commission.</p>
             <p><a class="btn" href="/articles/index.html">Browse Top Picks</a></p>
           </div></section>
           ${subscribeBlock}`,
    og: {
      type: "website",
      title: SITE_NAME,
      desc: `Expert, no-fluff car audio picks.`,
      url: SITE_URL,
      image: `${SITE_URL}/assets/img/og-default.jpg`
    }
  }));

  // Basic pages
  const legal = (t,b)=>pageLayout({
    title:`${t} — ${SITE_NAME}`, desc:t,
    body:`<main class="container"><h1>${t}</h1>${b}</main>`,
    og: { type:"website", title:t, desc:t, url:`${SITE_URL}/${t.toLowerCase()}.html`, image:`${SITE_URL}/assets/img/og-default.jpg` }
  });
  await write("about.html",      legal("About", `<p>${SITE_NAME} helps drivers upgrade their sound confidently.</p>`));
  await write("contact.html",    legal("Contact", `<p>Email: <a href="mailto:carsoundhq@gmail.com">carsoundhq@gmail.com</a></p>`));
  await write("disclosure.html", legal("Affiliate Disclosure", `<p>We may earn a commission when you buy through links on our site. As an Amazon Associate we earn from qualifying purchases.</p>`));
  await write("privacy.html",    legal("Privacy Policy", `<p>We use Google Analytics to improve our content.</p>`));
  await write("terms.html",      legal("Terms of Use", `<p>All content is for informational purposes only.</p>`));

  // robots + sitemap
  await write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  const urls = ["/", "/articles/index.html",
    ...published.map(p => `/articles/${p.slug}.html`),
    "/about.html","/contact.html","/disclosure.html","/privacy.html","/terms.html"];
  await write("sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
      urls.map(u => `  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n")
    }\n</urlset>\n`);

  // ---- RSS feed
  const rssItems = published.map(p => {
    const url = `${SITE_URL}/articles/${p.slug}.html`;
    return `<item>
  <title><![CDATA[${p.title}]]></title>
  <link>${url}</link>
  <guid>${url}</guid>
</item>`;
  }).join("\n");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title><![CDATA[${SITE_NAME}]]></title>
  <link>${SITE_URL}</link>
  <description><![CDATA[Latest guides and picks from ${SITE_NAME}.]]></description>
  ${rssItems}
</channel>
</rss>`;
  await write("feed.xml", rss);

  console.log(`Published articles: ${published.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
