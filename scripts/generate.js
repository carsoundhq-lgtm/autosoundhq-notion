// scripts/generate.js — AutoSoundHQ generator (Wirecutter UI + GA4 + OG/Twitter + RSS + FTC note + Skimlinks wrap + PDF Guides)
// Node >= 18; package.json: { "type": "module" }

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Client } from "@notionhq/client";

/* ========= ENV ========= */
const SITE_NAME      = process.env.SITE_NAME || "AutoSoundHQ";
const SITE_URL       = process.env.SITE_URL  || "https://autosoundhq.com";
const SKIM_PUB_ID    = process.env.SKIMLINKS_PUB_ID || "";
const GA4            = process.env.GA4_MEASUREMENT_ID || "";
const AMAZON_TAG     = process.env.AMAZON_TRACKING_ID || "autosoundhq-20";
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

// Recursively copy a folder (keeps your assets like PDFs)
async function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  const entries = await fsp.readdir(src, { withFileTypes: true });
  await ensureDir(dest);
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else {
      await fsp.copyFile(s, d);
    }
  }
}

/* ========= HTML shells (GA4 beacon + OG/Twitter) ========= */
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
// gtag('set','debug_mode',true);

// Track affiliate clicks from product buttons
function sendAffiliateEvent(name, href){
  try {
    gtag('event','affiliate_click',{
      event_category:'affiliate',
      event_label:name||href,
      merchant:/amazon\\./i.test(href)?'amazon':(/crutchfield\\./i.test(href)?'crutchfield':'other'),
      product_name:name||'',
      destination:href,
      transport_type:'beacon',
      event_timeout:2000
    });
  } catch(e){}
  try {
    if(navigator.sendBeacon){
      const data=new Blob([], {type:'application/x-www-form-urlencoded'});
      navigator.sendBeacon('https://www.google-analytics.com/g/collect?v=2&tid=${GA4}&en=affiliate_click&dl='+encodeURIComponent(location.href), data);
    }
  } catch(e){}
}
addEventListener('click', function(e){
  const a = e.target.closest('a');
  if(!a) return;
  const cls=(a.getAttribute('class')||'').toLowerCase();
  const rel=(a.getAttribute('rel')||'').toLowerCase();
  const isAffiliate = cls.includes('btn') || rel.includes('sponsored');
  if(!isAffiliate) return;
  const card=a.closest('.card');
  const name=card?(card.querySelector('h3')?.textContent||''):'';
  sendAffiliateEvent(name, a.href||'');
}, true);
</script>` : ""}

${SKIM_PUB_ID ? `<script src="https://s.skimresources.com/js/${SKIM_PUB_ID}.skimlinks.js"></script>` : ""}

{{JSONLD}}
</head><body>`;

const NAV = `<header class="site-header"><div class="container">
  <a class="logo" href="/"><span>Auto</span>SoundHQ</a>
  <nav>
    <a href="/articles/index.html">Articles</a>
    <a href="/guides/index.html">Guides (PDF)</a>
    <a href="/about.html">About</a>
    <a href="/contact.html">Contact</a>
    <a href="/disclosure.html">Affiliate Disclosure</a>
  </nav>
</div></header>`;

const FOOT = `<footer class="site-footer"><div class="container">
  <p>© ${YEAR} ${SITE_NAME}. All rights reserved.</p>
  <p><a href="/privacy.html">Privacy</a> • <a href="/terms.html">Terms</a> • <a href="/sitemap.xml">Sitemap</a></p>
</div></footer></body></html>`;

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

