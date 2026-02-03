# Slack OCR Bot

Slack OCR bot for extracting text from images in Slack threads using Vercel AI Gateway (Gemini 2.5 Flash). It listens for app mentions or slash commands, processes images in the thread, and posts formatted results back into the same thread. Processed file IDs and logs are stored in Vercel Blob.

## Features
- App mention or DM mention to OCR thread images
- Slash command support with a thread timestamp
- Automatic translation for non-English text
- Deduplicates already processed images per thread, with a force mode
- Stores processing state and logs in Vercel Blob

## API Endpoints
- `POST /api/slack/events` Slack Events API endpoint (app_mention, message.im)
- `POST /api/slack/command` Slash command endpoint for `/ocr`
- `GET /api/debug` Environment sanity check

## Usage
- In a thread: mention the bot, e.g. `@ocr` or `@ocr force`
- Slash command: `/ocr <thread_ts>` (paste a thread timestamp)
- In DMs: mention the bot in the DM thread with images

Notes:
- Maximum 50 images are processed per request.

## Environment Variables

| Name | Purpose |
| --- | --- |
| `SLACK_BOT_TOKEN` | Slack bot token used for API calls |
| `SLACK_SIGNING_SECRET` | Slack signing secret for request verification |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for processed state and logs |
| `VERCEL_OIDC_TOKEN` | Required for local tests; `vercel env pull` populates `.env.local` |

## Development
- `npm install`
- `npm run lint`
- `npm test` (requires `.env.local`; run `vercel env pull` first)
- `npm run dev` (TypeScript watch)

If you want to run the API locally, use the Vercel CLI with `vercel dev`.

## Deployment
- Deploy to Vercel and set the environment variables.
- Configure Slack request URLs:
  - Event subscriptions: `https://<your-app>/api/slack/events`
  - Slash command: `https://<your-app>/api/slack/command`
