import { WebClient } from "@slack/web-api";
import crypto from "crypto";

// Initialize Slack client
export function getSlackClient(): WebClient {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN environment variable is required");
  }
  return new WebClient(token);
}

// Verify Slack request signature
export function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature =
    "v0=" +
    crypto.createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(signature)
  );
}

// Slack file info type
export interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  url_private_download?: string;
  url_private?: string;
}

// Slack message type
export interface SlackMessage {
  ts: string;
  user?: string;
  bot_id?: string;
  text?: string;
  files?: SlackFile[];
}

// Get thread messages
export async function getThreadMessages(
  client: WebClient,
  channel: string,
  threadTs: string
): Promise<SlackMessage[]> {
  const result = await client.conversations.replies({
    channel,
    ts: threadTs,
    inclusive: true,
  });

  return (result.messages as SlackMessage[]) || [];
}

// Find images in thread messages
export function findImagesInThread(messages: SlackMessage[]): SlackFile[] {
  const images: SlackFile[] = [];

  for (const message of messages) {
    if (message.files) {
      for (const file of message.files) {
        if (file.mimetype?.startsWith("image/")) {
          images.push(file);
        }
      }
    }
  }

  return images;
}

// Download image from Slack
export async function downloadImage(
  fileUrl: string,
  token: string
): Promise<Buffer> {
  const response = await fetch(fileUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Post message to thread and return message ts for updating later
export async function postMessageToThread(
  client: WebClient,
  channel: string,
  threadTs: string,
  text: string
): Promise<string> {
  const result = await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
    mrkdwn: true,
  });
  return result.ts as string;
}

// Update an existing message
export async function updateMessage(
  client: WebClient,
  channel: string,
  messageTs: string,
  text: string
): Promise<void> {
  await client.chat.update({
    channel,
    ts: messageTs,
    text,
  });
}

// Get bot user ID
export async function getBotUserId(client: WebClient): Promise<string> {
  const result = await client.auth.test();
  return result.user_id as string;
}
