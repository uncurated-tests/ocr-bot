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

const OCR_PROMPT = `Extract and transcribe all text from this image.

First, identify the content type:
- "website": Screenshot of a website, app, dashboard, dialog, or software UI
- "document": Scanned document, PDF, receipt, or printed text  
- "photo": Photo of real-world text (signs, labels, handwriting)
- "other": Any other image with text

For WEBSITE/UI screenshots, format the output clearly:
- Use the page/section title as a header
- Group related elements logically (navigation, main content, sidebars, modals)
- For tables/lists, preserve the structure using plain text formatting
- Include button labels, form field labels and values, status indicators
- Use indentation or bullet points to show hierarchy
- Separate distinct sections with blank lines

For DOCUMENTS, preserve structure with headers, paragraphs, and lists.

Output the extracted text in a clean, readable format - NOT as a literal dump of every UI element, but as meaningful structured content a human would want to read.

Respond in this exact JSON format:
{
  "contentType": "website" | "document" | "photo" | "other",
  "language": "detected language name",
  "isEnglish": true or false,
  "extractedText": "the formatted extracted text as a single string with newlines for structure",
  "englishTranslation": "English translation if not originally English, otherwise null"
}

If NO text is found, respond with:
{
  "contentType": "other",
  "language": "none",
  "isEnglish": false,
  "extractedText": null,
  "englishTranslation": null
}

IMPORTANT: Return ONLY valid JSON, no markdown code blocks.`;

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
    let output = `*${result.fileName}*\n`;

    if (result.noTextFound) {
      output += "_No text found in image._";
    } else if (result.englishTranslation && result.originalText) {
      // Non-English text with translation
      output += `*English Translation:*\n\`\`\`\n${result.text}\n\`\`\``;
      output += `\n\n*Original (${result.language}):*\n\`\`\`\n${result.originalText}\n\`\`\``;
    } else {
      // English text - use code block for better formatting of structured content
      output += `\`\`\`\n${result.text}\n\`\`\``;
    }

    return output;
  });

  return formattedResults.join("\n\n---\n\n");
}
