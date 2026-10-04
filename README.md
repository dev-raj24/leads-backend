# Leadworks API

Express + TypeScript + PostgreSQL.

## Setup

    yarn install
    cp .env.example .env
    createdb leadworks
    yarn migrate
    yarn dev

## Scripts

| Script | What it does |
|---|---|
| `yarn dev` | Start with reload |
| `yarn build && yarn start` | Compile and run |
| `yarn migrate` | Apply new files from `db/migrations` |
| `yarn test` | Run the integration tests against `leadworks_test` (created by you, migrated automatically) |

## Layout

    src/routes        url -> controller
    src/controllers   request validation and response shape
    src/services      business logic and SQL
    src/middleware    auth, rate limits, error handling
    src/config        env, database, AI client
    src/jobs          background workers (follow-ups)
    src/types         domain types
    src/utils         shared helpers and errors

## Environment

Required: `DATABASE_URL`, `JWT_SECRET` (32+ characters in production).
Optional: `GEMINI_API_KEY` enables AI replies, chat and blog drafts. `SMTP_URL` enables alert and follow-up emails.

### Going live

- `PUBLIC_API_URL` is the public address of this API. It is used in the stop link inside automatic emails, so it must be reachable from the internet.
- `MAIL_FROM` must use a domain you have verified with your mail provider (SPF, DKIM and DMARC), otherwise mail only reaches your own address.
- Payments: set all four `RAZORPAY_*` values. Create a monthly plan in Razorpay, put its id in `RAZORPAY_PRO_PLAN_ID`, and point a webhook to `POST /api/public/billing/razorpay-webhook` with the events `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`. Until all four are set, Pro can only be switched on in development.
- Background jobs: run `JOBS=off yarn start` for the web process and `yarn start:worker` as a second process, so a web restart never delays follow-ups.
- Follow-ups are only sent between 9 AM and 8 PM in the site's timezone (`settings.timezone`, default Asia/Kolkata). Set `QUIET_HOURS=off` to disable this.
- Rotate `SMTP_URL`, `GEMINI_API_KEY` and `JWT_SECRET` if they were ever pasted into a chat, ticket or screenshot.
- Replies in the portal: set `INBOUND_EMAIL_DOMAIN` (a subdomain such as `inbound.yourdomain.com` whose MX records point to a provider that can forward incoming mail as JSON) and `INBOUND_EMAIL_SECRET`. Configure the provider to POST each incoming message to `/api/public/inbound-email` with the header `x-inbound-secret`. Postmark inbound, Resend inbound and a plain `{from, to, subject, text}` JSON body are understood. Without these two values, answers go to the owner's own inbox instead of the lead's thread.
- Sessions: every password change or "log out everywhere" revokes older tokens. Eight wrong passwords for one email lock that login for 15 minutes.
