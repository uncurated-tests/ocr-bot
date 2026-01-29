import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifySlackSignature } from "../../lib/slack.js";
import { processThread } from "../../lib/process-thread.js";

// Disable body parsing to get raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

interface SlackSlashCommand {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
}

// Parse URL-encoded body
function parseUrlEncoded(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Read raw body for signature verification
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  const payload = parseUrlEncoded(rawBody) as unknown as SlackSlashCommand;

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

  const { channel_id, text } = payload;

  // The /ocr command must be used in a thread
  // The 'text' field might contain the thread_ts if invoked from a thread
  // In Slack, when you use a slash command in a thread, the thread_ts is NOT automatically provided
  // We need to handle this differently - users need to specify thread_ts or use in thread

  // Parse the text for a thread_ts (format: 1234567890.123456)
  const threadTsMatch = text?.match(/(\d+\.\d+)/);

  if (!threadTsMatch) {
    // If no thread_ts provided, inform user how to use the command
    res.status(200).json({
      response_type: "ephemeral",
      text: "Please use `/ocr` in a thread, or provide a thread timestamp: `/ocr 1234567890.123456`\n\nTip: You can get a thread's timestamp by copying the link to the thread message.",
    });
    return;
  }

  const threadTs = threadTsMatch[1];

  // Acknowledge immediately
  res.status(200).json({
    response_type: "ephemeral",
    text: "Processing images in thread... This may take a moment.",
  });

  // Process the thread in background
  try {
    await processThread(channel_id, threadTs);
  } catch (error) {
    console.error("Failed to process thread:", error);

    // Send error via response_url
    const { response_url } = payload;
    if (response_url) {
      await fetch(response_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response_type: "ephemeral",
          text: "Failed to process thread. Please try again.",
        }),
      });
    }
  }
}
