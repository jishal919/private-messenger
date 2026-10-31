# Lite Messenger

A private, mobile-first messaging app built with Next.js, TypeScript, and Turso/libSQL. It includes account management, one-to-one conversations, media and voice messages, read states, and web push notifications.

## Tech stack

- Next.js 14 App Router, React 18, TypeScript
- Turso/libSQL for account and message data
- ImageKit for avatars and voice messages
- Backblaze B2 for image, video, and document storage
- Vercel deployment with a scheduled media cleanup endpoint

## Run locally

Requirements: Node.js 18 or newer and npm.

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and fill in the credentials for the services you enable.
3. Create the database schemas using the SQL files in `db/` and `db/content-migrations/`.
4. Start the development server: `npm run dev`
5. Open [http://localhost:3000](http://localhost:3000).

The core database URL and token use `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Message storage is configured through `CONTENT_SHARDS_CONFIG`, a JSON array of enabled Turso shards. The example file documents the optional ImageKit, Backblaze B2, and VAPID settings. Features that depend on an external storage service require that service's credentials.

## Database files

- `db/schema.sql` — core account and session schema
- `db/migrations/` — core database migrations
- `db/content-schema.sql` — initial message storage schema
- `db/content-migrations/` — message storage migrations

Apply the content schema and its migrations to each database configured in `CONTENT_SHARDS_CONFIG`.

## Deploy

Import the repository into Vercel, configure the variables from `.env.example` in the project settings, and deploy. `vercel.json` schedules the media cleanup endpoint daily. Set a strong `CRON_SECRET` in production to require authorization for that endpoint.

## Project layout

- `app/` — pages and API routes
- `components/` — chat interface and reusable UI
- `lib/` — authentication, data access, media, and browser helpers
- `db/` — schemas and migrations
