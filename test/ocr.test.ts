import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { performOCR, formatOCRResultsForSlack } from "../lib/ocr.js";

// Load environment variables from .env.local
function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^([^=]+)="(.*)"/);
      if (match) {
        process.env[match[1]] = match[2].replace(/\\n$/, "");
      }
    }
  }
}

interface TestImageMetadata {
  name: string;
  lang: string;
  expectedText: string;
  originalText: string;
}

const fixturesDir = path.join(process.cwd(), "test/fixtures");

describe("OCR E2E Tests", () => {
  let metadata: TestImageMetadata[];

  beforeAll(() => {
    loadEnv();
    // Verify OIDC token is present
    if (!process.env.VERCEL_OIDC_TOKEN) {
      throw new Error(
        "VERCEL_OIDC_TOKEN not found. Run 'vercel env pull' first."
      );
    }

    // Load test metadata
    const metadataPath = path.join(fixturesDir, "metadata.json");
    metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  });

  describe("English text extraction", () => {
    it("should extract simple English text", async () => {
      const imagePath = path.join(fixturesDir, "01_english_simple.png");
      const imageBuffer = fs.readFileSync(imagePath);

      const result = await performOCR(
        imageBuffer,
        "01_english_simple.png",
        "file_001",
        "image/png"
      );

      expect(result.noTextFound).toBe(false);
      expect(result.language.toLowerCase()).toContain("english");
      expect(result.text.toLowerCase()).toContain("hello");
      expect(result.text.toLowerCase()).toContain("world");
      expect(result.englishTranslation).toBeUndefined(); // Already English
    }, 30000);

    it("should extract multi-line English notes", async () => {
      const imagePath = path.join(fixturesDir, "02_english_notes.png");
      const imageBuffer = fs.readFileSync(imagePath);

      const result = await performOCR(
        imageBuffer,
        "02_english_notes.png",
        "file_002",
        "image/png"
      );

      expect(result.noTextFound).toBe(false);
      expect(result.text.toLowerCase()).toContain("meeting");
      expect(result.text.toLowerCase()).toContain("notes");
    }, 30000);

    it("should extract code snippet", async () => {
      const imagePath = path.join(fixturesDir, "08_code_snippet.png");
      const imageBuffer = fs.readFileSync(imagePath);

      const result = await performOCR(
        imageBuffer,
        "08_code_snippet.png",
        "file_008",
        "image/png"
      );

      expect(result.noTextFound).toBe(false);
      expect(result.text.toLowerCase()).toContain("function");
      expect(result.text.toLowerCase()).toContain("greet");
    }, 30000);

    it("should extract numbers and special characters", async () => {
      const imagePath = path.join(fixturesDir, "09_numbers_special.png");
      const imageBuffer = fs.readFileSync(imagePath);

      const result = await performOCR(
        imageBuffer,
        "09_numbers_special.png",
        "file_009",
        "image/png"
      );

      expect(result.noTextFound).toBe(false);
      expect(result.text).toContain("12345");
      expect(result.text.toLowerCase()).toContain("invoice");
    }, 30000);
  });

  describe("Non-English text extraction with translation", () => {
    it("should extract Spanish text and translate to English", async () => {
      const imagePath = path.join(fixturesDir, "03_spanish.png");
      const imageBuffer = fs.readFileSync(imagePath);

      const result = await performOCR(
        imageBuffer,
        "03_spanish.png",
        "file_003",
        "image/png"
      );

      expect(result.noTextFound).toBe(false);
      expect(result.language.toLowerCase()).toContain("spanish");
      expect(result.originalText).toBeDefined();
      expect(result.originalText?.toLowerCase()).toContain("hola");
      expect(result.englishTranslation).toBeDefined();
      expect(result.englishTranslation?.toLowerCase()).toContain("hello");
    }, 30000);

    it("should extract French text and translate to English", async () => {
      const imagePath = path.join(fixturesDir, "04_french.png");
      const imageBuffer = fs.readFileSync(imagePath);

      const result = await performOCR(
        imageBuffer,
        "04_french.png",
        "file_004",
        "image/png"
      );

      expect(result.noTextFound).toBe(false);
      expect(result.language.toLowerCase()).toContain("french");
      expect(result.originalText).toBeDefined();
      expect(result.originalText?.toLowerCase()).toContain("bonjour");
      expect(result.englishTranslation).toBeDefined();
    }, 30000);

    it("should extract German text and translate to English", async () => {
      const imagePath = path.join(fixturesDir, "05_german.png");
      const imageBuffer = fs.readFileSync(imagePath);

      const result = await performOCR(
        imageBuffer,
        "05_german.png",
        "file_005",
        "image/png"
      );

      expect(result.noTextFound).toBe(false);
      expect(result.language.toLowerCase()).toContain("german");
      expect(result.originalText).toBeDefined();
      expect(result.originalText?.toLowerCase()).toContain("guten");
    }, 30000);

    it("should extract Portuguese text and translate to English", async () => {
      const imagePath = path.join(fixturesDir, "06_portuguese.png");
      const imageBuffer = fs.readFileSync(imagePath);

      const result = await performOCR(
        imageBuffer,
        "06_portuguese.png",
        "file_006",
        "image/png"
      );

      expect(result.noTextFound).toBe(false);
      expect(result.language.toLowerCase()).toContain("portuguese");
      expect(result.originalText).toBeDefined();
      expect(result.originalText?.toLowerCase()).toContain("olá");
    }, 30000);

    it("should extract Italian text and translate to English", async () => {
      const imagePath = path.join(fixturesDir, "07_italian.png");
      const imageBuffer = fs.readFileSync(imagePath);

      const result = await performOCR(
        imageBuffer,
        "07_italian.png",
        "file_007",
        "image/png"
      );

      expect(result.noTextFound).toBe(false);
      expect(result.language.toLowerCase()).toContain("italian");
      expect(result.originalText).toBeDefined();
      expect(result.originalText?.toLowerCase()).toContain("ciao");
    }, 30000);

    it("should extract Dutch text and translate to English", async () => {
      const imagePath = path.join(fixturesDir, "10_dutch.png");
      const imageBuffer = fs.readFileSync(imagePath);

      const result = await performOCR(
        imageBuffer,
        "10_dutch.png",
        "file_010",
        "image/png"
      );

      expect(result.noTextFound).toBe(false);
      expect(result.language.toLowerCase()).toContain("dutch");
      expect(result.originalText).toBeDefined();
      expect(result.originalText?.toLowerCase()).toContain("hallo");
    }, 30000);
  });

  describe("Slack message formatting", () => {
    it("should format English results correctly", () => {
      const results = [
        {
          fileName: "test.png",
          fileId: "file_001",
          text: "Hello World",
          language: "English",
          noTextFound: false,
        },
      ];

      const formatted = formatOCRResultsForSlack(results);

      expect(formatted).toContain("*OCR Result for test.png*");
      expect(formatted).toContain("Hello World");
      expect(formatted).not.toContain("English Translation");
    });

    it("should format non-English results with translation", () => {
      const results = [
        {
          fileName: "spanish.png",
          fileId: "file_002",
          text: "Hello World",
          language: "Spanish",
          englishTranslation: "Hello World",
          originalText: "Hola Mundo",
          noTextFound: false,
        },
      ];

      const formatted = formatOCRResultsForSlack(results);

      expect(formatted).toContain("*OCR Result for spanish.png*");
      expect(formatted).toContain("*English Translation:*");
      expect(formatted).toContain("Hello World");
      expect(formatted).toContain("*Original (Spanish):*");
      expect(formatted).toContain("Hola Mundo");
    });

    it("should format no text found correctly", () => {
      const results = [
        {
          fileName: "empty.png",
          fileId: "file_003",
          text: "",
          language: "none",
          noTextFound: true,
        },
      ];

      const formatted = formatOCRResultsForSlack(results);

      expect(formatted).toContain("No text found in image");
    });

    it("should format multiple results with separator", () => {
      const results = [
        {
          fileName: "test1.png",
          fileId: "file_001",
          text: "Text 1",
          language: "English",
          noTextFound: false,
        },
        {
          fileName: "test2.png",
          fileId: "file_002",
          text: "Text 2",
          language: "English",
          noTextFound: false,
        },
      ];

      const formatted = formatOCRResultsForSlack(results);

      expect(formatted).toContain("test1.png");
      expect(formatted).toContain("test2.png");
      expect(formatted).toContain("---"); // Separator
    });

    it("should handle empty results array", () => {
      const formatted = formatOCRResultsForSlack([]);
      expect(formatted).toContain("No images found");
    });
  });
});
