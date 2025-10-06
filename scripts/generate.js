// scripts/generate.js
// Notion → static HTML generator for AutoSoundHQ
// Requirements:
//   - package.json: { "type": "module", "scripts": { "build": "node scripts/generate.js" } }
//   - deps: "@notionhq/client"
// Env (GitHub Actions → Secrets): SITE_NAME, SITE_URL, SKIMLINKS_PUB_ID, GA4_MEASUREMENT_ID,
//   AMAZON_TRACKING_ID, NOTION_TOKEN, NOTION_DB_ARTICLES, NOTION_DB_PRODUCTS, NOTION_DB_KEYWORDS

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@notionhq/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Config from env ----------
const SITE_NAME = process.env.SITE_NAME || "AutoSoundHQ";
const SITE_URL = process.env.SITE_URL || "https://autosoundhq.vercel.app";
const SKIM = process.env.SKIMLINKS_PUB_ID || "";
const GA4 = process.env.GA4_MEASUREMENT_ID || "";
const AMAZON_TAG = process.env.AMAZON_TRACKING_ID || "";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ARTICLES = process.env.NOTION_DB_ARTICLES;
const DB_PRODUCTS = process.env.NOTION_DB_PRODUCTS;

// Fail early if required env is missing (visible in Actions logs)
for (const [k, v] of Object.entries({
  NOTION_TOKEN,
  DB_ARTICLES,
  DB_PRODUCTS,
})) {
  if (!v) {
    console.error(`Missing env: ${k}`);
    process.exit(1);
  }
}

const notion = new Client({ auth: NOTION_TOKEN });

const PUB_DIR = path.join(process.cwd(), "public");
const TPL_DIR = path.join(process.cwd(), "templates");

// ---------- Helpers ----------
const ensureDir = async (p) => fsp.mkdir(p, { recursive: true });

const write = async (rel, content) => {
  const full = path.join(PUB_DIR, rel);
  await ensureDir(path.dirname(full));
  await fsp.writeFile(full, content, "utf8");
};

const readTpl = (name, fallback = "") => {
  const p = path.join(TPL_DIR, name);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : fallback;
};

const YEAR = new Date().getFullYear();

const HEAD_FALLBACK = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/assets/img/favicon.ico">
    <link rel="stylesheet" href="/assets/css/styles.css" />
    <meta name="robots" content="index,follow" />
    <title>{{TITLE}}</title>
    <meta name="description" content="{{DESC}}"/>
    <!-- Google Analytics -->
    <script async src="https://www.googletagmanager.com/gtag/js?id={{GA4}}"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','{{GA4}}');</script>
    <!-- Skimlinks -->
    <script type="text/javascript" src="https://s.skimresources.com/js/{{SKIM}}.skimlinks.js"></script>
  </head>
  <body>
`;
const NAV_FALLBACK = `
<header class="site-header">
  <div class="container">
    <a class="logo" href="/"><span>Auto</span>SoundHQ</a>
    <nav>
      <a href="/articles/index.html">Articles</a>
      <a href="/about.html">About</a>
      <a href="/contact.html">Contact</a>
      <a href="/disclosure.html">Affiliate Disclosure</a>
    </nav>
  </div>
</header>
`;
const FOOT_FALLBACK = `
<footer class="site-footer">
  <div class="container">
    <p>© {{YEAR}} ${SITE_NAME}. All rights reserved.</p>
    <p><a href="/privacy.html">Privacy</a> • <a href="/terms.html">Terms</a> • <a href="/sitemap.xml">Sitemap</a></p>
  </div>
