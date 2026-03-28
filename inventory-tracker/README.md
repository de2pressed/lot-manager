# Raptile Studio Inventory Tracker

This app is a standalone browser-based operations dashboard for Raptile Studio. It tracks inventory purchases, sales, profit analytics, and full action history, while syncing the Shopify product catalogue for faster item entry.

## Launch

1. Open this folder.
2. Double-click `start.bat`.
3. The app opens as a normal Chrome tab.

## Shopify Product Sync

- The app syncs from:
  - `https://raptilestudio.myshopify.com/products.json?limit=250`
- On first run, it auto-attempts sync and caches products in `localStorage`.
- You can manually re-sync with **Sync Products** in the header.
- If direct fetch fails, the app tries a JSONP fallback. Shopify `/products.json` does not natively support JSONP, so this fallback may still fail depending on browser CORS behavior.

### Dev Launch for CORS Troubleshooting

If product sync is blocked by CORS in `file://` mode, use:

- `start_dev.bat` (launches Chrome with disabled web security for local testing only).

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `N` | Open product picker / add flow |
| `Esc` | Close open modal |

## Backup & Restore

- **Export Backup** downloads full app state JSON (`raptile-backup-YYYY-MM-DD.json`).
- **Import Backup** restores from a backup JSON file (with overwrite confirmation).
- **Export CSV** downloads sales data CSV.

## Data Storage

- All data is stored in browser `localStorage` under key:
  - `raptile_inventory_v1`
- The app saves immediately on every state mutation.
- Footer shows `Last saved: ... ago`.

## Troubleshooting

- **Sync not working**: try `start_dev.bat` and then click **Sync Products** again.
- **Data not saving**: browser storage may be blocked/full. Use **Export Backup** to preserve data immediately.
