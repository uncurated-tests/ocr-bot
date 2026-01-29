import { generateText, gateway } from "ai";

export interface OCRResult {
  fileName: string;
  fileId: string;
  text: string;
  language: string;
  englishTranslation?: string;
  originalText?: string;
  noTextFound: boolean;
  contentType: "website" | "document" | "photo" | "other";
}

const OCR_PROMPT = `Extract text from this image and format it for Slack messaging.

Identify the content type:
- "website": Screenshot of website, app, dashboard, or software UI
- "document": Scanned document, PDF, receipt, or printed text
- "photo": Photo of real-world text (signs, labels, handwriting)
- "other": Any other image with text

FORMAT THE OUTPUT USING SLACK MRKDWN SYNTAX:
- Use *bold* for section headers, titles, and important labels
- Use • for bullet point lists
- Use regular text for values and descriptions
- Only use \`\`\` code blocks \`\`\` for actual code, logs, or terminal output
- Separate sections with blank lines

FOR UI/WEBSITE SCREENSHOTS, structure like this example:
*Page Title*

*Status:* Build Failed
*Error:* Command exited with 1

*Deployment Info*
• Created by username 10h ago
• Duration: 1m 34s
• Environment: Preview

*Domains*
• example.vercel.app
• example-git-branch.vercel.app

*Build Logs* (4 errors)
\`\`\`
06:20:38 error message here
06:20:39 another error
\`\`\`

GUIDELINES:
- Skip navigation menus, breadcrumbs, and repetitive UI chrome
- Focus on the main content and actionable information
- Group related items logically
- Keep status indicators, error messages, and key metadata
- For logs, include only the most relevant entries (errors, warnings)

Respond in this exact JSON format:
{
  "contentType": "website" | "document" | "photo" | "other",
  "language": "detected language name",
  "isEnglish": true or false,
  "extractedText": "the Slack-formatted text with mrkdwn syntax",
  "englishTranslation": "English translation if not originally English, otherwise null"
}

If NO text is found:
{
  "contentType": "other",
  "language": "none",
  "isEnglish": false,
  "extractedText": null,
  "englishTranslation": null
}

IMPORTANT: Return ONLY valid JSON, no markdown code blocks around the JSON.`;

interface GeminiOCRResponse {
  contentType: "website" | "document" | "photo" | "other";
  language: string;
  isEnglish: boolean;
  extractedText: string | null;
  englishTranslation: string | null;
}

export async function performOCR(
  imageBuffer: Buffer,
  fileName: string,
  fileId: string,
  mimeType: string
): Promise<OCRResult> {
  // Use Vercel AI Gateway with Gemini 2.5 Flash
  // OIDC authentication is automatic on Vercel deployments
  const { text } = await generateText({
    model: gateway("google/gemini-2.5-flash"),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: OCR_PROMPT,
          },
          {
            type: "image",
            image: imageBuffer,
          },
        ],
      },
    ],
  });

  // Parse the JSON response
  let response: GeminiOCRResponse;
  try {
    // Clean up potential markdown code blocks
    const cleanedText = text
      .replace(/^```json\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
    response = JSON.parse(cleanedText);
  } catch {
    // If parsing fails, treat as no text found
    console.error("Failed to parse OCR response:", text);
    return {
      fileName,
      fileId,
      text: "",
      language: "unknown",
      noTextFound: true,
      contentType: "other",
    };
  }

  // Handle no text found
  if (!response.extractedText) {
    return {
      fileName,
      fileId,
      text: "",
      language: "none",
      noTextFound: true,
      contentType: "other",
    };
  }

  const contentType = response.contentType || "other";

  // Return result based on whether translation was needed
  if (response.isEnglish) {
    return {
      fileName,
      fileId,
      text: response.extractedText,
      language: response.language,
      noTextFound: false,
      contentType,
    };
  } else {
    return {
      fileName,
      fileId,
      text: response.englishTranslation || response.extractedText,
      language: response.language,
      englishTranslation: response.englishTranslation || undefined,
      originalText: response.extractedText,
      noTextFound: false,
      contentType,
    };
  }
}

// Format OCR results for Slack message
export function formatOCRResultsForSlack(results: OCRResult[]): string {
  if (results.length === 0) {
    return "No images found in this thread.";
  }

  const formattedResults = results.map((result) => {
    // For single image, don't show filename header to reduce noise
    const showHeader = results.length > 1;
    let output = showHeader ? `*${result.fileName}*\n\n` : "";

    if (result.noTextFound) {
      output += "_No text found in image._";
    } else if (result.englishTranslation && result.originalText) {
      // Non-English text with translation
      output += `*English Translation:*\n${result.text}`;
      output += `\n\n---\n\n*Original (${result.language}):*\n${result.originalText}`;
    } else {
      // Text is already Slack-formatted from the AI
      output += result.text;
    }

    return output;
  });

  return formattedResults.join("\n\n---\n\n");
}
