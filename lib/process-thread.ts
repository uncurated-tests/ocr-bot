import {
  getSlackClient,
  getThreadMessages,
  findImagesInThread,
  downloadImage,
  postMessageToThread,
} from "./slack.js";
import {
  getProcessedFileIds,
  markFilesAsProcessed,
  filterUnprocessedFiles,
} from "./blob.js";
import { performOCR, formatOCRResultsForSlack, type OCRResult } from "./ocr.js";
import { logger } from "./logger.js";

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
  logger.info("Starting thread processing", { channel, threadTs });

  const client = getSlackClient();
  const token = process.env.SLACK_BOT_TOKEN!;

  // Get thread messages
  logger.info("Fetching thread messages");
  const messages = await getThreadMessages(client, channel, threadTs);
  logger.info("Retrieved messages", {
    messageCount: messages.length,
    messages: messages.map((m) => ({
      ts: m.ts,
      user: m.user,
      hasFiles: !!m.files?.length,
      fileCount: m.files?.length || 0,
    })),
  });

  // Find all images in thread
  const allImages = findImagesInThread(messages);
  logger.info("Found images in thread", {
    imageCount: allImages.length,
    images: allImages.map((img) => ({
      id: img.id,
      name: img.name,
      mimetype: img.mimetype,
      hasDownloadUrl: !!img.url_private_download,
      hasPrivateUrl: !!img.url_private,
    })),
  });

  if (allImages.length === 0) {
    logger.warn("No images found in thread");
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
  logger.info("Retrieved processed file IDs", {
    processedCount: processedFileIds.length,
    processedIds: processedFileIds,
  });

  // Filter out already processed images
  const unprocessedImages = filterUnprocessedFiles(allImages, processedFileIds);
  logger.info("Filtered unprocessed images", {
    unprocessedCount: unprocessedImages.length,
    unprocessedIds: unprocessedImages.map((img) => img.id),
  });

  if (unprocessedImages.length === 0) {
    logger.info("All images already processed");
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
  logger.info("Images to process", {
    count: imagesToProcess.length,
    limitReached,
  });

  // Process each image
  const results: OCRResult[] = [];
  const processedIds: string[] = [];

  for (const image of imagesToProcess) {
    logger.info("Processing image", {
      id: image.id,
      name: image.name,
      mimetype: image.mimetype,
    });

    try {
      const imageUrl = image.url_private_download || image.url_private;
      if (!imageUrl) {
        logger.error("No download URL for image", { imageId: image.id });
        continue;
      }

      // Download image
      logger.info("Downloading image", { imageId: image.id, url: imageUrl });
      const imageBuffer = await downloadImage(imageUrl, token);
      logger.info("Image downloaded", {
        imageId: image.id,
        size: imageBuffer.length,
      });

      // Perform OCR
      logger.info("Running OCR", { imageId: image.id });
      const result = await performOCR(
        imageBuffer,
        image.name,
        image.id,
        image.mimetype
      );
      logger.info("OCR completed", {
        imageId: image.id,
        language: result.language,
        noTextFound: result.noTextFound,
        textLength: result.text?.length || 0,
        hasTranslation: !!result.englishTranslation,
      });

      results.push(result);
      processedIds.push(image.id);
    } catch (error) {
      logger.error("Failed to process image", {
        imageId: image.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Continue with other images
    }
  }

  // Mark files as processed
  if (processedIds.length > 0) {
    logger.info("Marking files as processed", { processedIds });
    await markFilesAsProcessed(channel, threadTs, processedIds);
  }

  // Format and post results
  if (results.length > 0) {
    let response = formatOCRResultsForSlack(results);

    if (limitReached) {
      response += `\n\n_Note: Limited to ${MAX_IMAGES} images per request. ${unprocessedImages.length - MAX_IMAGES} more images remain unprocessed._`;
    }

    logger.info("Posting OCR results to thread", {
      resultsCount: results.length,
      responseLength: response.length,
    });
    await postMessageToThread(client, channel, threadTs, response);
  } else {
    logger.warn("No images were successfully processed");
    await postMessageToThread(
      client,
      channel,
      threadTs,
      "Failed to process any images. Please try again."
    );
  }

  logger.info("Thread processing completed", {
    processedCount: results.length,
    skippedCount: processedFileIds.length,
  });

  return {
    success: true,
    message: `Processed ${results.length} images`,
    processedCount: results.length,
    skippedCount: processedFileIds.length,
  };
}
