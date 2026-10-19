# JokePlatform UI

The three independently deployed frontends share the assets in this directory.
After changing shared styles, icons, typography, or browser helpers, run:

```sh
npm run sync:ui
docker compose up -d --build joke-service submit-service moderate-service
docker compose restart kong
```

Commit the synchronized files in each service's `public/` directory with the
source changes. Each Docker image builds from its own service directory, so
it must contain its own copy. The sync command needs only Node.js.

The visual direction applies the UI/UX Pro Max skill from
[nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill):
clear card hierarchy, mobile-first layouts, 44px touch targets, visible keyboard
focus, linked form errors, adequate contrast, and reduced-motion support.
The product uses a warm editorial interpretation: cream surfaces, terracotta
actions, dark olive text, and a self-hosted variable DM Sans font. Semantic
tokens live in `styles.css`; the font's SIL Open Font License is included.

Browse has category filters, user-controlled punchline reveals, copy actions,
loading and empty states, connection errors, and a rate-limit countdown. Submit
has inline validation, a linked error summary, a live preview, local draft
recovery, custom categories, and a dedicated success state. Moderation retains
edits on failed requests, supports pause/resume, provides keyboard shortcuts,
confirms rejection, and distinguishes sign-in and permission errors.

Navigation switches to a bottom bar below 768px. Grids expand at 600px, 768px,
and 1024px. Controls wrap when text is enlarged, inputs keep a 16px base size,
and bottom content accounts for mobile safe areas. The current theme is light;
it remains explicit when the device requests a dark theme.

## Browser verification

With the Docker stack running and Google Chrome installed:

```sh
npm ci
npm run test:ui
```

Override `UI_BASE_URL` for another local gateway, or `UI_BROWSER_PATH` for a
Chrome executable outside its standard location. The suite launches the official
Playwright MCP server through its MCP SDK client. Reports and screenshots go
to the ignored `test-results/ui/` directory.

The suite checks ten viewport sizes from 320px to 1440px, landscape, 200% text,
reduced motion, keyboard navigation, and axe WCAG A/AA checks. It uses real
services for the initial layout checks. If the review queue is empty, it submits
one identifiable joke and rejects only that test submission through the UI.
When the queue already contains a submission, it skips this live mutation.
Failure, rate-limit, approval, draft, and authentication scenarios use intercepted
API responses so existing jokes are preserved. Auth0's hosted sign-in flow and
physical-device browsers are outside this local suite.
