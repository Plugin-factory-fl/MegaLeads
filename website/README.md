# MegaLeadsAI marketing site

Single-page static site in this folder: `index.html`, `robots.txt`.

## Deploy on GitHub Pages (recommended)

GitHub’s “Deploy from branch” option only serves from the repo **root** or **`/docs`**, not from **`/website`**. This repo uses **GitHub Actions** to publish **`website/`** as the Pages site root.

1. Push this repo to GitHub (include `.github/workflows/deploy-website.yml`).
2. In the repo on GitHub: **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions** (not “Deploy from a branch”).
4. Open **Actions**, run **Deploy website to GitHub Pages** (it also runs on pushes to `main` or `master` that touch `website/`).
5. After the first successful run, your site will be at `https://<user-or-org>.github.io/<repo>/` (unless you use a custom domain).

### After the site URL is known

In `index.html`, add a canonical URL and Open Graph URL so search and social previews stay consistent:

- Add in `<head>`:  
  `<link rel="canonical" href="https://YOUR_USER.github.io/MegaLeads/">`  
  (replace with your real Pages URL.)
- Add:  
  `<meta property="og:url" content="https://YOUR_USER.github.io/MegaLeads/" />`

Optional: add `sitemap.xml` and reference it from `robots.txt`.

## Local preview

From the repo root:

```bash
cd website && python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Chrome Web Store

Listing used by the CTAs on the page:  
[Chrome Web Store — MegaLeadsAI](https://chromewebstore.google.com/detail/afcakombimmcopmdckjdjffdgnchhbpe?utm_source=item-share-cb)