</footer>
</body></html>
`;

const layout = ({ title, desc, body }) => {
  const head =
    readTpl("head.html", HEAD_FALLBACK)
      .replace(/{{TITLE}}/g, title)
      .replace(/{{DESC}}/g, desc || "")
      .replace(/{{GA4}}/g, GA4)
      .replace(/{{SKIM}}/g, SKIM);
  const nav = readTpl("nav.html", NAV_FALLBACK);
  const foot = readTpl("footer.html", FOOT_FALLBACK).replace(/{{YEAR}}/g, String(YEAR));
  return head + nav + body + foot;
};

const get = (p) => {
  if (!p) return "";
  if (p.type === "title") return p.title.map((t) => t.plain_text).join("");
  if (p.type === "rich_text") return p.rich_text.map((t) => t.plain_text).join("");
  if (p.type === "select") return p.select ? p.select.name : "";
  if (p.type === "multi_select") return p.multi_select.map((s) => s.name).join(", ");
  if (p.type === "url") return p.url || "";
  if (p.type === "number") return String(p.number ?? "");
  if (p.type === "date") return p.date?.start || "";
  if (p.type === "relation") return p.relation?.map((r) => r.id) || [];
  return "";
};

const slugify = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

// ---------- Notion fetch ----------
async function fetchAll(dbId) {
  const results = [];
  let cursor;
  do {
    const res = await notion.databases.query({ database_id: dbId, start_cursor: cursor });
    results.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

// ---------- Build ----------
async function main() {
  // Ensure /public structure & copy assets if present at repo root
  await ensureDir(path.join(PUB_DIR, "assets/css"));
  await ensureDir(path.join(PUB_DIR, "assets/img"));

  // copy styles.css if exists at repo root
  if (fs.existsSync(path.join(process.cwd(), "styles.css"))) {
    await fsp.copyFile(path.join(process.cwd(), "styles.css"), path.join(PUB_DIR, "assets/css/styles.css"));
  }
  // copy favicon.ico if exists at repo root
  if (fs.existsSync(path.join(process.cwd(), "favicon.ico"))) {
    await fsp.copyFile(path.join(process.cwd(), "favicon.ico"), path.join(PUB_DIR, "assets/img/favicon.ico"));
  }

  // Products map
  const products = await fetchAll(DB_PRODUCTS);
  const pMap = {};
  for (const p of products) {
    const pr = p.properties;
    pMap[p.id] = {
      name: get(pr.name),
      brand: get(pr.brand),
      category: get(pr.category),
      size: get(pr.size),
      rms: get(pr.rms_power),
      imp: get(pr.impedance),
      sens: get(pr.sensitivity_db),
      url: get(pr.url),
      img: get(pr.image_url),
      price: get(pr.price_bucket),
      pros: get(pr.pros),
      cons: get(pr.cons),
    };
  }

  // Articles
  const articles = await fetchAll(DB_ARTICLES);
  const published = [];
  for (const a of articles) {
    const pr = a.properties;
    const status = get(pr.status);
    const title = get(pr.title);
    if (status !== "Published") continue;

    const slug = get(pr.slug) || slugify(title);
    const intro = get(pr.intro);
    const rel = get(pr.products);
    const prods = Array.isArray(rel) ? rel.map((id) => pMap[id]).filter(Boolean) : [];

    let body = `<main class="container"><h1>${title}</h1>`;
    if (intro) body += `<p>${intro}</p>`;

    if (prods.length) {
      body += `<h2>Top Picks</h2><div class="grid">`;
      for (const prd of prods.slice(0, 8)) {
        let link = prd?.url || "#";
        if (AMAZON_TAG && /amazon\./.test(link)) {
          try {
            const u = new URL(link);
            u.searchParams.set("tag", AMAZON_TAG);
            link = u.toString();
          } catch {}
        }
        body += `<article class="card">
          <h3>${prd?.name || "Product"}</h3>
          <p>${[prd?.brand, prd?.size, prd?.rms ? `${prd.rms}W RMS` : "", prd?.imp].filter(Boolean).join(" • ")}</p>
          <p><a href="${link}" target="_blank" rel="sponsored noopener">View</a></p>
          ${prd?.pros ? `<p><small>Pros: ${prd.pros}</small></p>` : ""}
          ${prd?.cons ? `<p><small>Cons: ${prd.cons}</small></p>` : ""}
        </article>`;
      }
      body += `</div>`;
    }

    body += `<hr/><p><em>Disclosure:</em> We may earn a commission when you buy via links on our site.</p></main>`;

    const html = layout({ title: `${title} — ${SITE_NAME}`, desc: intro || "", body });
    await write(`articles/${slug}.html`, html);
    published.push({ title, slug });
  }

  // Articles index
  const list = published.length
    ? published.map((p) => `<li><a href="/articles/${p.slug}.html">${p.title}</a></li>`).join("\n")
    : "<li>No published articles yet.</li>";
  await write(
    "articles/index.html",
    layout({
      title: `${SITE_NAME} Articles`,
      desc: `All ${SITE_NAME} guides and product roundups.`,
      body: `<main class="container"><h1>Articles & Guides</h1><ul>${list}</ul></main>`,
    })
  );

  // Home
  await write(
    "index.html",
    layout({
      title: `${SITE_NAME} — The Easiest Way to Choose Car Audio`,
      desc: `Expert, no-fluff car audio picks.`,
      body: `<section class="hero"><div class="container">
        <h1>Upgrade Your Car's Sound—Without Guesswork</h1>
        <p>We compare speakers, subs, amps, and head units across budgets and use-cases. Every pick links to trusted retailers. You buy, we may earn a commission.</p>
        <p><a class="btn" href="/articles/index.html">Browse Top Picks</a></p>
      </div></section>`,
    })
  );

  // Legal
  const legal = (t, b) =>
    layout({ title: `${t} — ${SITE_NAME}`, desc: t, body: `<main class="container"><h1>${t}</h1>${b}</main>` });
  await write("about.html", legal("About", `<p>${SITE_NAME} helps drivers upgrade their sound with unbiased recommendations.</p>`));
  await write("contact.html", legal("Contact", `<p>Email us at <a href="mailto:carsoundhq@gmail.com">carsoundhq@gmail.com</a>.</p>`));
  await write(
    "disclosure.html",
    legal("Affiliate Disclosure", `<p>We may earn a commission when you buy through links on our site. As an Amazon Associate we earn from qualifying purchases.</p>`)
  );
  await write(
    "privacy.html",
    legal("Privacy Policy", `<p>We use Google Analytics to understand traffic and improve our content. Partners may use cookies to track referrals.</p>`)
  );
  await write("terms.html", legal("Terms of Use", `<p>All content is for informational purposes only. Verify fitment and specifications before purchase.</p>`));

  // robots + sitemap
  await write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  const urls = ["/", "/articles/index.html", ...published.map((p) => `/articles/${p.slug}.html`), "/about.html", "/contact.html", "/disclosure.html", "/privacy.html", "/terms.html"];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n")}
</urlset>
`;
  await write("sitemap.xml", sitemap);

  console.log("Build complete. Files written to /public");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
