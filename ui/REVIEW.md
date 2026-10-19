# UI verification — 19 October 2026

`npm run test:ui` passed **82 of 82 checks** through the official Playwright MCP
server using headless Chrome against the local Docker stack.

All three pages were checked at 1440×1000, 1024×768, 768×1024, 600×960,
430×932, 390×844, 375×812, 360×800, 320×740, and landscape 844×390.
No horizontal overflow or undersized controls were found in the standard page
states. All three pages also passed the 320px check with text enlarged to 200%
and reduced motion enabled.

Axe checks detected no WCAG A/AA violations on the desktop and mobile page
states, the mobile review form, or the rejection dialog. No uncaught JavaScript
errors or failed static asset requests were detected.

The live mobile submission was accepted by the service, delivered to the review
queue, and removed through the rejection confirmation. Fixtures verified
category filters, reveals, copying, loading recovery, rate limits, draft
restoration, custom categories, validation, successful submission, failed
approval recovery, keyboard approval, pause/resume, rejection, and sign-in and
permission errors. Long unbroken content was checked in the browser and review
form. Desktop and fresh mobile screenshots were visually inspected.

The full JSON report and screenshots are in `test-results/ui/` locally. Browser
emulation covers these viewport sizes; physical mobile browsers and Auth0's
hosted sign-in page were not tested. The older `test-flows.js` suite was not run
because it drains all pending submissions before starting.
