# ShipVerify — frontend

Enterprise dashboard for a **Shipping Document Verification** system: it processes
incoming email, identifies document-comparison requests, compares Shipping
Instructions (SI) against draft Bills of Lading (BL), and surfaces discrepancies
or routes uncertain cases to a human.

This is the frontend only. All data comes from fixtures in `src/lib/`, so there is
no backend, database, or API key to configure.

## Requirements

- Node.js 20 or newer (built and tested on Node 24)
- npm 10 or newer

Check what you have:

```bash
node -v
npm -v
```

## Run it in a terminal

From this `frontend` folder:

```bash
# 1. install dependencies (first time only)
npm install

# 2. start the dev server
npm run dev
```

Then open <http://localhost:3000>.

To use a different port:

```bash
npm run dev -- --port 3100
```

Stop the server with `Ctrl + C`.

### Other commands

```bash
npm run build      # production build
npm start          # serve the production build (run build first)
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

> Do not run `npm run build` while `npm run dev` is running: they share the
> `.next` folder, and the build overwrites the dev bundle, which leaves the page
> rendered but not interactive. Stop the dev server first, or restart it after a
> build.

If the UI ever renders but stops responding to clicks, the dev bundle is stale:

```bash
# stop the dev server, then
rm -rf .next      # PowerShell: Remove-Item .next -Recurse -Force
npm run dev
```

## Pages

| Route     | What it does                                                                  |
| --------- | ----------------------------------------------------------------------------- |
| `/`       | Dashboard: outcome chart, case volume figures, cases needing attention        |
| `/inbox`  | Incoming email with AI classification, attachments, and document previews     |
| `/cases`  | Verification cases: SI vs BL comparison and the discrepancy report            |
| `/review` | Human review queue for cases the engine refused to decide                     |
| `/settings` | Appearance (light/dark), verification rules, mailbox, notifications         |

### Shareable links

State lives in the query string, so a view can be pasted to a colleague:

- `/?period=month` — dashboard for a different range
- `/?cases=mismatch` — dashboard case list filtered
- `/cases?case=1023` — open one case's discrepancy report
- `/cases?result=needs_review` — case list filtered
- `/review?case=1022` — open one human-review case
- `/inbox?email=em-9001` — open one email
- `/inbox?email=em-9007&doc=BL` — open an email and its B/L document preview
- `?theme=dark` / `?theme=light` — set the theme on any page

## Layout

```
frontend/
├─ src/
│  ├─ app/                 routes (App Router) and globals.css design tokens
│  ├─ components/
│  │  ├─ app-shell/        sidebar, header, page heading
│  │  ├─ dashboard/        outcome chart and attention table
│  │  ├─ inbox/            email list, drawer, intake overview
│  │  ├─ cases/            case list and discrepancy report drawer
│  │  ├─ review/           review queue and the human decision screen
│  │  ├─ settings/         settings panels
│  │  ├─ theme/            light/dark provider
│  │  └─ ui/               stat bar, document preview, toasts, menus
│  └─ lib/                 fixtures, status vocabulary, helpers
└─ package.json
```

## Theming

Every colour is a CSS variable defined in `src/app/globals.css`; `.dark` on
`<html>` swaps the values. Components reference semantic names (`surface`, `ink`,
`line`, and the status ramps), so neither theme needs per-component overrides.
