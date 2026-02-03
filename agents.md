# Agent Guide

This repo is a Vercel serverless Slack OCR bot written in TypeScript (ESM).

## Project Structure
- `api/` Vercel function handlers
- `lib/` shared OCR, Slack, and processing logic
- `test/` vitest OCR tests and fixtures

## Working Agreements
- Keep TypeScript ESM (`"type": "module"`) and Node 20+ compatibility.
- Do not hardcode secrets; use environment variables.
- Update `README.md` when adding endpoints or required env vars.
- Keep changes small and focused.

## Testing
- `npm run lint` for typechecking
- `npm test` (requires `.env.local` from `vercel env pull`)

## Key Entry Points
- `api/slack/events.ts` for app mentions and DMs
- `api/slack/command.ts` for the `/ocr` slash command
- `lib/process-thread.ts` for thread processing
- `lib/ocr.ts` for OCR and formatting
