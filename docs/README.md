# MegaLeads site (GitHub Pages)

This folder is published with **GitHub Pages** from **`/docs`**.

`index.html` is a **single page** that includes:

1. **Marketing** — MegaLeadsAI positioning for email list builders, Chrome Web Store CTAs, feature overview, embedded tutorial video, and how-it-works steps.
2. **Privacy policy** — Full MegaLeadsAI privacy policy at the **bottom** of the same document (`#privacy`), suitable for the Chrome Web Store “Privacy policy” URL.

## Enable Pages

1. Push the `docs/` folder to GitHub (on branch `main`, or your default branch).
2. In the repository: **Settings → Pages**.
3. Under **Build and deployment**:
   - **Source**: *Deploy from a branch*
   - **Branch**: `main` (or your default) · **Folder**: `/docs`
4. Save. GitHub gives a default URL like `https://<owner>.github.io/<repository>/`.

5. **Custom domain:** this repo includes `docs/CNAME` with **`megaleads-ai.com`**. In the repo go to **Settings → Pages → Custom domain**, enter `megaleads-ai.com`, save, and add the **DNS A records** (or ALIAS) GitHub shows for an apex domain. After DNS propagates, enable **Enforce HTTPS**.

6. Use **`https://megaleads-ai.com/`** in the Chrome Web Store (**Privacy policy** field). Users can open **`https://megaleads-ai.com/#privacy`** for the policy only.

## Local preview

From the repo root:

```bash
npx --yes serve docs -p 3333
```

Then visit `http://localhost:3333`.

## Updating content

- **Marketing or layout:** edit the top of `docs/index.html`.
- **Privacy only:** edit the `#privacy` section at the bottom of `docs/index.html`.

Commit and push; Pages updates on the next deployment (usually within a minute).
