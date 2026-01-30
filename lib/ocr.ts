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

const OCR_PROMPT = `You are an OCR assistant. Extract ALL text from this image completely and accurately.

CRITICAL RULES:
1. Extract EVERY word, sentence, and paragraph - DO NOT summarize or shorten
2. Preserve the COMPLETE text exactly as it appears
3. For documents, articles, or long text: include EVERYTHING from start to finish
4. Never skip content, never truncate, never say "etc." or "..."
5. If text continues beyond visible area, extract everything that IS visible

Identify the content type:
- "website": Screenshot of website, app, dashboard, or software UI
- "document": Scanned document, PDF, article, receipt, or printed text
- "photo": Photo of real-world text (signs, labels, handwriting)
- "other": Any other image with text

FORMAT RULES (using Slack mrkdwn syntax):
- Use *bold* for headers and titles only
- Use • for bullet lists
- Use \`\`\` code blocks \`\`\` ONLY for actual code or terminal output
- Preserve paragraph breaks with blank lines
- For documents/articles: output as flowing text with proper paragraphs

FOR UI/SCREENSHOTS ONLY:
- Skip navigation menus, breadcrumbs, repetitive UI chrome
- Focus on main content area
- Keep status messages, errors, and key data

FOR DOCUMENTS/ARTICLES/LONG TEXT:
- Extract the COMPLETE text word-for-word
- Maintain paragraph structure
- Include ALL sentences - this is critical
- Do not summarize or paraphrase

Respond in this exact JSON format:
{
  "contentType": "website" | "document" | "photo" | "other",
  "language": "detected language name",
  "isEnglish": true or false,
  "extractedText": "the complete extracted text with Slack mrkdwn formatting",
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
    maxOutputTokens: 16000, // Allow long responses for documents with lots of text
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
