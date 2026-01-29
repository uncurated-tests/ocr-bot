import { google } from "@ai-sdk/google";
import { generateText } from "ai";

export interface OCRResult {
  fileName: string;
  fileId: string;
  text: string;
  language: string;
  englishTranslation?: string;
  originalText?: string;
  noTextFound: boolean;
}

const OCR_PROMPT = `Analyze this image and extract all text using OCR.

Instructions:
1. Extract ALL visible text from the image accurately
2. Detect the language of the text
3. If the text is NOT in English, provide both:
   - An English translation
   - The original text

Respond in this exact JSON format:
{
  "language": "detected language name (e.g., English, Spanish, Chinese, etc.)",
  "isEnglish": true or false,
  "extractedText": "the original extracted text exactly as it appears",
  "englishTranslation": "English translation if not originally English, otherwise null"
}

If NO text is found in the image, respond with:
{
  "language": "none",
  "isEnglish": false,
  "extractedText": null,
  "englishTranslation": null
}

IMPORTANT: Only return valid JSON, no additional text or markdown.`;

interface GeminiOCRResponse {
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
  const model = google("gemini-2.5-flash-preview-05-20");

  const { text } = await generateText({
    model,
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
            mimeType: mimeType as
              | "image/jpeg"
              | "image/png"
              | "image/gif"
              | "image/webp",
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
    };
  }

  // Return result based on whether translation was needed
  if (response.isEnglish) {
    return {
      fileName,
      fileId,
      text: response.extractedText,
      language: response.language,
      noTextFound: false,
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
    };
  }
}

// Format OCR results for Slack message
export function formatOCRResultsForSlack(results: OCRResult[]): string {
  if (results.length === 0) {
    return "No images found in this thread.";
  }

  const formattedResults = results.map((result) => {
    let output = `*OCR Result for ${result.fileName}*\n`;

    if (result.noTextFound) {
      output += "\nNo text found in image.";
    } else if (result.englishTranslation && result.originalText) {
      // Non-English text with translation
      output += `\n*English Translation:*\n${result.englishTranslation}`;
      output += `\n\n---\n\n*Original (${result.language}):*\n${result.originalText}`;
    } else {
      // English text
      output += `\n${result.text}`;
    }

    return output;
  });

  return formattedResults.join("\n\n---\n\n");
}
