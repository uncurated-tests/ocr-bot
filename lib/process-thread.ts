import {
  getSlackClient,
  getThreadMessages,
  findImagesInThread,
  downloadImage,
  postMessageToThread,
  type SlackFile,
} from "./slack.js";
import {
  getProcessedFileIds,
  markFilesAsProcessed,
  filterUnprocessedFiles,
} from "./blob.js";
import { performOCR, formatOCRResultsForSlack, type OCRResult } from "./ocr.js";

const MAX_IMAGES = 50;

export interface ProcessThreadResult {
  success: boolean;
  message: string;
  processedCount: number;
  skippedCount: number;
}

export async function processThread(
  channel: string,
  threadTs: string
): Promise<ProcessThreadResult> {
  const client = getSlackClient();
  const token = process.env.SLACK_BOT_TOKEN!;

  // Get thread messages
  const messages = await getThreadMessages(client, channel, threadTs);

  // Find all images in thread
  const allImages = findImagesInThread(messages);

  if (allImages.length === 0) {
    await postMessageToThread(
      client,
      channel,
      threadTs,
      "No images found in this thread."
    );
    return {
      success: true,
      message: "No images found",
      processedCount: 0,
      skippedCount: 0,
    };
  }

  // Get already processed file IDs
  const processedFileIds = await getProcessedFileIds(channel, threadTs);

  // Filter out already processed images
  const unprocessedImages = filterUnprocessedFiles(allImages, processedFileIds);

  if (unprocessedImages.length === 0) {
    await postMessageToThread(
      client,
      channel,
      threadTs,
      "All images in this thread have already been processed."
    );
    return {
      success: true,
      message: "All images already processed",
      processedCount: 0,
      skippedCount: allImages.length,
    };
  }

  // Limit to MAX_IMAGES
  const imagesToProcess = unprocessedImages.slice(0, MAX_IMAGES);
  const limitReached = unprocessedImages.length > MAX_IMAGES;

  // Process each image
  const results: OCRResult[] = [];
  const processedIds: string[] = [];

  for (const image of imagesToProcess) {
    try {
      const imageUrl = image.url_private_download || image.url_private;
      if (!imageUrl) {
        console.error(`No download URL for image ${image.id}`);
        continue;
      }

      // Download image
      const imageBuffer = await downloadImage(imageUrl, token);

      // Perform OCR
      const result = await performOCR(
        imageBuffer,
        image.name,
        image.id,
        image.mimetype
      );

      results.push(result);
      processedIds.push(image.id);
    } catch (error) {
      console.error(`Failed to process image ${image.id}:`, error);
      // Continue with other images
    }
  }

  // Mark files as processed
  if (processedIds.length > 0) {
    await markFilesAsProcessed(channel, threadTs, processedIds);
  }

  // Format and post results
  if (results.length > 0) {
    let response = formatOCRResultsForSlack(results);

    if (limitReached) {
      response += `\n\n_Note: Limited to ${MAX_IMAGES} images per request. ${unprocessedImages.length - MAX_IMAGES} more images remain unprocessed._`;
    }

    await postMessageToThread(client, channel, threadTs, response);
  } else {
    await postMessageToThread(
      client,
      channel,
      threadTs,
      "Failed to process any images. Please try again."
    );
  }

  return {
    success: true,
    message: `Processed ${results.length} images`,
    processedCount: results.length,
    skippedCount: processedFileIds.length,
  };
}
