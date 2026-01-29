import { put } from "@vercel/blob";

interface LogEntry {
  timestamp: string;
  level: "info" | "error" | "debug" | "warn";
  message: string;
  data?: unknown;
}

interface LogSession {
  sessionId: string;
  startTime: string;
  entries: LogEntry[];
}

// In-memory log buffer for current session
let currentSession: LogSession | null = null;

function getSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function startLogSession(context: string): string {
  const sessionId = getSessionId();
  currentSession = {
    sessionId,
    startTime: new Date().toISOString(),
    entries: [],
  };
  log("info", `Log session started: ${context}`, { context });
  return sessionId;
}

export function log(
  level: LogEntry["level"],
  message: string,
  data?: unknown
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data,
  };

  // Always console log
  const consoleMethod = level === "error" ? console.error : console.log;
  consoleMethod(`[${level.toUpperCase()}] ${message}`, data ?? "");

  // Add to session buffer
  if (currentSession) {
    currentSession.entries.push(entry);
  }
}

export async function flushLogs(): Promise<string | null> {
  if (!currentSession || currentSession.entries.length === 0) {
    return null;
  }

  const session = currentSession;
  currentSession = null;

  try {
    const logKey = `logs/${session.startTime.split("T")[0]}/${session.sessionId}.json`;
    const blob = await put(logKey, JSON.stringify(session, null, 2), {
      access: "public",
      addRandomSuffix: false,
    });
    console.log(`Logs saved to: ${blob.url}`);
    return blob.url;
  } catch (error) {
    console.error("Failed to save logs to blob:", error);
    return null;
  }
}

// Convenience methods
export const logger = {
  info: (message: string, data?: unknown) => log("info", message, data),
  error: (message: string, data?: unknown) => log("error", message, data),
  debug: (message: string, data?: unknown) => log("debug", message, data),
  warn: (message: string, data?: unknown) => log("warn", message, data),
  start: startLogSession,
  flush: flushLogs,
};
