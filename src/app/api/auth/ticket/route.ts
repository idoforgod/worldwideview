import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAuthEnabled } from "@/core/edition";
import { getTicket } from "@/lib/auth/ticketClient";

/**
 * GET /api/auth/ticket?pluginId=<id>
 * Returns a short-lived PluginTicket for the given plugin.
 * Used by WsClient (browser) to obtain auth tokens without DB access.
 */
export async function GET(req: NextRequest) {
    if (isAuthEnabled) {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
    }

    const pluginId = req.nextUrl.searchParams.get("pluginId");
    if (!pluginId) {
        return NextResponse.json({ error: "Missing pluginId" }, { status: 400 });
    }

    try {
        const token = await getTicket(pluginId);
        return NextResponse.json({ token });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[ticket-route]", message);
        return NextResponse.json({ error: "Failed to obtain plugin ticket" }, { status: 500 });
    }
}
