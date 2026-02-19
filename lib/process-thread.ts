import {
  getSlackClient,
  getThreadMessages,
  findImagesInThread,
  downloadImage,
  postMessageToThread,
  updateMessage,
} from "./slack.js";
import {
  getProcessedFileIds,
  markFilesAsProcessed,
  filterUnprocessedFiles,
} from "./blob.js";
import { performOCR, formatOCRResultsForSlack, type OCRResult } from "./ocr.js";
import { logger } from "./logger.js";

const MAX_IMAGES = 50;
const SLACK_MAX_TEXT_LENGTH = 38_000; // Slack truncates at 40,000; use 38K to leave margin

export interface ProcessThreadResult {
  success: boolean;
  message: string;
  processedCount: number;
  skippedCount: number;
}

export async function processThread(
  channel: string,
  threadTs: string,
  options: { force?: boolean } = {}
): Promise<ProcessThreadResult> {
  const { force = false } = options;
  logger.info("Starting thread processing", { channel, threadTs, force });

  const client = getSlackClient();
  const token = process.env.SLACK_BOT_TOKEN!;

  // Post "Processing..." message immediately
  logger.info("Posting processing message");
  let statusMessageTs: string;
  try {
    statusMessageTs = await postMessageToThread(
      client,
      channel,
      threadTs,
      "Processing images... please wait."
    );
    logger.info("Posted processing message", { statusMessageTs });
  } catch (error) {
    logger.error("Failed to post processing message", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  try {
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
      await updateMessage(
        client,
        channel,
        statusMessageTs,
        "No images found in this thread."
      );
      return {
        success: true,
        message: "No images found",
        processedCount: 0,
        skippedCount: 0,
      };
    }

    // Get already processed file IDs (skip if force mode)
    let unprocessedImages = allImages;
    let processedFileIds: string[] = [];

    if (!force) {
      processedFileIds = await getProcessedFileIds(channel, threadTs);
      logger.info("Retrieved processed file IDs", {
        processedCount: processedFileIds.length,
        processedIds: processedFileIds,
      });

      // Filter out already processed images
      unprocessedImages = filterUnprocessedFiles(allImages, processedFileIds);
      logger.info("Filtered unprocessed images", {
        unprocessedCount: unprocessedImages.length,
        unprocessedIds: unprocessedImages.map((img) => img.id),
      });

      if (unprocessedImages.length === 0) {
        logger.info("All images already processed");
        await updateMessage(
          client,
          channel,
          statusMessageTs,
          "All images in this thread have already been processed.\n_Tip: Use `@ocr force` to reprocess them._"
        );
        return {
          success: true,
          message: "All images already processed",
          processedCount: 0,
          skippedCount: allImages.length,
        };
      }
    } else {
      logger.info("Force mode enabled, processing all images", {
        imageCount: allImages.length,
      });
    }

    // Limit to MAX_IMAGES
    const imagesToProcess = unprocessedImages.slice(0, MAX_IMAGES);
    const limitReached = unprocessedImages.length > MAX_IMAGES;
    logger.info("Images to process", {
      count: imagesToProcess.length,
      limitReached,
    });

    // Update status with count
    await updateMessage(
      client,
      channel,
      statusMessageTs,
      `Processing ${imagesToProcess.length} image${imagesToProcess.length > 1 ? "s" : ""}... please wait.`
    );

    // Process each image
    const results: OCRResult[] = [];
    const processedIds: string[] = [];

    for (let i = 0; i < imagesToProcess.length; i++) {
      const image = imagesToProcess[i];
      logger.info("Processing image", {
        index: i + 1,
        total: imagesToProcess.length,
        id: image.id,
        name: image.name,
        mimetype: image.mimetype,
      });

      // Update progress
      if (imagesToProcess.length > 1) {
        await updateMessage(
          client,
          channel,
          statusMessageTs,
          `Processing image ${i + 1} of ${imagesToProcess.length}... please wait.`
        );
      }

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

    // Format and update message with results
    if (results.length > 0) {
      let response = formatOCRResultsForSlack(results);

      if (limitReached) {
        response += `\n\n_Note: Limited to ${MAX_IMAGES} images per request. ${unprocessedImages.length - MAX_IMAGES} more images remain unprocessed._`;
      }

      // Truncate to stay within Slack's message limit
      const truncationNotice =
        "\n\n_Output was truncated because it exceeded Slack's message length limit._";
      if (response.length > SLACK_MAX_TEXT_LENGTH) {
        response =
          response.slice(0, SLACK_MAX_TEXT_LENGTH - truncationNotice.length) +
          truncationNotice;
      }

      // Attempt to post; if Slack still rejects, halve and retry
      let posted = false;
      while (!posted) {
        try {
          await updateMessage(client, channel, statusMessageTs, response);
          posted = true;
        } catch (err) {
          const isToolong =
            err instanceof Error && err.message.includes("msg_too_long");
          if (isToolong && response.length > 500) {
            // Halve the text and retry
            response =
              response.slice(0, Math.floor(response.length / 2)) +
              truncationNotice;
          } else {
            throw err; // not a length issue, propagate
          }
        }
      }
    } else {
      logger.warn("No images were successfully processed");
      await updateMessage(
        client,
        channel,
        statusMessageTs,
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
  } catch (error) {
    // Update the status message with error
    logger.error("Thread processing failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    try {
      await updateMessage(
        client,
        channel,
        statusMessageTs,
        `Error processing images: ${error instanceof Error ? error.message : "Unknown error"}. Please try again.`
      );
    } catch {
      // Ignore error updating message
    }

    throw error;
  }
}
