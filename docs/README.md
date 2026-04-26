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
4. Save. The site URL will look like:

   `https://<owner>.github.io/<repository>/`

5. Use that URL in the Chrome Web Store listing (**Privacy policy** field). Reviewers and users can scroll to **Privacy** or open `https://<owner>.github.io/<repository>/#privacy`.

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
