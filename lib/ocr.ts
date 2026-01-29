import { generateText, gateway } from "ai";

export interface OCRResult {
  fileName: string;
  fileId: string;
  text: string;
  language: string;
  englishTranslation?: string;
  originalText?: string;
  noTextFound: boolean;
  isStructured: boolean;
  contentType: "website" | "document" | "photo" | "other";
}

const OCR_PROMPT = `Analyze this image and extract all text using OCR.

First, determine what type of content this image shows:
- "website": Screenshot of a website, app UI, dashboard, form, dialog, or any software interface
- "document": Scanned document, PDF, letter, receipt, or printed text
- "photo": Photo of real-world text (signs, labels, handwriting, etc.)
- "other": Any other type of image with text

Instructions:
1. Extract ALL visible text from the image accurately
2. Detect the language of the text
3. If the text is NOT in English, provide both an English translation and the original text

For WEBSITE/UI screenshots, structure the content logically:
- Identify the page/section title or header
- Group related UI elements (navigation, buttons, form fields, error messages, etc.)
- Preserve hierarchy (main content vs. sidebar vs. footer)
- Note important UI states (selected tabs, active buttons, error states)
- Format lists, tables, and data clearly

For DOCUMENTS, preserve the document structure:
- Headers, paragraphs, lists
- Tables with proper alignment
- Any form fields with their labels and values

Respond in this exact JSON format:
{
  "contentType": "website" | "document" | "photo" | "other",
  "language": "detected language name (e.g., English, Spanish, Chinese, etc.)",
  "isEnglish": true or false,
  "extractedText": "the original extracted text, structured appropriately for the content type",
  "structuredContent": {
    "title": "main title/header if identifiable, or null",
    "sections": [
      {
        "heading": "section heading or UI area name (e.g., 'Navigation', 'Form', 'Error Message')",
        "content": "the text content of this section, preserving structure"
      }
    ]
  },
  "englishTranslation": "English translation if not originally English, otherwise null"
}

If NO text is found in the image, respond with:
{
  "contentType": "other",
  "language": "none",
  "isEnglish": false,
  "extractedText": null,
  "structuredContent": null,
  "englishTranslation": null
}

IMPORTANT: Only return valid JSON, no additional text or markdown.`;

interface StructuredSection {
  heading: string;
  content: string;
}

interface StructuredContent {
  title: string | null;
  sections: StructuredSection[];
}

interface GeminiOCRResponse {
  contentType: "website" | "document" | "photo" | "other";
  language: string;
  isEnglish: boolean;
  extractedText: string | null;
  structuredContent: StructuredContent | null;
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
      isStructured: false,
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
      isStructured: false,
      contentType: "other",
    };
  }

  const isStructured = !!(response.structuredContent?.sections?.length);
  const contentType = response.contentType || "other";

  // Format structured content if available
  let formattedText = response.extractedText;
  if (isStructured && response.structuredContent) {
    formattedText = formatStructuredContent(response.structuredContent);
  }

  // Return result based on whether translation was needed
  if (response.isEnglish) {
    return {
      fileName,
      fileId,
      text: formattedText,
      language: response.language,
      noTextFound: false,
      isStructured,
      contentType,
    };
  } else {
    // For non-English, format both the translation and original if structured
    let translatedText = response.englishTranslation || response.extractedText;
    
    return {
      fileName,
      fileId,
      text: translatedText,
      language: response.language,
      englishTranslation: response.englishTranslation || undefined,
      originalText: response.extractedText,
      noTextFound: false,
      isStructured,
      contentType,
    };
  }
}

// Format structured content into readable text
function formatStructuredContent(content: StructuredContent): string {
  const parts: string[] = [];

  if (content.title) {
    parts.push(`# ${content.title}`);
  }

  for (const section of content.sections) {
    if (section.heading) {
      parts.push(`\n## ${section.heading}`);
    }
    if (section.content) {
      parts.push(section.content);
    }
  }

  return parts.join("\n");
}

// Format OCR results for Slack message
export function formatOCRResultsForSlack(results: OCRResult[]): string {
  if (results.length === 0) {
    return "No images found in this thread.";
  }

  const formattedResults = results.map((result) => {
    // Content type indicator
    const typeEmoji = getContentTypeEmoji(result.contentType);
    let output = `${typeEmoji} *${result.fileName}*`;
    
    if (result.contentType === "website") {
      output += " _(UI/Website screenshot)_";
    }
    output += "\n";

    if (result.noTextFound) {
      output += "\n_No text found in image._";
    } else if (result.englishTranslation && result.originalText) {
      // Non-English text with translation
      output += `\n*English Translation:*\n${formatForSlack(result.text, result.isStructured)}`;
      output += `\n\n───\n\n*Original (${result.language}):*\n${formatForSlack(result.originalText, result.isStructured)}`;
    } else {
      // English text
      output += `\n${formatForSlack(result.text, result.isStructured)}`;
    }

    return output;
  });

  return formattedResults.join("\n\n━━━━━━━━━━━━━━━\n\n");
}

// Get emoji for content type
function getContentTypeEmoji(contentType: OCRResult["contentType"]): string {
  switch (contentType) {
    case "website":
      return ":computer:";
    case "document":
      return ":page_facing_up:";
    case "photo":
      return ":camera:";
    default:
      return ":mag:";
  }
}

// Format text for Slack, converting markdown-style headers to Slack format
function formatForSlack(text: string, isStructured: boolean): string {
  if (!isStructured) {
    return text;
  }

  // Convert markdown headers to Slack bold formatting
  let formatted = text
    // H1: # Title -> *Title*
    .replace(/^# (.+)$/gm, "*$1*")
    // H2: ## Section -> *Section*
    .replace(/^## (.+)$/gm, "\n*$1*")
    // Preserve line breaks but clean up excessive whitespace
    .replace(/\n{3,}/g, "\n\n");

  return formatted;
}
