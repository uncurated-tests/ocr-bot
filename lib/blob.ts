import { put, head } from "@vercel/blob";

// Key format: processed/{channel_id}_{thread_ts}.json
function getProcessedKey(channel: string, threadTs: string): string {
  return `processed/${channel}_${threadTs}.json`;
}

interface ProcessedData {
  processedFileIds: string[];
  lastUpdated: string;
}

// Get list of already processed file IDs for a thread
export async function getProcessedFileIds(
  channel: string,
  threadTs: string
): Promise<string[]> {
  const key = getProcessedKey(channel, threadTs);

  try {
    const blob = await head(key);
    if (!blob) {
      return [];
    }

    const response = await fetch(blob.url);
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as ProcessedData;
    return data.processedFileIds || [];
  } catch {
    // Blob doesn't exist yet
    return [];
  }
}

// Mark file IDs as processed for a thread
export async function markFilesAsProcessed(
  channel: string,
  threadTs: string,
  fileIds: string[]
): Promise<void> {
  const key = getProcessedKey(channel, threadTs);

  // Get existing processed files
  const existingIds = await getProcessedFileIds(channel, threadTs);

  // Merge with new file IDs (deduplicate)
  const allProcessedIds = [...new Set([...existingIds, ...fileIds])];

  const data: ProcessedData = {
    processedFileIds: allProcessedIds,
    lastUpdated: new Date().toISOString(),
  };

  await put(key, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
  });
}

// Filter out already processed files
export function filterUnprocessedFiles<T extends { id: string }>(
  files: T[],
  processedFileIds: string[]
): T[] {
  const processedSet = new Set(processedFileIds);
  return files.filter((file) => !processedSet.has(file.id));
}
