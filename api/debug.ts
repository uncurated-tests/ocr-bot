import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
    env: {
      hasSlackToken: !!process.env.SLACK_BOT_TOKEN,
      hasSigningSecret: !!process.env.SLACK_SIGNING_SECRET,
      hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
    },
    headers: {
      "content-type": req.headers["content-type"],
      "user-agent": req.headers["user-agent"],
    },
  });
}
