# BetLens PWA

A mobile-first Progressive Web App for tracking SportyBet performance.

## Deploy to Vercel (free, 2 minutes)

1. Create a free account at vercel.com
2. Install Vercel CLI: `npm i -g vercel`
3. In this folder run: `vercel`
4. Follow the prompts — your app will be live at `https://betlens.vercel.app` (or similar)

## Deploy to GitHub Pages (also free)

1. Create a GitHub repo
2. Push these files to it
3. Go to Settings → Pages → Source: main branch / root
4. Your app will be at `https://yourusername.github.io/betlens`

## Custom domain (.ng or .com)

- Buy domain from Namecheap or Qservers (for .ng)
- Point it to Vercel in your domain's DNS settings
- Vercel gives you free HTTPS automatically

## How sync works

1. User opens betlens.app on their phone
2. They go to Setup tab and long-press "BetLens Sync" → Add to bookmarks
3. When they want to sync, they open SportyBet in their browser, log in, then tap the bookmark
4. The bookmarklet fetches their bets and redirects to betlens.app with the data
5. Data is saved to their phone's IndexedDB — stays there even offline

## Files

- `index.html` — main app shell + all UI
- `app.js`      — all app logic, stats computation, calendar, sync
- `sw.js`       — service worker (offline support, install to home screen)
- `manifest.json` — PWA metadata (name, icons, colors)

## Icons needed

Add these to the root folder:
- `icon-192.png` — 192x192px app icon
- `icon-512.png` — 512x512px app icon

You can generate them from any image at https://realfavicongenerator.net
