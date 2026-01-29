import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifySlackSignature } from "../../lib/slack.js";
import { processThread } from "../../lib/process-thread.js";
import { logger } from "../../lib/logger.js";

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
    channel: string;
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

  // Get raw body for signature verification
  const rawBody = JSON.stringify(req.body);
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
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = req.body as SlackPayload;

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
      // Respond immediately to avoid Slack retry
      res.status(200).json({ ok: true });

      // Start logging session
      logger.start(`app_mention:${event_id}`);
      logger.info("Received app_mention event", {
        event_id,
        channel: event.channel,
        ts: event.ts,
        thread_ts: event.thread_ts,
        text: event.text,
      });

      // Determine the thread to process
      // If mentioned in a thread, use thread_ts
      // If mentioned in a top-level message, use that message's ts
      const threadTs = event.thread_ts || event.ts;
      const channel = event.channel;

      logger.info("Processing thread", { channel, threadTs });

      try {
        await processThread(channel, threadTs);
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

      return;
    }

    // Unknown event type
    res.status(200).json({ ok: true });
    return;
  }

  res.status(400).json({ error: "Unknown payload type" });
}
