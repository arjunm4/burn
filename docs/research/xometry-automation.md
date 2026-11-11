# Research: automating Xometry with a server-side headless browser

Date: 2026-11-10. Web research plus direct fetches of xometry.com (homepage, robots.txt, legal pages, the quoting app shell and its JS bundle, and the login redirect chain) made with curl on that date. Nothing was done while logged in; no Xometry account was used.

Labels: **[V]** verified from an official source (Xometry, Auth0, or the vendor's own docs/pricing page, including my direct fetches of xometry.com). **[R]** reported by a third party (benchmarks run by competing vendors, law-firm blogs, press). **[I]** inference. "Not found" means searched and not found, not proof of absence. Not legal advice.

Related: [`vendor-apis.md`](vendor-apis.md) (route 5, "server-side bot driving vendor sites", was rejected there; this file reopens it with evidence), [`ramp-integration.md`](ramp-integration.md).

## Bottom line

- **X1 Terms: not allowed as written.** Xometry's Customer Service Agreement (updated 2026-07-28) forbids using "any manual or automated software devices … robots, scrapers … to 'scrape' or download data from any web pages" (§7.1.2) and sharing account access "to another person" (§7.1.7). It also forbids circumventing security (§7.1.10). Quoting and ordering by bot isn't named, but reading back price tiers by bot is close to the §7.1.2 wording. robots.txt disallows `/quoting/`, `/checkout/`, `/orders/` and `/login*`. **No official buyer API exists.** The legitimate programmatic paths are cXML **punchout** (enterprise, via a Xometry rep) and the CAD add-ins (interactive only). **Get written permission from Xometry before production.**
- **X5 Account: workable.** Use a dedicated user in the customer's Teamspace. Any team member can open a shared quote and check out. Login is Auth0, with optional email-OTP MFA and Auth0 Bot Detection on the login page. Payment is credit card or PO (PO needs approved credit terms). **Xometry guarantees quoted prices for 30 days.** Not found: whether a card can be entered fresh for each order, and how long a session lasts.
- **X6 Bot protection: light on browsing, real on login.** Cloudflare sits in front, but plain curl got HTTP 200 on every public page I fetched, with no JavaScript challenge. The login page loads Auth0 Bot Detection ("Auth Challenge", which is Cloudflare Turnstile underneath). No PerimeterX, DataDome, Akamai, reCAPTCHA or hCaptcha scripts were found. The quote app is a React 17 SPA using GraphQL, and CAD upload uses react-dropzone (a hidden `<input type=file>`), so Playwright's `setInputFiles` should work **[I]**.
- **B7 Runtime.** **Hackathon:** local Playwright on the demo laptop, with a persistent Chrome profile logged in once by hand, plus Playwright trace and video for the audit trail. **Production:** Browserbase (persistent Contexts, 30-day HLS replays, live view, Stagehand, Web Bot Auth identity, and Ramp's own vendor), with Kernel as runner-up. Use plain Playwright for deterministic steps and Stagehand `extract()` and `act()` only where the DOM is unstable. Never let an LLM click "Place order".
- **Biggest risk:** Xometry can terminate the account at will (§11.3), and orders **cannot be cancelled** once placed (§3.1). Also, *Amazon v. Perplexity* (preliminary injunction, March 2026) held that a user's permission is not the site's authorization.

## X1. Do Xometry's terms allow automated quoting and checkout?

### Which documents apply

| Document | Where | Applies to |
|---|---|---|
| **Customer Service Agreement**, "Last Updated: July 28, 2026" | [xometry.com/service-agreement](https://www.xometry.com/service-agreement/) | Buyers: website use, orders, payment. It is the controlling document |
| **General Terms and Conditions** (Site Terms of Use), "Last Updated: April 4th, 2017" | [PDF linked from /legal](https://xometry-marketing.cdn.prismic.io/xometry-marketing/895c7155-a7e9-4299-bc0a-26f78a02223d_Terms+%26+Conditions+04_04_2017.pdf) | All site visitors; the Service Agreement controls on conflict |
| Index of all legal docs | [xometry.com/legal](https://www.xometry.com/legal/) | — |

`/terms-of-use`, `/terms-and-conditions`, `/terms-of-service` and `/privacy` all return 404 **[V, fetched]**. The privacy policy is at `/privacy-policy/`.

### Relevant clauses (quoted) [V]

From the Customer Service Agreement ([source](https://www.xometry.com/service-agreement/)):

- **§7.1 License:** "a limited, revocable, non-exclusive license to use the Website for your personal or internal business purposes … You shall not or permit any third party to:"
  - **§7.1.1** "reverse engineer, disassemble or decompile the Website, the pricing and matching algorithms of Xometry, or Xometry's geometry parsing engine;"
  - **§7.1.2** "use any manual or automated software devices or other processes (including but not limited to spiders, robots, scrapers, crawlers, avatars, data mining tools or the like) to 'scrape' or download data from any web pages contained in the Website;"
  - **§7.1.3** "access the Website in order to build a similar or competitive website, application or service;"
  - **§7.1.7** "Share, transfer or otherwise provide access to an account designated for You to another person;"
  - **§7.1.9** "Disable, overly burden, impair, or otherwise interfere with servers …"
  - **§7.1.10** "Gain unauthorized access … or otherwise circumvent or violate the security of the Website, including … attempting to breach or breaching Website security or authentication measures"
- **§2 Registration:** "You may not share Your Account or password with anyone, and You agree to … (b) exit from Your Account at the end of each session." A persisted bot session is in tension with (b).
- **§1.2.4:** the customer must "Monitor and control all activity conducted through Your Account."
- **§3.1:** "SINCE EACH ORDER IS CUSTOM MANUFACTURED, YOU MAY NOT CANCEL AN ORDER ONCE IT HAS BEEN PLACED UNLESS OTHERWISE AGREED TO BY XOMETRY."
- **§11.3 Termination:** "Xometry has the right to, immediately and without notice, suspend or terminate this Agreement or Your use of the Website and Services (with or without cause)."
- After §7.1: attempting to reverse-engineer the pricing algorithms means "Your right to use the Website and Service shall immediately cease." Systematically harvesting price tiers across many configurations could be read that way **[I]**.

From the 2017 General Terms ([PDF](https://xometry-marketing.cdn.prismic.io/xometry-marketing/895c7155-a7e9-4299-bc0a-26f78a02223d_Terms+%26+Conditions+04_04_2017.pdf)):

- §1 and §3: "Accessing the Site, in any manner, whether automated or otherwise constitutes use of the Site and your agreement to be bound by these Terms of Use." So automated access is contemplated, and it is bound by the terms.
- §5: "You agree not to access the Service by any means other than through the interface Xometry provides via the Site."
- §8C Community Rules: you will not "Use automated means, including spiders, robots, crawlers, data mining tools, or the like to download data from our Site. Exception is made for Internet search engines (e.g., Google) and non-commercial public archives (e.g., archive.org)."

### Reading [I]

- Nothing says "no automated ordering", but nothing grants it either. §7.1.2 bans automated tools that "scrape or download data". A bot that reads back price and lead-time tiers is doing that on any plain reading.
- Arguments the other way: the browser drives Xometry's own interface (§5), at human pace, on the customer's own quotes, for "internal business purposes" (§7.1).
- §7.1.7 matters for Burn's architecture. If Burn (a third party) operates the customer's account from Burn's servers, that is arguably "provid[ing] access to an account … to another person". Mitigations: a dedicated Xometry user owned by the customer, created for the agent, plus a written OK from Xometry.
- §7.1.10 rules out CAPTCHA-solving or stealth tactics to get past the login's bot detection.

### robots.txt [V, fetched 2026-11-10]

[xometry.com/robots.txt](https://www.xometry.com/robots.txt):

```
User-agent: *
Allow: /
Disallow: /suppliers/search
Disallow: /pay/
Disallow: /erp/
Disallow: /login*
Disallow: /checkout/
Disallow: /orders/
Disallow: /rfq-responses/
Disallow: /quoting/
Allow: /quoting/home
```

robots.txt governs crawlers, not logged-in user agents, and isn't a contract. Still, every path Burn needs (`/quoting/`, `/checkout/`, `/orders/`, `/login`) is disallowed, which signals intent **[I]**.

### Legal precedent (brief, not legal advice)

| Case | Holding relevant to Burn | Source |
|---|---|---|
| *Van Buren v. US* (S. Ct. 2021) | "Exceeds authorized access" under the CFAA is a gates-up-or-down test, not a purpose-or-policy test. Narrows CFAA exposure for ToS-only violations | [Cooley](https://www.cooley.com/news/insight/2021/2021-06-09-us-supreme-court-computer-fraud-abuse-act-van-buren) [R] |
| *hiQ v. LinkedIn* (N.D. Cal. Nov 2022, settled Dec 2022) | Scraping public data likely isn't a CFAA violation, but hiQ **breached LinkedIn's User Agreement**, and a $500k judgment was entered on contract and CFAA claims | [Proskauer](https://newmedialaw.proskauer.com/2022/11/11/court-finds-hiq-breached-linkedins-terms-prohibiting-scraping-but-in-mixed-ruling-declines-to-grant-summary-judgment-to-either-party-as-to-certain-key-issues/), [privacyworld](https://www.privacyworld.blog/2022/12/linkedins-data-scraping-battle-with-hiq-labs-ends-with-proposed-judgment/) [R] |
| *Meta v. Bright Data* (N.D. Cal. Jan 2024) | Terms bound logged-in use, not logged-off public scraping. Burn is **logged in**, so the contract applies | [Farella Braun](https://www.fbm.com/raven-quesenberry/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/) [R] |
| *Amazon v. Perplexity* (N.D. Cal., PI granted 2026-03-09, on appeal) | A shopping agent acting "with the Amazon user's permission, but without authorization by Amazon" was enjoined under the CFAA and California's computer-fraud statute. Disguising agent traffic as Chrome and evading Amazon's block weighed heavily | [GeekWire](https://geekwire.com/2026/judge-blocks-perplexitys-ai-bot-from-shopping-on-amazon-in-early-test-of-agentic-commerce/), [The Fashion Law](https://www.thefashionlaw.com/court-blocks-perplexity-from-accessing-amazon-systems-in-agentic-ai-lawsuit/) [R] |

Takeaways **[I]**:

- The realistic exposure is contract breach and account termination, not criminal liability.
- CFAA risk rises sharply if Xometry objects or blocks Burn and Burn keeps going, or if Burn disguises the agent.
- An identified agent (Web Bot Auth, see B7) plus written permission is the defensible posture.

### Precedent: agents buying on vendor sites

- **Ramp × Browserbase** (case study, 2026-05-21): Ramp's procurement agent "opens a Browserbase session, and works through the vendor's site", including behind logins. Browserbase emphasises "Agent Identity" with Web Bot Auth "rather than disguising traffic". [browserbase.com/blog/case-study-ramp](https://www.browserbase.com/blog/case-study-ramp) [V, vendor blog]
- **agents.ramp.com** publishes agent skills, including virtual-card "Agent Card Checkout" and vendor-specific buy skills (e.g. Amazon, GitHub, Apple). [agents.ramp.com/llms.txt](https://agents.ramp.com/llms.txt) [V]. None found for Xometry.
- No public report found of anyone automating Xometry quoting or checkout. The only "Xometry scraper" found scrapes public marketing pages. [Apify](https://apify.com/lentic_clockss/xometry-scraper) [R]

### Official integrations (the legitimate paths)

| Path | Programmatic quote? | Programmatic order? | Notes |
|---|---|---|---|
| **developer.xometry.com** | No | No | Supplier-side only: Jobs, Line Items, Job Media, Offers. [developer.xometry.com](https://developer.xometry.com/) [V] |
| **CAD add-ins** (SolidWorks 2022+, Fusion, Onshape, Inventor) | Interactive in-CAD instant quotes | No: "click on a link that will take you to a secure checkout page in the Xometry Instant Quoting Engine" | Add-ins "do not currently support MFA". [cad-add-ins](https://www.xometry.com/cad-add-ins/), [MFA KB](https://community.xometry.com/kb/articles/848) [V] |
| **cXML PunchOut** | Yes, inside the buyer's e-procurement system | PO and electronic invoice automation | Coupa, Ariba, SAP, MS Dynamics; "Can be set up in days. Simply reach out to your Xometry rep." [punchout](https://www.xometry.com/xometry-enterprise/xometry-integration-punchout/) [V] |
| **Ramp Punchouts** | — | — | Ramp's Procurement add-on supports punchouts to Amazon Business, CDW and Staples. Xometry is not listed, but there is a "Request new vendor" button. [support.ramp.com](https://support.ramp.com/punchouts-in-ramp) [V] |
| MCP server / buyer agent API | — | — | None found. [supergood.ai](https://supergood.ai/api-report-card/xometry) [R] |

**Ramp punchout + Xometry cXML is the cleanest long-term path [I].** Both sides already speak punchout. Requesting Xometry as a Ramp punchout vendor is worth doing in parallel.

## X5. Account, login, payment, quote validity

### Accounts and Teamspace [V]

- **Roles:** Admin and Contributor. The creator is Admin, and invitees join as Contributors. Admins invite and remove members, set roles, and deactivate teams. [KB 804](https://community.xometry.com/kb/articles/804-xometry-teamspace)
- **Sharing:** quotes are shared to a team, or created from the team dashboard. "Engineers can easily share quotes, and buyers can seamlessly access them to place orders." [Teamspace](https://www.xometry.com/teamspace/)
- **Who can check out:** "To purchase a quote, click on the Quote ID link … confirm the T&Cs and continue to checkout." [KB 821](https://community.xometry.com/kb/articles/821-what-steps-are-involved-in-the-checkout-process-for-a-quote-within-teamspace). **No dedicated "purchaser" role found.** Any member appears able to check out a shared quote.
- **Visibility is all-or-nothing:** every team member sees everything shared, and "any team members can delete quotes that you've shared with that team." [KB 822](https://community.xometry.com/kb/articles/822-can-anyone-on-my-team-delete-a-quote-that-i-ve-shared-with-that-team-or-that-i-ve-created-directly-from-my-team-dashboard), [KB 823](https://community.xometry.com/kb/articles/823-is-there-a-way-to-restrict-the-visibility-of-certain-quotes-or-orders-within-a-team-to-specific-members)
- **Invites:** Admins can invite any email, with no domain restriction. [Teamspace category](https://community.xometry.com/kb/categories/261-teamspace)
- **Email share:** a quote can also be shared by email. The recipient gets a link to "View Quote and Check Out" and can place the order. [KB 685](https://community.xometry.com/kb/articles/685-can-i-share-my-quote-with-a-colleague-or-purchaser). The quote app bundle also contains a `FORWARD_TO_PURCHASER_MODAL` [V, fetched bundle].
- **Saved quotes:** quotes are auto-saved for registered users. [KB 684](https://community.xometry.com/kb/articles/684-how-do-i-save-a-quote)
- **Upload limit:** 100 MB per file; assemblies must be uploaded as individual parts. [KB 688](https://community.xometry.com/kb/articles/688-why-wont-my-file-upload-to-the-instant-quoting-site)

**Recommended setup [I]:** the customer creates a Xometry user such as `burn-agent@customer.com` and adds it to their Teamspace as a Contributor. The engineer's quote is shared to the team, and the agent checks it out. This keeps every action in the customer's audit trail (the Teamspace Event Log). It still doesn't resolve §7.1.7 if Burn's servers operate the account; written permission does.

### Login [V unless marked]

- **Identity provider:** Auth0 Universal Login.
  - Fetched chain: `www.xometry.com/login/` redirects to `login.xometry.com/authorize?…scope=openid email profile offline_access…`, then to `/u/login/identifier` (identifier-first), with response header `x-auth0-requestid` **[V, fetched]**.
  - Okta's case study confirms that Auth0 handles Xometry's customer identities and that its Attack Protection (brute-force) is in use. [okta.com/customers/xometry](https://www.okta.com/customers/xometry/)
- **CAPTCHA:** the login form carries `data-captcha-provider="auth0_v2"` with a Turnstile-format site key and a hidden `captcha` field **[V, fetched]**.
  - That is Auth0 Bot Detection's "Auth Challenge" (Turnstile underneath).
  - It can be configured as Never, When Risky or Always, and triggers on IPs "likely … part of a credential stuffing attack". [Auth0 Bot Detection](https://auth0.com/docs/secure/attack-protection/bot-detection.md)
  - Xometry's setting is unknown. A curl fetch from a residential IP was not challenged at the identifier step.
- **SSO and social login:** "Continue with Google" is on the login page **[V, fetched]**. No enterprise SSO (SAML) found for buyers.
- **MFA:** optional and **email-OTP only**. It is enabled in Account Settings, a code can be resent only every 5 minutes, and "Currently, Xometry only supports email-based MFA." [KB 848](https://community.xometry.com/kb/articles/848-how-to-enable-multi-factor-authentication-mfa). If enabled on the agent user, every fresh login needs a mailbox the agent can read.
- **Magic links:** none found.
- **Session persistence: not found.** The `offline_access` scope means refresh tokens are issued, so sessions are probably long-lived **[I]**. The quote bundle contains "Your session has expired. Log in again" **[V, fetched bundle]**. The real lifetime is set by Xometry's Auth0 tenant; measure it with the test account.
- **Persisting cookies:** the site sets first-party cookies such as `x-session-id`, plus an `x-device-info` cookie that records `"isBot":false,"botClassificationSource":"ua"` **[V, fetched headers]**. Keep the browser's user-data dir (a persistent context or profile), not just exported cookies, so the Auth0 cookies on `login.xometry.com` survive **[I]**.

### Payment [V unless marked]

- **Methods:**
  - Credit card (Visa, MasterCard or "any other issuer accepted by us") or PO. [Service Agreement §4.1](https://www.xometry.com/service-agreement/)
  - PO requires a **billing contact** and an approved online credit application. "After credit terms have been approved, the 'Purchase Order' payment method will become available during checkout." [KB 649](https://community.xometry.com/kb/articles/649), [KB 648](https://community.xometry.com/kb/articles/648-what-is-a-billing-contact)
  - Billing contacts "can be shared with your colleagues."
  - No PayPal. [KB 696](https://community.xometry.com/kb/articles/696-do-you-accept-paypal)
  - The bundle's payment-method enum is `CREDIT_CARD | PURCHASE_ORDER | BUY_NOW_PAY_LATER | NO_PAYMENT` **[V, fetched bundle]**.
- **Card on file and later charges:** "By providing Xometry with Your credit card number … Xometry is authorized to immediately invoice your Account and charge your credit card for all fees and charges due … no additional consent or notice is required." [§4.1](https://www.xometry.com/service-agreement/). Spec changes can bring "additional compensation" (§3.4). A **single-use or amount-locked Ramp card may decline later adjustments**, which is good for spend control but means Xometry may chase payment **[I]**.
- **Fresh card per order vs saved cards: not found.** No public doc says whether checkout lets you type a new card each time or requires saving it to the account. The bundle shows card-payment statuses `RESERVED` and `CAPTURED`, which suggests authorise-then-capture **[I]**. When capture happens is unknown, and it matters for Ramp card expiry and amount limits. **Verify with the test account.**
- **Processor:** not confirmed. Stripe is documented for Xometry *Pay* (supplier invoicing), not buyer checkout. [Xometry Pay terms](https://www.xometry.com/xometry-pay-terms-and-conditions/)

### Quote validity and re-quotes

- **30 days [V]:** "we guarantee the prices on our quotes for 30 days." [flexible-transparent-pricing](https://www.xometry.com/resources/company/flexible-transparent-pricing/). Also "We also guarantee prices on quotes for up to 30 days." [fall-promo](https://www.xometry.com/fall-promo/)
- **Re-quotes can differ [V/I]:**
  - Pricing is dynamic and personalised. Xometry's March 2026 model "analyzes geometric features, quote configurations, and customer-specific historical data to construct a price-response function". [Digital Engineering 247](https://www.digitalengineering247.com/article/xometry-enhances-ai-native-marketplace-with-enterprise-lead-time-intelligence) [R reporting a Xometry release]
  - A re-quote after 30 days, or by a different user, may price differently **[I]**.
  - Changing production speed is order-level, not per-part. [KB 681](https://community.xometry.com/kb/articles/681-learn-more-about-lead-time-and-delivery-options)
- **Lead-time tiers [V]:** Least Expensive, Standard, Fast/Fastest and Rush (Rush is CNC only, from 1 business day). [KB 681](https://community.xometry.com/kb/articles/681-learn-more-about-lead-time-and-delivery-options)
- **Contract [V]:** no contract exists "until Xometry acknowledges Your acceptance of its Quote by a confirmatory email" (§3.1). Burn should treat the confirmation email or order number as the success signal, not the click.

## X6. Bot protection and frontend

### What's in front [V, fetched 2026-11-10]

| Layer | Evidence |
|---|---|
| CDN/WAF | `server: cloudflare`, `cf-ray`, `cf-cache-status` on www, the quote app and login. Plain curl with a desktop Chrome UA got 200 on `/`, `/robots.txt`, `/legal/`, `/service-agreement/`, `/quoting/home/` and the Auth0 login page: **no JS challenge or interstitial seen**. Cloudflare Bot Management may still be scoring logged-in or API traffic; that can't be seen from outside **[I]** |
| Marketing site | Next.js on Vercel (`x-powered-by: Next.js`, `x-vercel-id`), behind Cloudflare A/B-test workers |
| Quote app | `x-static-worker-name: instant-quote-app`, served from S3 via a Cloudflare worker. React 17.0.2, Emotion, Apollo GraphQL at `/api/graphql/`. Upload uses **react-dropzone** (`Dropzone`, `dropzoneAccept`, `input[type=file]` in the bundle) |
| Login | Auth0 Universal Login with **Bot Detection (Auth Challenge / Turnstile)** wired in (see X5) |
| Bot vendors | **Not found:** PerimeterX/HUMAN, DataDome, Akamai Bot Manager, Kasada, reCAPTCHA, hCaptcha or Arkose scripts on the pages or in the 2.4 MB quote bundle. One `perimeterx.net` string sits inside an analytics library's list of third-party domains, not a loaded script |
| Telemetry | FullStory (session recording), Segment, Sentry, Statsig, Coralogix and Conviva appear in the quote app's `env.js`. Xometry can **watch replays of the agent's sessions [I]** |
| Device classification | `x-device-info` cookie: `isBot` classified from the User-Agent |

BuiltWith and Wappalyzer pages didn't render usable data via fetch, so the table above rests on direct header and bundle inspection.

### CAD upload [V/I]

- The quote page accepts drag-and-drop or browsing. [KB 686](https://community.xometry.com/kb/articles/686-how-do-i-get-a-manufacturing-quote-how-do-i-see-costs-and-lead-times) [V]
- react-dropzone renders a hidden `<input type="file">`, so `locator('input[type=file]').setInputFiles(path)` should work without simulating a drag **[I]**.
- After upload, geometry processing is asynchronous ("a time out during geometry computation"). Wait for the price element, not for network idle **[I]**.
- Manual-review parts show no price, and the agent must treat that as "needs human". [KB 686](https://community.xometry.com/kb/articles/686-how-do-i-get-a-manufacturing-quote-how-do-i-see-costs-and-lead-times) [V]

### What generally works, and what is legitimate [I unless cited]

- **Legitimate and sufficient here:**
  - Real Chrome (Playwright `channel: 'chrome'`), headed or new-headless.
  - A persistent profile, with a human logging in once (and doing the email OTP if MFA is on).
  - One account and one session at a time, at human pace, from a stable IP.
  - Re-use the session; don't re-login per job.
  - Because the public site served plain curl without a challenge, nothing beyond this should be needed, **unless Auth0 challenges the login**. In that case a human completes it through live view.
- **Identify, don't disguise:** Web Bot Auth (RFC 9421 signed requests) is offered by Browserbase (beta, on request), Anchor (Team plan and above) and Kernel (Startup and Enterprise). Cloudflare's own Browser Run always signs and identifies itself. Whether Xometry's Cloudflare config honours these signatures is unknown. ([Browserbase](https://docs.browserbase.com/platform/identity/web-bot-auth.md), [Anchor](https://docs.anchorbrowser.io/advanced/cloudflare-web-bot-auth.md), [Kernel](https://www.kernel.sh/docs/browsers/bot-detection/overview.md), [Cloudflare](https://developers.cloudflare.com/browser-rendering/reference/automatic-request-headers/)) [V]
- **Officially offered but off-limits for Burn:** hosted CAPTCHA solving (Browserbase, Steel, Hyperbrowser, Kernel and Browserless all advertise it) and stealth fingerprints or residential proxies. Using them against Xometry's Auth0 challenge would collide with §7.1.10 and mirrors the conduct that sank Perplexity.

## B7. Runtime: local Playwright vs hosted browser

### Comparison

| | Persistent auth | File upload | Live view / replay | CAPTCHA / stealth (official) | Trigger / API | Pricing and free tier | Session start (reported) | Node / Playwright |
|---|---|---|---|---|---|---|---|---|
| **Local Playwright** | `launchPersistentContext(userDataDir)` keeps cookies and storage indefinitely | Native `setInputFiles` | Trace viewer and `recordVideo`; no live share unless you screen-share | None | Your own server or queue | Free; laptop must stay on | ~0 (local) | Native |
| **Browserbase** | **Contexts** persist the full user-data dir "indefinitely" with `persist: true`; avoid concurrent use of one context. [docs](https://docs.browserbase.com/features/contexts) | `setInputFiles` with a local path; Session Uploads API. [docs](https://docs.browserbase.com/platform/browser/files/uploads.md) | Live view (interactive, embeddable); video replay as HLS or MP4, kept 30 days. [replay](https://docs.browserbase.com/platform/browser/observability/session-replay.md) | Basic stealth on paid plans; auto CAPTCHA solving from Developer; Verified on Scale; Web Bot Auth beta. [plans](https://docs.browserbase.com/account/billing/plans.md) | REST API; Functions with webhooks (`functions.invocations.*`). [webhooks](https://docs.browserbase.com/platform/webhooks/overview.md) | Free: 1 hr, 15-min sessions. Developer $20/mo: 100 hr, 6-hr sessions. Startup $99/mo. [plans](https://docs.browserbase.com/account/billing/plans.md) | ~1.7 s lifecycle (Steel's benchmark); ~1.9 s connect (Browserless's) [R] | Node SDK; Playwright over CDP; **Stagehand** |
| **Steel** | **Profiles** (user-data dir up to 300 MB; deleted after 30 days unused); auth-context reuse; Credentials API. [docs](https://docs.steel.dev/overview/profiles-api/overview) | Files API, then `setInputFiles`. [docs](https://docs.steel.dev/overview/files-api/overview) | Embeddable live and past sessions; agent traces | Solves reCAPTCHA v2/v3, Turnstile and image; not DataDome or FunCAPTCHA. [docs](https://docs.steel.dev/overview/stealth/captcha-solving) | REST API | Free $30 credit, 15-min sessions. Scale $250/mo, 1-hr sessions; $0.10/hr. Open source and self-hostable. [pricing](https://steel.dev/pricing) | ~0.9 s lifecycle (its own benchmark) [R] | Node SDK; Playwright, Puppeteer |
| **Hyperbrowser** | Profiles (`persistChanges`). [docs](https://hyperbrowser.ai/docs/sessions/profiles.md) | Uploads API. [docs](https://hyperbrowser.ai/docs/sessions/uploads.md) | Live view; web and video recordings | CAPTCHA solving on all plans; stealth Basic, or Ultra on Enterprise | REST API | Free 5,000 credits (~50 hr), 1 concurrent; $30/mo Startup. [pricing](https://www.hyperbrowser.ai/pricing) | ~0.7 s connect (Browserless's benchmark); ~3.7 s lifecycle (Steel's) [R] | Node SDK; Playwright, Puppeteer |
| **Anchor Browser** | Profiles; managed auth ("OmniConnect") | Upload API. [docs](https://docs.anchorbrowser.io/advanced/file-upload.md) | Live view; recordings | CAPTCHA from Starter; Cloudflare Web Bot Auth from Team ($500/mo). [pricing](https://anchorbrowser.io/pricing) | Tasks API, webhooks | Free (5 concurrent); Starter $50/mo | Slowest in both benchmarks (5.6–8 s) [R] | Node SDK; Playwright over CDP |
| **Browserless** | Session API persistence: 7 days (Prototyping) to 90 days (Scale); reconnects. [docs](https://docs.browserless.io/baas/session-management/persisting-state.md) | File-transfer support for remote browsers. [docs](https://docs.browserless.io/baas/features/file-transfers.md) | Live URL "hybrid automation" (hand control to a human); screen recording; DOM replay | CAPTCHA solving; stealth via BrowserQL | REST; webhooks on Enterprise Docker | Free: 1k units, **2-min sessions**. $25/mo: 15-min sessions. [pricing](https://www.browserless.io/pricing) | ~0.9 s connect (its own benchmark) [R] | Playwright and Puppeteer connect |
| **Kernel** | Profiles plus **managed auth**: stores credentials, auto-re-logs-in, generates TOTP; email or SMS codes still need a human. [docs](https://www.kernel.sh/docs/auth/managed-auth.md) | Filesystem upload API. [docs](https://www.kernel.sh/docs/api-reference/browser-filesystem/upload-one-or-more-files.md) | Live view; replays (1 day free, 30 days on Startup) | Stealth = ISP proxy plus auto CAPTCHA solver (opt-out); Web Bot Auth on Startup and above. [docs](https://www.kernel.sh/docs/browsers/bot-detection/overview.md) | App invocations API | Free $5/mo credit; $30 Hobbyist. [pricing](https://www.kernel.sh/pricing) | ~1.5 s lifecycle (Steel's benchmark) [R] | Node SDK; Playwright over CDP |
| **Cloudflare Browser Run** | Sessions close after 60 s idle; `keep_alive` up to 20 min. No durable profile found. [limits](https://developers.cloudflare.com/browser-rendering/limits/) | Playwright fork | Not found | **Always self-identifies as a bot** (Web Bot Auth headers); "does not … bypass bot protection" | Workers | Free 10 min/day; Paid 10 hr/mo, then $0.09/hr. [pricing](https://developers.cloudflare.com/browser-rendering/pricing/) | — | Workers Playwright/Puppeteer fork |
| **AWS AgentCore Browser** | Browser profiles (cookies and localStorage, stored in S3) since 2026-02. [AWS](https://aws.amazon.com/about-aws/whats-new/2026/02/amazon-bedrock-agentcore-browser-profiles) | Not documented in the pages read | Live view; recordings to S3 including network and console | Not found | AWS API (StartBrowserSession) | Consumption-based; sessions default 15 min, up to 8 hr. [docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-resource-session-management.html) | — | Playwright over WebSocket; Python-first samples |

The latency figures come from vendor-run benchmarks: [Steel, 2025-11-07](https://steel.dev/blog/remote-browser-benchmark) and [Browserless, 2026-01](https://www.browserless.io/blog/how-fast-is-your-hosted-browser-a-practical-benchmark-for-automation-workloads). They disagree with each other, so treat them as "1–2 s typical; Anchor slower". For Burn, a few seconds of start latency is irrelevant next to manager-approval latency **[I]**.

### Stagehand vs plain Playwright

- **Stagehand** is Browserbase's open-source framework ([docs](https://docs.stagehand.dev/llms.txt), [GitHub](https://github.com/browserbase/stagehand)) [V].
  - Primitives: `act`, `extract`, `observe` and `agent`. It runs locally with Chrome or on Browserbase, works with any LLM, and interoperates with Playwright.
  - Caching: cached actions "replay deterministically". When the page changes, "Stagehand calls the LLM", and if a selector no longer resolves it "falls back to full inference". [caching](https://docs.stagehand.dev/v4/best-practices/caching.md)
  - Note: the docs describe the cache as server-side through Browserbase.
- **Recommendation [I]: a hybrid.**
  - **Playwright** for login-state checks, navigation, `setInputFiles` and the final "Place order" click, guarded by hard assertions: the quote ID, part count, quantity and total must all match what the manager approved. Abort on any mismatch.
  - **Stagehand `extract()`** with a zod schema to read the lead-time and price tiers, the part of the page most likely to be restyled.
  - **`act()`** only as a fallback for configuration steps (material, finish) when a Playwright selector breaks.
  - An LLM never decides to purchase; orders are non-cancellable (§3.1).

### Recommendation

**Hackathon demo: local Playwright on the laptop [I].**

- Use `launchPersistentContext` with real Chrome, headed so the audience sees it, logged into a dedicated Xometry test user once by hand.
- Turn on `recordVideo` and trace capture as the audit artifact.
- Why: free, no session caps (Browserbase free is 1 hr total and 15-min sessions; Browserless free is 2-min sessions), simplest file upload, and no third party holding CAD files or credentials.
- Since Xometry has no test mode, stop at the review step or order a deliberately cheap part.
- Optional: a Browserbase Developer plan ($20/mo) if an embedded live-view panel in Burn's UI is worth the setup for the demo.

**Production: Browserbase, with Kernel as runner-up [I].**

- Persistent Contexts fit the "quote now, buy days later" gap.
- The 30-day HLS/MP4 replays plus live view give the audit trail and the human-in-the-loop fallback (for example, completing an email OTP or Auth0 challenge).
- Stagehand is native.
- Web Bot Auth and the "identify, don't disguise" posture fit the legal analysis.
- Ramp itself uses it, which is a good story for a Ramp-integrated product.
- Kernel's managed auth (automatic re-login) is attractive if session expiry turns out to be short.
- Conditions: Xometry's written OK first; one session per Context at a time; recording on; CAD files only for non-ITAR/CUI parts (see Risks).

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **ToS breach → account termination** (§7.1.2, §7.1.7, §11.3), plus CFAA/state-law exposure if Burn continues after an objection (*Amazon v. Perplexity*) | **High** | Written permission from Xometry; a dedicated, customer-owned agent user; identified agent traffic; stop immediately if blocked. Pursue punchout (Xometry cXML + Ramp punchout request) as the sanctioned path |
| **Irreversible order** (§3.1: no cancellation) | High | Deterministic checkout with hard assertions on quote ID and total; idempotency key per approval; never retry a submit blindly; check for an existing order before placing |
| Session expiry or Auth0 challenge at approval time | Medium | Health-check the session on a schedule; route re-login and OTP to a human via live view; avoid MFA on the agent user only if the customer accepts that trade-off |
| Price or lead time changes (more than 30 days, or personalised re-pricing) | Medium | Re-read the price before purchase; if it differs from the approved amount, send it back to Ramp for re-approval |
| Ramp card vs Xometry billing (authorise-then-capture, later fee adjustments, unknown whether a fresh card can be entered per order) | Medium | Verify with the test account; size the card limit and expiry to cover capture timing |
| DOM or flow changes in the quote app | Medium | Stagehand fallback for configuration steps; alerting on assertion failures; keep the browser-extension route from `vendor-apis.md` as backup |
| CAD and IP exposure in a hosted browser (files transit the browser vendor; Xometry runs FullStory) | Medium | No ITAR/EAR/CUI files through hosted browsers; check the vendor's DPA and retention; delete uploads after the session |
| Monitoring by Xometry (FullStory session replay; `isBot` UA classification) | Low–Medium | Assume the agent is visible; another reason to get permission rather than blend in |

## Sources

Xometry (official):

- [Customer Service Agreement](https://www.xometry.com/service-agreement/)
- [General Terms PDF (2017)](https://xometry-marketing.cdn.prismic.io/xometry-marketing/895c7155-a7e9-4299-bc0a-26f78a02223d_Terms+%26+Conditions+04_04_2017.pdf)
- [Legal index](https://www.xometry.com/legal/)
- [robots.txt](https://www.xometry.com/robots.txt)
- [Punchout](https://www.xometry.com/xometry-enterprise/xometry-integration-punchout/)
- [CAD add-ins](https://www.xometry.com/cad-add-ins/)
- [Developer API](https://developer.xometry.com/)
- [Teamspace](https://www.xometry.com/teamspace/)
- [30-day price guarantee](https://www.xometry.com/resources/company/flexible-transparent-pricing/)
- [Xometry Pay terms](https://www.xometry.com/xometry-pay-terms-and-conditions/)
- KB articles: [804](https://community.xometry.com/kb/articles/804-xometry-teamspace), [821](https://community.xometry.com/kb/articles/821-what-steps-are-involved-in-the-checkout-process-for-a-quote-within-teamspace), [822](https://community.xometry.com/kb/articles/822-can-anyone-on-my-team-delete-a-quote-that-i-ve-shared-with-that-team-or-that-i-ve-created-directly-from-my-team-dashboard), [823](https://community.xometry.com/kb/articles/823-is-there-a-way-to-restrict-the-visibility-of-certain-quotes-or-orders-within-a-team-to-specific-members), [848 MFA](https://community.xometry.com/kb/articles/848-how-to-enable-multi-factor-authentication-mfa), [684](https://community.xometry.com/kb/articles/684-how-do-i-save-a-quote), [685](https://community.xometry.com/kb/articles/685-can-i-share-my-quote-with-a-colleague-or-purchaser), [686](https://community.xometry.com/kb/articles/686-how-do-i-get-a-manufacturing-quote-how-do-i-see-costs-and-lead-times), [688](https://community.xometry.com/kb/articles/688-why-wont-my-file-upload-to-the-instant-quoting-site), [681](https://community.xometry.com/kb/articles/681-learn-more-about-lead-time-and-delivery-options), [648](https://community.xometry.com/kb/articles/648-what-is-a-billing-contact), [649](https://community.xometry.com/kb/articles/649), [696](https://community.xometry.com/kb/articles/696-do-you-accept-paypal)
- Direct fetches on 2026-11-10: `https://www.xometry.com/`, `/quoting/home/` and its `env.js` and `instant-quote-app.*.mjs` bundle, and the `/login/` → `login.xometry.com` Auth0 chain

Identity and anti-bot:

- [Okta: Xometry case study](https://www.okta.com/customers/xometry/)
- [Auth0 Bot Detection](https://auth0.com/docs/secure/attack-protection/bot-detection.md)
- [Cloudflare Browser Run identification](https://developers.cloudflare.com/browser-rendering/reference/automatic-request-headers/)

Ramp:

- [Browserbase × Ramp case study](https://www.browserbase.com/blog/case-study-ramp)
- [agents.ramp.com](https://agents.ramp.com/llms.txt)
- [Ramp punchouts](https://support.ramp.com/punchouts-in-ramp)

Legal:

- [Van Buren (Cooley)](https://www.cooley.com/news/insight/2021/2021-06-09-us-supreme-court-computer-fraud-abuse-act-van-buren)
- [hiQ breach ruling (Proskauer)](https://newmedialaw.proskauer.com/2022/11/11/court-finds-hiq-breached-linkedins-terms-prohibiting-scraping-but-in-mixed-ruling-declines-to-grant-summary-judgment-to-either-party-as-to-certain-key-issues/)
- [hiQ judgment](https://www.privacyworld.blog/2022/12/linkedins-data-scraping-battle-with-hiq-labs-ends-with-proposed-judgment/)
- [Meta v. Bright Data (FBM)](https://www.fbm.com/raven-quesenberry/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/)
- [Amazon v. Perplexity PI (GeekWire)](https://geekwire.com/2026/judge-blocks-perplexitys-ai-bot-from-shopping-on-amazon-in-early-test-of-agentic-commerce/)
- [Amazon v. Perplexity (The Fashion Law)](https://www.thefashionlaw.com/court-blocks-perplexity-from-accessing-amazon-systems-in-agentic-ai-lawsuit/)

Browser platforms:

- Browserbase: [plans](https://docs.browserbase.com/account/billing/plans.md), [contexts](https://docs.browserbase.com/features/contexts), [uploads](https://docs.browserbase.com/platform/browser/files/uploads.md), [replay](https://docs.browserbase.com/platform/browser/observability/session-replay.md), [webhooks](https://docs.browserbase.com/platform/webhooks/overview.md), [Web Bot Auth](https://docs.browserbase.com/platform/identity/web-bot-auth.md)
- Steel: [pricing](https://steel.dev/pricing), [profiles](https://docs.steel.dev/overview/profiles-api/overview), [files](https://docs.steel.dev/overview/files-api/overview), [captcha](https://docs.steel.dev/overview/stealth/captcha-solving), [benchmark](https://steel.dev/blog/remote-browser-benchmark)
- Hyperbrowser: [pricing](https://www.hyperbrowser.ai/pricing), [profiles](https://hyperbrowser.ai/docs/sessions/profiles.md)
- Anchor: [pricing](https://anchorbrowser.io/pricing), [Web Bot Auth](https://docs.anchorbrowser.io/advanced/cloudflare-web-bot-auth.md)
- Browserless: [pricing](https://www.browserless.io/pricing), [docs index](https://docs.browserless.io/llms.txt), [benchmark](https://www.browserless.io/blog/how-fast-is-your-hosted-browser-a-practical-benchmark-for-automation-workloads)
- Kernel: [pricing](https://www.kernel.sh/pricing), [managed auth](https://www.kernel.sh/docs/auth/managed-auth.md), [bot detection](https://www.kernel.sh/docs/browsers/bot-detection/overview.md)
- Cloudflare: [pricing](https://developers.cloudflare.com/browser-rendering/pricing/), [limits](https://developers.cloudflare.com/browser-rendering/limits/)
- AWS AgentCore: [sessions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-resource-session-management.html), [profiles](https://aws.amazon.com/about-aws/whats-new/2026/02/amazon-bedrock-agentcore-browser-profiles)
- Stagehand: [docs](https://docs.stagehand.dev/llms.txt), [caching](https://docs.stagehand.dev/v4/best-practices/caching.md)

Third-party:

- [Digital Engineering 247 on Xometry personalised pricing](https://www.digitalengineering247.com/article/xometry-enhances-ai-native-marketplace-with-enterprise-lead-time-intelligence)
- [supergood.ai Xometry report](https://supergood.ai/api-report-card/xometry)
- [Apify Xometry scraper](https://apify.com/lentic_clockss/xometry-scraper)
