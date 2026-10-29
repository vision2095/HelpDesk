# LensDesk 2.0 Web Client

The Web Client views include:
- **Marketing Landing Page** (`src/Home.tsx`)
- **Stripe & Payment Checkout Portal** (`src/Account.tsx`)
- **Account & Device Management Portal** (`src/Admin.tsx`)

In production, these React 19 views are bundled via `@lensdesk/ui` (`packages/ui`) into `dist/` and served directly by the cloud backend (`apps/web/server/cloud/app.mjs`).
