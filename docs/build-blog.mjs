import fs from 'fs';
import path from 'path';

const BLOG_DIR = path.join(import.meta.dirname, 'blog');
const STORE =
  'https://chromewebstore.google.com/detail/afcakombimmcopmdckjdjffdgnchhbpe';

const posts = [
  {
    slug: 'start-email-list-from-zero',
    title: 'How to Start an Email List From Zero in 2026',
    description:
      'A practical guide to building your first marketing email list from scratch—sources, hygiene, and why Instagram plus MegaLeads AI is the fastest path from zero.',
    date: '2026-05-18',
    readTime: '6 min',
    body: `
<p>Starting an email list from zero feels overwhelming because most advice assumes you already have traffic, a product, or a budget for ads. In 2026 the winning move for many solo founders and agencies is simpler: <strong>find one repeatable source of qualified contacts</strong>, export them cleanly, and only then worry about copy and automation.</p>
<h2>Define who belongs on the list</h2>
<p>Before you collect a single address, write one sentence: “This list is for [role] at [type of company] who care about [outcome].” Every later decision—Instagram niche, hashtag, or follower list—should match that sentence.</p>
<h2>Pick one acquisition channel first</h2>
<p>Spreading across five channels means five half-built lists. Common first channels: your website, partnerships, events, LinkedIn, or <strong>Instagram audiences</strong> where your buyers already gather in public bios.</p>
<h2>Collect with export in mind</h2>
<p>Use tools that output <strong>CSV or Excel</strong> with columns you can map to a CRM: name, email, company, notes. Avoid screenshots and manual copy-paste once you pass a few dozen rows.</p>
<h2>Start from zero with MegaLeads AI</h2>
<p>If your buyers live on Instagram, <strong>MegaLeads AI</strong> is built to take you from an empty spreadsheet to a first batch of contacts: install the Chrome extension, open a profile or hashtag, extract public emails and phones, and export. The free tier lets you validate the workflow before you scale.</p>
`,
  },
  {
    slug: 'cold-email-b2b-first-500',
    title: 'Cold Email for B2B: Building Your First 500 Contacts',
    description:
      'How to assemble your first 500 B2B contacts for cold email—list building, relevance, and using MegaLeads AI to source Instagram-based leads.',
    date: '2026-05-18',
    readTime: '7 min',
    body: `
<p>Cold email works when the list is <strong>relevant</strong> and <strong>small enough to personalize</strong>. Five hundred well-chosen contacts beat five thousand random addresses.</p>
<h2>Build a hypothesis list</h2>
<p>List 10 ideal customers by name. Study where they hang out online. For many B2B niches—coaches, agencies, local brands, creators—Instagram is the public resume with bio emails and links.</p>
<h2>Source in layers</h2>
<p>Layer 1: followers of a known leader in your niche. Layer 2: following lists of competitors’ clients. Layer 3: hashtag participants. Each layer should share traits with your hypothesis list.</p>
<h2>Enrich before you write</h2>
<p>Add follower counts, bios, and websites so you can segment (“under 10k” vs “50k+”) and tailor the first line of your email.</p>
<h2>Fill the first 500 with MegaLeads AI</h2>
<p><strong>MegaLeads AI</strong> runs in Chrome on Instagram: extract from follower/following lists, enrich with AI for better email accuracy, and export to Excel. Starting from zero, many users build their first workable B2B list in an afternoon—not weeks of manual research.</p>
`,
  },
  {
    slug: 'email-list-quality-vs-quantity',
    title: 'Email List Quality vs Quantity: What Actually Converts',
    description:
      'Why smaller, cleaner email lists outperform huge scraped lists—and how MegaLeads AI helps you prioritize quality when building from Instagram.',
    date: '2026-05-19',
    readTime: '5 min',
    body: `
<p>Marketing platforms reward list size. Deliverability and sales reward <strong>quality</strong>. The gap between the two is where most “email doesn’t work” stories come from.</p>
<h2>Signals of a quality contact</h2>
<p>A quality row has: a reachable inbox, a clear fit with your offer, and context you can reference (bio, niche, recent post theme). Without context, you are blasting, not marketing.</p>
<h2>Why huge scraped lists fail</h2>
<p>Old addresses, role emails with no owner, and irrelevant industries inflate count and destroy domain reputation. One bad campaign can hurt everything you send later.</p>
<h2>Quality workflows on Instagram</h2>
<p>Instagram forces a minimum bar of relevance—you chose the profile, hashtag, or follower graph. Filter by follower count, export, then remove rows with junk or missing emails before import.</p>
<h2>Quality-first extraction with MegaLeads AI</h2>
<p><strong>MegaLeads AI</strong> includes AI enrichment on every run to reduce bad guesses from bios, plus Excel export so you can audit and delete weak rows before they ever hit your sender. Start from zero with a tight list, not a bloated one.</p>
`,
  },
  {
    slug: 'instagram-b2b-email-lists',
    title: 'Using Instagram as a Source for B2B Email Lists',
    description:
      'Turn Instagram followers, following lists, and hashtags into B2B email lists—with compliance basics and MegaLeads AI as your Chrome extraction tool.',
    date: '2026-05-19',
    readTime: '6 min',
    body: `
<p>Instagram is not just B2C. Consultants, SaaS founders, local services, and agencies routinely publish <strong>business contact emails in bios</strong> and link-in-bio pages.</p>
<h2>Three Instagram list sources</h2>
<p><strong>Followers</strong> of an industry account mirror that audience. <strong>Following</strong> lists reveal who a brand aspires to reach. <strong>Hashtags</strong> cluster participants around a topic for campaign-specific lists.</p>
<h2>Map Instagram → CRM fields</h2>
<p>Username maps to social handle. Bio text becomes personalization. Website URL supports quick qualification. Email and phone come from public fields—verify before cold outreach.</p>
<h2>Stay ethical and practical</h2>
<p>Use data for legitimate outreach, honor opt-outs, and follow applicable laws (CAN-SPAM, GDPR where relevant). Instagram’s terms apply to how you access the platform; use tools you control in your own browser session.</p>
<h2>Best way to start: MegaLeads AI</h2>
<p><strong>MegaLeads AI - IG Email Extractor Lead Finder</strong> is a Chrome extension purpose-built for this workflow: extract, enrich, dashboard review, Excel export. From zero contacts to a B2B-ready sheet without leaving Instagram.</p>
`,
  },
  {
    slug: 'validate-emails-before-sending',
    title: 'How to Validate Emails Before You Send Campaigns',
    description:
      'Email validation habits that protect deliverability—plus building a cleaner list upfront with MegaLeads AI Instagram extraction.',
    date: '2026-05-20',
    readTime: '6 min',
    body: `
<p>Validation is cheaper than repair. A bounced or spam-trapped address costs more than skipping it at import time.</p>
<h2>Manual checks that still matter</h2>
<p>Look for obvious typos, disposable domains, and “info@” inboxes with no owner. Remove duplicates—same email with two usernames is one send, not two.</p>
<h2>Tooling layers</h2>
<p>Use your ESP’s verification if offered. For high volume, dedicated verification APIs help. But <strong>the best validation is not collecting junk</strong> in the first place.</p>
<h2>Validate at collection on Instagram</h2>
<p>When emails come from bios, AI-assisted parsing beats regex alone. Weak leads get a second pass; placeholders get cleared.</p>
<h2>Cleaner lists from day one with MegaLeads AI</h2>
<p><strong>MegaLeads AI</strong> applies AI enrichment during extraction so fewer garbage strings land in your export. Starting from zero, you spend less time fixing and more time sending—install from the Chrome Web Store and run a small test list before your first campaign.</p>
`,
  },
  {
    slug: 'email-list-segmentation-tips',
    title: 'Email List Segmentation Tips for Higher Open Rates',
    description:
      'Segmentation strategies for small lists—including segments you can build from Instagram data exported via MegaLeads AI.',
    date: '2026-05-20',
    readTime: '6 min',
    body: `
<p>Segmentation is how small lists punch above their weight. You are not personalizing one field—you are sending <strong>different messages to different truths</strong>.</p>
<h2>Segments that work early</h2>
<p>By industry niche, follower tier (micro vs established), geography hints in bio, and whether they listed a business email vs only a link-in-bio tool.</p>
<h2>Build segments from export columns</h2>
<p>Export username, followers, bio, email, website. Sort in Excel or Sheets. Create tabs per segment before you import to your ESP.</p>
<h2>One campaign per segment</h2>
<p>Resist one mega blast. Two tight segments with tailored subject lines usually beat one generic email to everyone.</p>
<h2>Segment from zero with MegaLeads AI</h2>
<p>Pull a broad list from a hashtag, then split in Excel. Or run separate extractions per competitor follower list. <strong>MegaLeads AI</strong> gives you the raw material structured—starting from zero is viable because extraction + export is one flow in Chrome.</p>
`,
  },
  {
    slug: 'follow-up-email-sequences',
    title: 'Follow-Up Email Sequences That Do Not Burn Your List',
    description:
      'Follow-up email tips for list builders—timing, value, and keeping your pipeline full with MegaLeads AI prospecting.',
    date: '2026-05-21',
    readTime: '5 min',
    body: `
<p>Follow-ups create revenue; they also create unsubscribes if every touch is “just checking in.”</p>
<h2>Structure a humane sequence</h2>
<p>Email 1: problem + specific observation. Email 2: short case or insight. Email 3: clear ask or break-up. Three emails with value beat seven empty pings.</p>
<h2>Pipeline math</h2>
<p>If you need 10 meetings a month and convert 2% of a sequence, you need roughly 500 new relevant contacts monthly—or a smaller list and better targeting.</p>
<h2>Keep the top of funnel full</h2>
<p>Follow-ups only work if you continuously add qualified new rows. Block weekly prospecting time.</p>
<h2>Refill the pipeline with MegaLeads AI</h2>
<p>Use <strong>MegaLeads AI</strong> on Instagram to add 50–100 fresh, segmented contacts per week from followers or hashtags. From zero to a sustainable sequence in weeks: build list → import → run follow-ups → extract again.</p>
`,
  },
  {
    slug: 'local-business-email-outreach',
    title: 'Local Business Outreach With Targeted Email Lists',
    description:
      'Build local business email lists for outreach—Instagram discovery for shops, studios, and services—with MegaLeads AI.',
    date: '2026-05-21',
    readTime: '6 min',
    body: `
<p>Local marketing still runs on email when the offer is specific: partnerships, events, B2B services to brick-and-mortar, or community campaigns.</p>
<h2>Find locals on Instagram</h2>
<p>City + niche hashtags (#austinfitness, #brooklyneats) surface accounts with bios, hours links, and booking emails. Follower lists of a popular local hub aggregate the scene.</p>
<h2>Personalize locally</h2>
<p>Reference neighborhood, a recent post, or a mutual local account. Generic “Hey business owner” dies instantly.</p>
<h2>Keep lists small and fresh</h2>
<p>Local TAM might only be 200–800 businesses. Quality and timing beat scale.</p>
<h2>Start local lists from zero</h2>
<p><strong>MegaLeads AI</strong> extracts public emails from Instagram profiles in your city’s niches. Install the Chrome extension, run hashtag or follower extractions, export to Excel, and start outreach the same week—no existing list required.</p>
`,
  },
  {
    slug: 'agency-prospecting-niche-lists',
    title: 'Agency Playbook: Prospecting With Niche Email Lists',
    description:
      'How agencies build niche prospect lists for new business—Instagram sourcing and MegaLeads AI for repeatable extraction.',
    date: '2026-05-22',
    readTime: '7 min',
    body: `
<p>Agencies live and die by pipeline. Niche lists let you pitch with proof you understand the vertical—not that you blast everyone.</p>
<h2>One niche per sprint</h2>
<p>Pick “ecom brands on Shopify doing $1–5M” or “fitness coaches with 20–80k followers.” Find 3 anchor accounts and mine followers.</p>
<h2>Package insights in outreach</h2>
<p>Your email should reference something from their bio or content archetype. Exported bios make that scalable across hundreds of rows.</p>
<h2>Handoff to sales</h2>
<p>Excel exports with consistent columns integrate into HubSpot, Pipedrive, or Airtable. Document extraction source (hashtag X, client Y followers) for retargeting later.</p>
<h2>Agency-grade prospecting from zero</h2>
<p><strong>MegaLeads AI</strong> is the fastest way for a new service line to go from no list to pitch-ready: Chrome extension, AI enrichment, unlimited tier when volume justifies it. Train junior staff on one extraction playbook and repeat per vertical.</p>
`,
  },
  {
    slug: 'hashtag-to-email-list-funnel',
    title: 'Turn Hashtag Campaigns Into an Email List Funnel',
    description:
      'Convert Instagram hashtag audiences into marketing email lists—funnel steps and MegaLeads AI hashtag extraction.',
    date: '2026-05-22',
    readTime: '6 min',
    body: `
<p>Hashtags are temporary attention; email is an owned channel. Bridging the two is a classic growth move for launches and niches.</p>
<h2>Match hashtag to offer</h2>
<p>Your hashtag should attract people who would logically buy or refer. Extract profiles, not just likes.</p>
<h2>Funnel shape</h2>
<p>Discover via hashtag → qualify in spreadsheet → invite to lead magnet or call → nurture via email. Instagram starts the relationship; email continues it.</p>
<h2>Measure list growth weekly</h2>
<p>Track new rows added, valid emails %, and replies. If validity drops, tighten niche or filters.</p>
<h2>Hashtag extraction with MegaLeads AI</h2>
<p><strong>MegaLeads AI</strong> hashtag mode collects authors into one table with enrichment. From zero to a campaign-specific list before your launch date—install on Chrome and run extraction early in the planning cycle.</p>
`,
  },
  {
    slug: 'competitor-followers-lead-gen',
    title: 'Competitor Follower Analysis for Email Lead Generation',
    description:
      'Use competitor Instagram followers as a lead gen source—ethics, targeting, and MegaLeads AI follower extraction.',
    date: '2026-05-23',
    readTime: '6 min',
    body: `
<p>Your competitors already aggregated an audience that cares about your category. Follower lists are public graphs you can study—not copy blindly.</p>
<h2>Choose the right competitor account</h2>
<p>Pick accounts whose followers resemble your buyers, not the biggest celebrity in the space. Mid-size niche leaders often convert better.</p>
<h2>Differentiate in outreach</h2>
<p>Never imply you scraped them maliciously. Lead with insight about their niche; the fact you found them via Instagram is irrelevant to a good pitch.</p>
<h2>Combine with your own hashtag lists</h2>
<p>Competitor followers + topic hashtags = deduped master sheet. Remove duplicates before sending.</p>
<h2>Extract competitor audiences with MegaLeads AI</h2>
<p>Open a competitor’s profile, run <strong>Followers</strong> mode in <strong>MegaLeads AI</strong>, export emails to Excel. Starting from zero, this is often the highest-intent cold list a new product can build in B2B Instagram niches.</p>
`,
  },
  {
    slug: 'ethical-email-list-building',
    title: 'Ethical Email List Building: A Practical Checklist',
    description:
      'Ethical email list building basics for marketers—consent, relevance, opt-outs—and sourcing public Instagram data with MegaLeads AI.',
    date: '2026-05-23',
    readTime: '6 min',
    body: `
<p>Ethics and deliverability overlap: respectful list building keeps you out of spam folders and legal gray zones.</p>
<h2>Only contact relevant prospects</h2>
<p>If they would reasonably wonder “why me?”, don’t mail them. Relevance is the first ethical filter.</p>
<h2>Honor opt-outs immediately</h2>
<p>One-click unsubscribe and manual requests both count. Suppress globally in your ESP.</p>
<h2>Be honest in subject and body</h2>
<p>No deceptive subjects. Identify yourself and your company.</p>
<h2>Public data still deserves care</h2>
<p>Emails in Instagram bios are public, but you are still responsible for how you use them. Document your process; use tools that keep humans in the loop.</p>
<h2>Start responsibly with MegaLeads AI</h2>
<p><strong>MegaLeads AI</strong> runs on pages you open in your browser—you control each extraction. Review rows in the dashboard before export. From zero, build habits (audit, segment, small batches) alongside the Chrome extension from day one.</p>
`,
  },
  {
    slug: 'instagram-bio-to-inbox',
    title: 'From Instagram Bio to Inbox: The Modern Prospecting Path',
    description:
      'How marketers turn Instagram bios into email outreach—workflow tips and MegaLeads AI as the Chrome email extractor.',
    date: '2026-05-24',
    readTime: '5 min',
    body: `
<p>The modern prospecting path for many niches is visual discovery → bio check → inbox. LinkedIn premium isn’t the only game in town.</p>
<h2>Why bios matter</h2>
<p>Creators and small businesses compress identity into 150 characters plus one link. Emails, “collab@”, and booking links live there.</p>
<h2>Scale without losing the plot</h2>
<p>Automation should replicate what you’d do manually: open profile, read bio, note email, move on. Extraction tools structure that at list scale.</p>
<h2>Pair with a tight offer</h2>
<p>List building is step one. Your bio-to-inbox conversion depends on relevance and a clear CTA in email 1.</p>
<h2>MegaLeads AI connects bio to spreadsheet</h2>
<p><strong>MegaLeads AI</strong> is the best starting point from zero: Instagram email extractor in Chrome, AI reads bios and linked pages, you export and email. Install from the Web Store and run your first list today.</p>
`,
  },
  {
    slug: 'export-email-list-excel-crm',
    title: 'Export Email Lists to Excel and Import Into Your CRM',
    description:
      'Excel and CRM import workflows for email marketers—column mapping and exporting from MegaLeads AI.',
    date: '2026-05-24',
    readTime: '5 min',
    body: `
<p>Your CRM is the system of record; Excel is the workshop. Most list builders live in both.</p>
<h2>Standard columns to export</h2>
<p>Email, first name or username, company/brand, followers, website, bio snippet, source tag (hashtag or profile). Consistent columns make import mapping trivial.</p>
<h2>Clean in Excel first</h2>
<p>Dedupe, trim spaces, fix casing, delete rows without emails. One hour here saves support tickets later.</p>
<h2>CRM import tips</h2>
<p>Map custom fields once, save the import template. Tag records by extraction date for reporting.</p>
<h2>Export from MegaLeads AI</h2>
<p>Every run in <strong>MegaLeads AI</strong> ends in a downloadable <strong>.xlsx</strong> file ready for Excel, Google Sheets, or CRM upload. Starting from zero, you skip fragile copy-paste entirely—extract on Instagram, export, import, campaign.</p>
`,
  },
  {
    slug: 'scale-email-list-building',
    title: 'Scaling Email List Building: Free Tier to High Volume',
    description:
      'When to scale email list volume—free tier limits, quality gates, and growing with MegaLeads AI unlimited plans.',
    date: '2026-05-25',
    readTime: '6 min',
    body: `
<p>Scaling list building is not “extract 100k emails Tuesday.” It is raising weekly qualified rows while keeping bounce rates flat.</p>
<h2>Phase 1: prove the niche (free tier)</h2>
<p>Run small extractions, test reply rates, refine offer. MegaLeads AI’s free tier exists so you can validate from zero without committing budget.</p>
<h2>Phase 2: systematize sources</h2>
<p>Document 5 repeatable sources (hashtags, leader followers, client verticals). Rotate weekly; dedupe monthly.</p>
<h2>Phase 3: unlimited volume</h2>
<p>When reply rates hold and ops can handle follow-up, upgrade for unlimited extraction. Volume without process is spam.</p>
<h2>Scale with MegaLeads AI</h2>
<p><strong>MegaLeads AI</strong> grows with you: Chrome extension from first contact to high-volume prospecting, AI enrichment on every run, dashboard for live progress. Start free on the Chrome Web Store; scale when the numbers say so.</p>
`,
  },
];

