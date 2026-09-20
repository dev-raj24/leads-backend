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
Optional: `ANTHROPIC_API_KEY` enables AI replies, chat and blog drafts. `SMTP_URL` enables alert and follow-up emails.
