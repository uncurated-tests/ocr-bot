import type { VercelRequest, VercelResponse } from "@vercel/node";
import { waitUntil } from "@vercel/functions";
import { put } from "@vercel/blob";
import { verifySlackSignature, getSlackClient, getBotUserId } from "../../lib/slack.js";
import { processThread } from "../../lib/process-thread.js";
import { logger } from "../../lib/logger.js";

// Disable body parsing to get raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

// Read raw body from request stream
async function getRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Log every incoming request to blob for debugging
async function logRequest(rawBody: string, req: VercelRequest, extra?: Record<string, unknown>) {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    parsedBody = rawBody;
  }
  
  const logData = {
    timestamp: new Date().toISOString(),
    method: req.method,
    headers: {
      "content-type": req.headers["content-type"],
      "x-slack-request-timestamp": req.headers["x-slack-request-timestamp"],
      "x-slack-signature": String(req.headers["x-slack-signature"] || "").substring(0, 20) + "...",
    },
    body: parsedBody,
    extra,
  };
  
  console.log("INCOMING REQUEST:", JSON.stringify(logData, null, 2));
  
  try {
    const key = `debug/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.json`;
    await put(key, JSON.stringify(logData, null, 2), {
      access: "public",
      addRandomSuffix: false,
    });
  } catch (e) {
    console.error("Failed to log to blob:", e);
  }
}

// Slack Events API payload types
interface SlackChallenge {
  type: "url_verification";
  challenge: string;
}

interface SlackEventCallback {
  type: "event_callback";
  event: {
    type: string;
    user?: string;
    bot_id?: string;
    channel: string;
    channel_type?: string; // "im" for DMs, "channel" for public channels
    ts: string;
    thread_ts?: string;
    text?: string;
  };
  event_id: string;
}

type SlackPayload = SlackChallenge | SlackEventCallback;

// Track processed event IDs to avoid duplicates (in-memory for simplicity)
const processedEvents = new Set<string>();

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Read raw body for signature verification
  const rawBody = await getRawBody(req);
  
  // Log every request for debugging
  await logRequest(rawBody, req, { stage: "received" });

  const timestamp = req.headers["x-slack-request-timestamp"] as string;
  const signature = req.headers["x-slack-signature"] as string;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET not configured");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  // Verify signature
  if (!verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
    console.error("Invalid Slack signature");
    await logRequest(rawBody, req, { stage: "signature_failed", timestamp, signature: signature?.substring(0, 20) });
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Parse the body after signature verification
  let payload: SlackPayload;
  try {
    payload = JSON.parse(rawBody) as SlackPayload;
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  // Handle URL verification challenge
  if (payload.type === "url_verification") {
    res.status(200).json({ challenge: payload.challenge });
    return;
  }

  // Handle event callbacks
  if (payload.type === "event_callback") {
    const { event, event_id } = payload;

    // Deduplicate events
    if (processedEvents.has(event_id)) {
      res.status(200).json({ ok: true });
      return;
    }
    processedEvents.add(event_id);

    // Clean up old event IDs (keep last 1000)
    if (processedEvents.size > 1000) {
      const toDelete = Array.from(processedEvents).slice(0, 500);
      toDelete.forEach((id) => processedEvents.delete(id));
    }

    // Handle app_mention events
    if (event.type === "app_mention") {
      // Determine the thread to process
      // If mentioned in a thread, use thread_ts
      // If mentioned in a top-level message, use that message's ts
      const threadTs = event.thread_ts || event.ts;
      const channel = event.channel;

      // Check if "force" is in the message text (case-insensitive)
      const forceMode = /\bforce\b/i.test(event.text || "");

      // Use waitUntil to keep the function alive while processing
      // This allows us to respond immediately to Slack while continuing to process
      waitUntil(
        (async () => {
          // Start logging session
          logger.start(`app_mention:${event_id}`);
          logger.info("Received app_mention event", {
            event_id,
            channel,
            ts: event.ts,
            thread_ts: event.thread_ts,
            text: event.text,
            forceMode,
          });

          logger.info("Processing thread", { channel, threadTs, forceMode });

          try {
            await processThread(channel, threadTs, { force: forceMode });
            logger.info("Thread processing completed successfully");
          } catch (error) {
            logger.error("Failed to process thread", {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
          } finally {
            // Flush logs to blob storage
            await logger.flush();
          }
        })()
      );

      // Respond immediately to avoid Slack retry
      res.status(200).json({ ok: true });
      return;
    }

    // Handle DM messages - only respond if bot is mentioned
    if (event.type === "message" && event.channel_type === "im") {
      // Ignore bot messages to prevent loops
      if (event.bot_id) {
        res.status(200).json({ ok: true });
        return;
      }

      // Check if bot is mentioned in the message
      const client = getSlackClient();
      const botUserId = await getBotUserId(client);
      const isBotMentioned = event.text?.includes(`<@${botUserId}>`);

      if (!isBotMentioned) {
        res.status(200).json({ ok: true });
        return;
      }

      // Process DM thread (same logic as app_mention)
      const threadTs = event.thread_ts || event.ts;
      const channel = event.channel;

      // Check if "force" is in the message text (case-insensitive)
      const forceMode = /\bforce\b/i.test(event.text || "");

      waitUntil(
        (async () => {
          logger.start(`dm_message:${event_id}`);
          logger.info("Received DM with bot mention", {
            event_id,
            channel,
            ts: event.ts,
            thread_ts: event.thread_ts,
            text: event.text,
            forceMode,
          });

          logger.info("Processing DM thread", { channel, threadTs, forceMode });

          try {
            await processThread(channel, threadTs, { force: forceMode });
            logger.info("DM thread processing completed successfully");
          } catch (error) {
            logger.error("Failed to process DM thread", {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
          } finally {
            await logger.flush();
          }
        })()
      );

      res.status(200).json({ ok: true });
      return;
    }

    // Unknown event type
    res.status(200).json({ ok: true });
    return;
  }

  res.status(400).json({ error: "Unknown payload type" });
}
