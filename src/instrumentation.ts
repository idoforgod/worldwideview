import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast at boot — prevents silent zero-key encryption (ADR-001C / Verification §7).
    if (!process.env.ENCRYPTION_MASTER_KEY) {
      throw new Error("[startup] ENCRYPTION_MASTER_KEY is not set. The server cannot start without it.");
    }
    if (!process.env.AUTH_SECRET) {
      throw new Error("[startup] AUTH_SECRET is not set. The server cannot start without it.");
    }
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Capture errors from Server Components, middleware, and proxies
export const onRequestError = Sentry.captureRequestError;
