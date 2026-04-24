# MegaLeads docs (GitHub Pages)

This folder is published with **GitHub Pages** so you have a public URL for the **Privacy Policy** (`index.html`).

## Enable Pages

1. Push the `docs/` folder to GitHub (on branch `main`, or your default branch).
2. In the repository: **Settings → Pages**.
3. Under **Build and deployment**:
   - **Source**: *Deploy from a branch*
   - **Branch**: `main` (or your default) · **Folder**: `/docs`
4. Save. After the build finishes (usually under a minute), the site URL will look like:

   `https://<owner>.github.io/<repository>/`

   The privacy policy is the homepage: that same URL loads `docs/index.html`.

5. Put that URL in the Chrome Web Store listing (Privacy policy field).

## Local preview

Open `docs/index.html` in a browser, or run a static server from the repo root:

```bash
npx --yes serve docs -p 3333
```

Then visit `http://localhost:3333`.

## Updating the policy

Edit `docs/index.html` only. Commit and push; Pages updates on the next deployment.