const dateFrom = (props) => {
  const d = textFrom(getByNameCI(props, ["date","published_at","Published"], ["date","rich_text"]));
  return d ? new Date(d) : null;
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
// Amazon → search link with tag (never 404). Crutchfield/Sonic → leave as-is. Others → Skimlinks wrap.
function affiliateURL(name, raw) {
  if (!raw) raw = "";
  const isAmazon = /(^https?:\/\/)?([a-z0-9.-]*\.)?amazon\./i.test(raw) || /amazon/i.test(name);
  const isCrutch = /crutchfield\.com/i.test(raw);
  const isSonic  = /sonicelectronix\.com/i.test(raw);

  if (isAmazon) {
    const q = encodeURIComponent(name || "");
    return `https://www.amazon.com/s?k=${q}&tag=${encodeURIComponent(AMAZON_TAG)}`;
  }
  if (isCrutch || isSonic) return raw;

  if (SKIM_PUB_ID) {
    const enc = encodeURIComponent(raw);
    return `https://go.skimresources.com/?id=${SKIM_PUB_ID}&xs=1&url=${enc}`;
  }
  return raw;
}

/* ========= Guide block injector (more forgiving title matching) ========= */
function normalize(s){ return (s||"").toLowerCase(); }

function guideBlockForTitle(title) {
  const t = normalize(title);

  const guides = [
    {
      match: (s) => /tune.*car.*amp|amp.*tuning/.test(s),
      html: `<div class="guide card" style="margin-block:1.5rem;padding:1rem;border-radius:12px;">
  <div style="display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;justify-content:space-between;">
    <h2 style="margin:0;">Step-by-Step: Tune Your Amp (Beginner)</h2>
    <a href="/assets/guides/amp-tuning.pdf" target="_blank" rel="noopener"
       class="btn" style="padding:.6rem 1rem;border-radius:10px;border:1px solid #555;">Download PDF</a>
  </div>
  <details open style="margin-top:.75rem;">
    <summary style="cursor:pointer;font-weight:600;">Show/Hide quick steps</summary>
    <ol style="margin-top:.5rem;line-height:1.6">
      <li><strong>Prep:</strong> EQ flat, loudness OFF, amp gains fully down.</li>
      <li><strong>Crossovers:</strong> HPF (front/rear) 80 Hz; LPF (sub) 80 Hz. Subsonic: sealed 20 Hz / ported ~3–5 Hz below tuning.</li>
      <li><strong>Set gains:</strong> Play 1 kHz (speakers) / 40 Hz (sub) tone; set head unit ~80% max; raise gain to just before distortion, then back off.</li>
      <li><strong>Fine-tune:</strong> Bass-boost 0–3 dB max; adjust HPF/LPF overlap.</li>
      <li><strong>Balance:</strong> Center vocals; trim sub so it doesn’t mask vocals.</li>
      <li><strong>Quick starts:</strong> HPF 80 Hz • LPF 80 Hz • 12 dB/oct • Vol 75–85%.</li>
    </ol>
  </details>
</div>`
    },
    {
      match: (s) => /install.*car.*amp|amp.*install/.test(s),
      html: `<div class="guide card" style="margin-block:1.5rem;padding:1rem;border-radius:12px;">
  <h2>Install a Car Amp (Quick Start)</h2>
  <a href="/assets/guides/install-amp-quick-start.pdf" target="_blank" rel="noopener">Download PDF</a>
  <ul>
    <li>Disconnect negative battery; mount amp with airflow.</li>
    <li>Battery → fuse (12–18") → power wire → amp. Ground &lt; 18" to bare metal.</li>
    <li>RCAs on opposite side from power; connect REM.</li>
    <li>Power up (protect OFF), set gains to minimum, then follow tuning guide.</li>
  </ul>
</div>`
    },
    {
      match: (s) => /crossover|cross-over|set.*frequency/.test(s),
      html: `<div class="guide card" style="margin-block:1.5rem;padding:1rem;border-radius:12px;">
  <h2>Set Crossover Frequencies (Cheat Sheet)</h2>
  <a href="/assets/guides/crossover-cheat-sheet.pdf" target="_blank" rel="noopener">Download PDF</a>
  <ul>
    <li>HPF (speakers): 80–100 Hz</li>
    <li>LPF (sub): 70–90 Hz</li>
    <li>Subsonic: 20 Hz sealed / 30–35 Hz ported</li>
    <li>12 dB/oct for overlap, 24 dB/oct for tighter handoff</li>
  </ul>
</div>`
    },
    {
      match: (s) => /polarity|phase.*test/.test(s),
      html: `<div class="guide card" style="margin-block:1.5rem;padding:1rem;border-radius:12px;">
  <h2>Speaker Polarity & Phase Test</h2>
  <a href="/assets/guides/speaker-polarity-phase-test.pdf" target="_blank" rel="noopener">Download PDF</a>
  <ul>
    <li>9V battery pop test: cone OUT = correct polarity.</li>
    <li>Polarity track: centered vocals = correct phase.</li>
    <li>Flip sub polarity if bass cancels near crossover.</li>
  </ul>
</div>`
    },
    {
      match: (s) => /noise|whine|ground.*loop/.test(s),
      html: `<div class="guide card" style="margin-block:1.5rem;padding:1rem;border-radius:12px;">
  <h2>Fix Car Audio Noise (Ground Loop / Alternator Whine)</h2>
  <a href="/assets/guides/fix-audio-noise.pdf" target="_blank" rel="noopener">Download PDF</a>
  <ul>
    <li>Separate power and signal runs.</li>
    <li>Ground short to bare metal (&lt; 18").</li>
    <li>Noise with RPM → alternator whine; try new ground point.</li>
  </ul>
</div>`
    },
    {
      match: (s) => /head.*unit|eq|equalizer/.test(s),
      html: `<div class="guide card" style="margin-block:1.5rem;padding:1rem;border-radius:12px;">
  <h2>Head Unit Setup & EQ (Starter)</h2>
  <a href="/assets/guides/head-unit-setup-eq.pdf" target="_blank" rel="noopener">Download PDF</a>
  <ul>
    <li>Turn OFF loudness/surround/enhancers.</li>
    <li>EQ flat; set reference volume to 75–85%.</li>
    <li>Cut harshness first; boost sparingly.</li>
  </ul>
</div>`
    },
    {
      match: (s) => /6\.?5("|-?inch)?|speakers.*buyer|choose.*speakers/.test(s),
      html: `<div class="guide card" style="margin-block:1.5rem;padding:1rem;border-radius:12px;">
  <h2>Choosing 6.5&quot; Car Speakers (Buyer’s Guide)</h2>
  <a href="/assets/guides/choose-6-5-speakers.pdf" target="_blank" rel="noopener">Download PDF</a>
  <ul>
    <li>High sensitivity = louder per watt.</li>
    <li>Match RMS to amp power.</li>
    <li>Coaxial = easy install; Components = better imaging.</li>
  </ul>
</div>`
    }
  ];

  for (const g of guides) {
    if (g.match(t)) return g.html;
  }
  return "";
}

/* ========= MAIN ========= */
async function main() {
  // assets
  await ensureDir(path.join(PUB_DIR, "assets/css"));
  await ensureDir(path.join(PUB_DIR, "assets/img"));

  // Copy core assets if present
  if (fs.existsSync("styles.css"))
    await fsp.copyFile("styles.css", path.join(PUB_DIR, "assets/css/styles.css"));
  if (fs.existsSync("favicon.ico"))
    await fsp.copyFile("favicon.ico", path.join(PUB_DIR, "assets/img/favicon.ico"));
  if (fs.existsSync("og-default.jpg"))
    await fsp.copyFile("og-default.jpg", path.join(PUB_DIR, "assets/img/og-default.jpg"));

  // Copy everything from /assets (e.g., guides/*.pdf)
  if (fs.existsSync("assets")) {
    await copyDir("assets", path.join(PUB_DIR, "assets"));
  }

  // PRODUCTS
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
  }

  // ARTICLES
  const pages = await fetchAll(DB_ARTICLES);
  const published = [];

  for (const page of pages) {
    const props = page.properties || {};
    const title = firstTitle(props);
    const slug  = slugFrom(props);
    const pub   = isPublished(props);
    if (!pub) continue;

    const desc = textFrom(getByNameCI(props, ["description","intro","summary","Description"], ["rich_text","title"]));
    const rel  = getByNameCI(props, ["products","Products"], ["relation"]);
    const ids  = relIds(rel);
    const dateVal = dateFrom(props);
    const dateStr = dateVal ? dateVal.toLocaleDateString(undefined, {year:"numeric",month:"short",day:"2-digit"}) : "";

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
          ${img ? `<div class="thumb"><img loading="lazy" src="${img}" alt="${name}"></div>` : ""}
          <div class="card-body">
            <h3>${name}</h3>
            ${meta ? `<p class="meta">${meta}</p>` : ""}
            ${safeDesc ? `<p class="excerpt">${safeDesc}</p>` : ""}
            <p><a class="btn" href="${href}" target="_blank" rel="sponsored noopener" aria-label="View ${name}">View</a></p>
            <p class="ftc small muted">We may earn a commission at no extra cost to you.</p>
          </div>
        </article>`;
      }).join("");

      cards = `<section class="picks">
        <div class="container">
          <h2>Top Picks</h2>
          <div class="grid cards-3">${cardHTML}</div>
          <p class="muted small">As an Amazon Associate we earn from qualifying purchases.</p>
        </div>
      </section>`;
    }

    // Insert guide block at top (if the title matches)
    const guideBlock = guideBlockForTitle(title);

    const body = `<main class="container article">
      <header class="article-head">
        <h1>${title}</h1>
        ${dateStr ? `<p class="muted small">${dateStr}</p>` : ""}
        ${desc ? `<p class="lead">${desc}</p>` : ""}
      </header>
      ${guideBlock || ""}
    </main>
    ${cards}`;

    const ogImage = (ids.length && productsMap[ids[0]]?.img)
      ? productsMap[ids[0]].img
      : `${SITE_URL}/assets/img/og-default.jpg`;

    const jsonld = `<script type="application/ld+json">${JSON.stringify({
      "@context":"https://schema.org",
      "@type":"Article",
      "headline": title,
      "description": desc || "",
      "mainEntityOfPage": `${SITE_URL}/articles/${slug}.html`,
      "datePublished": dateVal ? dateVal.toISOString() : undefined,
      "publisher": { "@type":"Organization", "name": SITE_NAME }
    })}</script>`;

    await write(`articles/${slug}.html`, pageLayout({
      title: `${title} — ${SITE_NAME}`,
      desc,
      body,
      jsonld,
      og: { type:"article", title, desc, url:`${SITE_URL}/articles/${slug}.html`, image: ogImage }
    }));

    published.push({ title, slug, desc, ogImage, dateStr });
  }

  // Sort newest first
  const publishedSorted = published.slice().reverse();

  // Articles index
  const articleCards = publishedSorted.map(p => `
    <article class="postcard">
      <div class="postcard-body">
        <h2><a href="/articles/${p.slug}.html">${p.title}</a></h2>
        ${p.dateStr ? `<p class="muted small">${p.dateStr}</p>` : ""}
        ${p.desc ? `<p class="excerpt">${p.desc}</p>` : ""}
        <p><a class="btn ghost" href="/articles/${p.slug}.html" aria-label="Read ${p.title}">Read</a></p>
      </div>
    </article>`).join("");

  await write("articles/index.html", pageLayout({
    title: `${SITE_NAME} Articles`,
    desc: `All ${SITE_NAME} guides and product roundups.`,
    body: `<main class="container"><h1>Articles & Guides</h1><div class="postlist">${articleCards}</div></main>`,
    og: { type:"website", title:`${SITE_NAME} Articles`, desc:`All ${SITE_NAME} guides and product roundups.`, url:`${SITE_URL}/articles/`, image:`${SITE_URL}/assets/img/og-default.jpg` }
  }));

  // Home
  const latest3 = publishedSorted.slice(0,3).map(p => `
    <article class="card flat">
      <div class="card-body">
        <h3><a href="/articles/${p.slug}.html">${p.title}</a></h3>
        ${p.desc ? `<p class="excerpt">${p.desc}</p>` : ""}
        <p><a class="btn" href="/articles/${p.slug}.html" aria-label="Read ${p.title}">Read</a></p>
      </div>
    </article>`).join("");

  const subscribeBlock = BREVO_FORM_URL ? `
  <section class="subscribe">
    <div class="container">
      <h2>Get our best picks by email</h2>
      <p class="muted">No spam. Just 1–2 top recommendations a month.</p>
      <iframe class="subscribe-iframe" src="${BREVO_FORM_URL}" loading="lazy"></iframe>
    </div>
  </section>` : "";

  await write("index.html", pageLayout({
    title: `${SITE_NAME} — The Easiest Way to Choose Car Audio`,
    desc: `Expert, no-fluff car audio picks.`,
    body: `<section class="hero"><div class="container">
             <h1>Upgrade Your Car's Sound—Without Guesswork</h1>
             <p>We compare speakers, subs, amps, and head units across budgets and use-cases. Every pick links to trusted retailers. You buy, we may earn a commission.</p>
             <p><a class="btn" href="/articles/index.html">Browse Top Picks</a></p>
           </div></section>
           <section class="highlights"><div class="container">
             <h2>Latest Guides</h2>
             <div class="grid cards-3">${latest3}</div>
           </div></section>
           ${subscribeBlock}`,
    og: { type:"website", title:SITE_NAME, desc:`Expert, no-fluff car audio picks.`, url:SITE_URL, image:`${SITE_URL}/assets/img/og-default.jpg` }
  }));

  // === Guides Index (lists all PDFs found under assets/guides) ===
  let guidesList = "";
  const guidesSrcDir = "assets/guides";
  const guidesPubDir = "/assets/guides";
  if (fs.existsSync(guidesSrcDir)) {
    const files = (await fsp.readdir(guidesSrcDir)).filter(n => /\.pdf$/i.test(n));
    if (files.length) {
      guidesList = files.map(fn => {
        const nice = fn
          .replace(/[_-]+/g, " ")
          .replace(/\.pdf$/i, "")
          .replace(/\b(\w)/g, (m) => m.toUpperCase());
        return `<li><a href="${guidesPubDir}/${fn}" target="_blank" rel="noopener">${nice}</a></li>`;
      }).join("");
    }
  }
  const guidesBody = `<main class="container">
    <h1>Guides (PDF)</h1>
    <p class="muted">Printable quick-start guides and cheat sheets.</p>
    ${guidesList ? `<ul class="guides-list">${guidesList}</ul>` : `<p>No PDF guides found yet.</p>`}
  </main>`;

  await write("guides/index.html", pageLayout({
    title: `Guides (PDF) — ${SITE_NAME}`,
    desc: `Printable quick-start guides and cheat sheets from ${SITE_NAME}.`,
    body: guidesBody,
    og: { type:"website", title:`Guides (PDF) — ${SITE_NAME}`, desc:`Printable quick-start guides and cheat sheets.`, url:`${SITE_URL}/guides/`, image:`${SITE_URL}/assets/img/og-default.jpg` }
  }));

  // Legal pages
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
  const urls = ["/", "/articles/index.html", "/guides/index.html",
    ...publishedSorted.map(p => `/articles/${p.slug}.html`),
    "/about.html","/contact.html","/disclosure.html","/privacy.html","/terms.html"];
  await write("sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
      urls.map(u => `  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n")
    }\n</urlset>\n`);

  // RSS
  const rssItems = publishedSorted.map(p => {
    const url = `${SITE_URL}/articles/${p.slug}.html`;
    return `<item>
  <title><![CDATA[${p.title}]]></title>
  <link>${url}</link>
  <guid>${url}</guid>
</item>`;
  }).join("\n");
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title><![CDATA[${SITE_NAME}]]></title>
  <link>${SITE_URL}</link>
  <description><![CDATA[Latest guides and picks from ${SITE_NAME}.]]></description>
  ${rssItems}
</channel></rss>`;
  await write("feed.xml", rss);

  console.log(`Published articles: ${publishedSorted.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