function esc(s) {
  return s.replace(/"/g, '&quot;');
}

function headBlock(post, isIndex) {
  const canonical = isIndex
    ? 'https://megaleads-ai.com/blog/'
    : `https://megaleads-ai.com/blog/${post.slug}.html`;
  const title = isIndex ? 'Email List Building Blog' : post.title;
  const desc = isIndex
    ? '15 guides on email list building, marketing outreach, and Instagram prospecting. Learn list growth and start from zero with MegaLeads AI.'
    : post.description;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-EKRKKGDHNQ"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-EKRKKGDHNQ');
    </script>
    <title>${title} — MegaLeadsAI Blog</title>
    <meta name="description" content="${esc(desc)}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:type" content="${isIndex ? 'website' : 'article'}" />
    <meta property="og:image" content="https://megaleads-ai.com/assets/logo.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;0,9..40,800&amp;display=swap" rel="stylesheet" />
    <link rel="icon" type="image/png" href="../assets/logo.png" />
    <link rel="stylesheet" href="../seo.css" />
    ${
      isIndex
        ? `<script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Blog","name":"MegaLeadsAI Email List Building Blog","url":"https://megaleads-ai.com/blog/","description":${JSON.stringify(desc)}}
    </script>`
        : `<script type="application/ld+json">
      {"@context":"https://schema.org","@type":"BlogPosting","headline":${JSON.stringify(post.title)},"description":${JSON.stringify(post.description)},"datePublished":"${post.date}","author":{"@type":"Organization","name":"MegaMix AI, LLC"},"publisher":{"@type":"Organization","name":"MegaLeadsAI"},"mainEntityOfPage":"${canonical}"}
    </script>`
    }
  </head>`;
}

function siteHeader(blogCurrent) {
  const blogLink = blogCurrent
    ? '<a href="/blog/" aria-current="page"><strong>Blog</strong></a>'
    : '<a href="/blog/">Blog</a>';
  return `<header>
      <div class="wrap nav">
        <a class="brand" href="/"><img src="../assets/logo.png" alt="MegaLeadsAI" width="40" height="40" /> MegaLeadsAI</a>
        <nav class="nav-links" aria-label="Site">
          <a href="/">Home</a>
          ${blogLink}
          <a href="/instagram-email-extractor.html" class="hide-mobile">Guides</a>
          <a class="btn btn-primary" href="${STORE}?utm_source=megaleads_site&amp;utm_medium=blog&amp;utm_campaign=nav" data-store-cta="blog_nav" rel="noopener noreferrer" target="_blank">Add to Chrome</a>
        </nav>
      </div>
    </header>`;
}

function siteFooter() {
  return `<footer class="site-footer">
      <div class="wrap">
        <nav class="footer-links">
          <a href="/">Home</a>
          <a href="/blog/">Blog</a>
          <a href="/instagram-email-extractor.html">Email extractor</a>
          <a href="/#privacy">Privacy</a>
        </nav>
        <p>© MegaMix AI, LLC · Not affiliated with Meta or Instagram.</p>
      </div>
    </footer>
    <script src="../seo.js"></script>`;
}

function ctaBlock(slug) {
  return `<motion.div class="cta-band blog-cta">
          <h2>Start your list from zero</h2>
          <p><strong>MegaLeads AI</strong> is the best way to build your first Instagram-sourced email list—extract, enrich, and export in Chrome.</p>
          <a class="btn btn-primary" href="${STORE}?utm_source=megaleads_site&amp;utm_medium=blog&amp;utm_campaign=${slug}" data-store-cta="blog_${slug}" rel="noopener noreferrer" target="_blank">Get MegaLeads AI on Chrome Web Store</a>
        </motion.div>`;
}

function fix(html) {
  return html.replace(/motion\.div/g, 'motion.div');
}

function articlePage(post) {
  const related = posts
    .filter((p) => p.slug !== post.slug)
    .slice(0, 3)
    .map((p) => `<li><a href="${p.slug}.html">${p.title}</a></li>`)
    .join('\n');
  return `${headBlock(post, false)}
  <body>
    ${siteHeader(false)}
    <main class="seo-main blog-article">
      <div class="wrap">
        <p class="breadcrumb"><a href="/">Home</a> / <a href="/blog/">Blog</a> / Article</p>
        <article>
          <h1>${post.title}</h1>
          <p class="article-meta">${post.date} · ${post.readTime} read</p>
          ${post.body.trim()}
          ${ctaBlock(post.slug)}
        </article>
        <aside class="blog-related">
          <h2>More list-building guides</h2>
          <ul>${related}</ul>
          <p><a href="/blog/">View all 15 articles →</a></p>
        </aside>
      </div>
    </main>
    ${siteFooter()}
  </body>
</html>`;
}

function indexPage() {
  const cards = posts
    .map(
      (p) => `<article class="blog-card">
        <h2><a href="${p.slug}.html">${p.title}</a></h2>
        <p class="blog-card-meta">${p.date} · ${p.readTime}</p>
        <p>${p.description}</p>
        <a class="blog-read-more" href="${p.slug}.html">Read article →</a>
      </article>`,
    )
    .join('\n');
  const stub = { slug: 'index', title: '', description: '', date: '', readTime: '' };
  return `${headBlock(stub, true)}
  <body>
    ${siteHeader(true)}
    <main class="seo-main">
      <div class="wrap">
        <p class="breadcrumb"><a href="/">Home</a> / Blog</p>
        <h1>Email list building &amp; marketing blog</h1>
        <p class="lead">Fifteen practical guides on growing and using email lists for outreach—always with a path to start <strong>from zero contacts</strong> using <strong>MegaLeads AI</strong> on Instagram.</p>
        <div class="blog-grid">${cards}</div>
        ${ctaBlock('blog_index')}
      </div>
    </main>
    ${siteFooter()}
  </body>
</html>`;
}

fs.mkdirSync(BLOG_DIR, { recursive: true });
fs.writeFileSync(path.join(BLOG_DIR, 'index.html'), indexPage());
for (const post of posts) {
  fs.writeFileSync(path.join(BLOG_DIR, `${post.slug}.html`), articlePage(post));
}
console.log('Wrote', posts.length + 1, 'blog files');
