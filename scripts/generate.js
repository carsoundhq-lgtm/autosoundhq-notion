// scripts/generate.js
import fs from 'fs';
import path from 'path';
import { Client } from '@notionhq/client';

const SITE_NAME = process.env.SITE_NAME || 'AutoSoundHQ';
const SITE_URL = process.env.SITE_URL || 'https://autosoundhq.vercel.app';
const SKIM = process.env.SKIMLINKS_PUB_ID || '';
const GA4 = process.env.GA4_MEASUREMENT_ID || '';
const AMAZON_TAG = process.env.AMAZON_TRACKING_ID || '';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ARTICLES = process.env.NOTION_DB_ARTICLES;
const DB_PRODUCTS = process.env.NOTION_DB_PRODUCTS;

if (!NOTION_TOKEN || !DB_ARTICLES || !DB_PRODUCTS) {
  console.error('Missing Notion env vars. Required: NOTION_TOKEN, NOTION_DB_ARTICLES, NOTION_DB_PRODUCTS');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

const TPL_DIR = 'templates';
const PUB_DIR = 'public';
const YEAR = new Date().getFullYear();

const readTpl = f => fs.readFileSync(path.join(TPL_DIR, f), 'utf8');

function layout({ title, desc, body }) {
  const head = readTpl('head.html')
    .replace(/{{TITLE}}/g, title)
    .replace(/{{DESC}}/g, desc || '')
    .replace(/{{GA4}}/g, GA4)
    .replace(/{{SKIM}}/g, SKIM);
  const nav = fs.existsSync(path.join(TPL_DIR, 'nav.html')) ? readTpl('nav.html') : '';
  const foot = readTpl('footer.html').replace(/{{YEAR}}/g, YEAR);
  return head + nav + body + foot;
}

async function fetchAll(dbId) {
  const out = [];
  let cursor = undefined;
  do {
    const res = await notion.databases.query({ database_id: dbId, start_cursor: cursor });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

function get(p) {
  if (!p) return '';
  if (p.type === 'title') return p.title.map(t => t.plain_text).join('');
  if (p.type === 'rich_text') return p.rich_text.map(t => t.plain_text).join('');
  if (p.type === 'select') return p.select ? p.select.name : '';
  if (p.type === 'multi_select') return p.multi_select.map(s => s.name).join(', ');
  if (p.type === 'url') return p.url || '';
  if (p.type === 'number') return String(p.number ?? '');
  if (p.type === 'date') return p.date?.start || '';
  if (p.type === 'relation') return p.relation?.map(r => r.id) || [];
  return '';
}

const slugify = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function write(relPath, content) {
  const full = path.join(PUB_DIR, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

async function main() {
  // ensure asset dirs
  fs.mkdirSync(path.join(PUB_DIR, 'assets', 'css'), { recursive: true });
  fs.mkdirSync(path.join(PUB_DIR, 'assets', 'img'), { recursive: true });
  if (fs.existsSync('public/assets/css/styles.css') === false && fs.existsSync('styles.css'))
    fs.copyFileSync('styles.css', path.join(PUB_DIR, 'assets', 'css', 'styles.css'));
  if (fs.existsSync('public/assets/img/favicon.ico') === false && fs.existsSync('favicon.ico'))
    fs.copyFileSync('favicon.ico', path.join(PUB_DIR, 'assets', 'img', 'favicon.ico'));

  // products map
  const products = await fetchAll(DB_PRODUCTS);
  const pmap = {};
  for (const p of products) {
    const pr = p.properties;
    pmap[p.id] = {
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

  // articles
  const articles = await fetchAll(DB_ARTICLES);
  const published = [];
  for (const a of articles) {
    const pr = a.properties;
    const status = get(pr.status);
    const title = get(pr.title);
    if (status !== 'Published') continue;

    const slug = get(pr.slug) || slugify(title);
    const intro = get(pr.intro);
    const rel = get(pr.products);
    const prods = Array.isArray(rel) ? rel.map(id => pmap[id]).filter(Boolean) : [];

    let body = `<main class="container"><h1>${title}</h1>`;
    if (intro) body += `<p>${intro}</p>`;

    if (prods.length) {
      body += `<h2>Top Picks</h2><div class="grid">`;
      for (const prd of prods.slice(0, 8)) {
        let link = prd.url || '#';
        if (AMAZON_TAG && /amazon\./.test(link)) {
          try { const u = new URL(link); u.searchParams.set('tag', AMAZON_TAG); link = u.toString(); } catch {}
        }
        body += `<article class="card">
          <h3>${prd.name || 'Product'}</h3>
          <p>${[prd.brand, prd.size, prd.rms ? `${prd.rms}W RMS` : '', prd.imp].filter(Boolean).join(' • ')}</p>
          <p><a href="${link}" target="_blank" rel="sponsored noopener">View</a></p>
          ${prd.pros ? `<p><small>Pros

