import type { PluginTicket } from "@worldwideview/wwv-plugin-sdk";
import { decryptCredential } from "@/lib/auth/encryption";
import { prisma as db } from "@/lib/db";

interface CacheEntry {
    ticket: PluginTicket;
    /** Unix ms — the ticket is considered stale 30s before the 5-min expiry */
    expiresAt: number;
}

const TICKET_LIFETIME_MS = 4.5 * 60 * 1000; // refresh 30s before the 5-min expiry

// Per ADR-001B: audience = the Data Engine's ENGINE_ID (default "wwv-data-engine").
// Per-engine audiences (true multi-engine decentralisation) are a follow-up.
const ENGINE_AUDIENCE = "wwv-data-engine";

// Cache is keyed by audience, not pluginId — the ticket is user/engine-scoped.
// All plugins on the same engine share one ticket, avoiding redundant exchange calls.
const cache = new Map<string, CacheEntry>();

function getMarketplaceUrl(): string {
    return (
        process.env.MARKETPLACE_URL ||
        process.env.NEXT_PUBLIC_WWV_MARKETPLACE_URL ||
        "https://app.worldwideview.dev"
    );
}

async function fetchTicket(pluginId: string): Promise<PluginTicket> {
    const cred = await db.marketplaceCredential.findUnique({
        where: { tenantId: "local" },
    });
    if (!cred) {
        throw new Error(`[ticketClient] No marketplace credential found. Complete the PKCE flow first.`);
    }

    const apiKey = await decryptCredential(cred);
    const url = `${getMarketplaceUrl()}/api/auth/exchange`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // apiKey camelCase — matches the Marketplace /api/auth/exchange destructure.
        // audience = engine ID per ADR-001B, not pluginId.
        // plugin_id retained for future Marketplace entitlement scoping.
        body: JSON.stringify({ apiKey, audience: ENGINE_AUDIENCE, plugin_id: pluginId }),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`[ticketClient] Token exchange failed (${response.status}): ${body}`);
    }

    const data = await response.json() as { token?: string };
    if (!data.token) {
        throw new Error("[ticketClient] Token exchange response missing 'token' field.");
    }

    return data.token as PluginTicket;
}

/**
 * Returns a short-lived PluginTicket for the given plugin ID.
 * Results are cached by engine audience; the ticket is refreshed 30s before expiry (4.5-min window).
 */
export async function getTicket(pluginId: string): Promise<PluginTicket> {
    const cached = cache.get(ENGINE_AUDIENCE);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.ticket;
    }

    const ticket = await fetchTicket(pluginId);
    cache.set(ENGINE_AUDIENCE, { ticket, expiresAt: Date.now() + TICKET_LIFETIME_MS });
    return ticket;
}
