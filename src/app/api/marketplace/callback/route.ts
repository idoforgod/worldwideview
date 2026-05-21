import { NextRequest, NextResponse } from "next/server";
import * as client from "openid-client";
import { encryptCredential } from "@/lib/auth/encryption";
import { prisma as db } from "@/lib/db";

export async function GET(req: NextRequest) {
    const isHttps = req.nextUrl.protocol === "https:";
    const cookiePrefix = isHttps ? "__Host-" : "";

    const stateCookie = req.cookies.get(`${cookiePrefix}pkce_state`)?.value;
    const verifierCookie = req.cookies.get(`${cookiePrefix}pkce_verifier`)?.value;
    const urlState = req.nextUrl.searchParams.get("state");

    if (!stateCookie || urlState !== stateCookie) {
        return NextResponse.json({ error: "State mismatch" }, { status: 400 });
    }

    if (!verifierCookie) {
        return NextResponse.json({ error: "Missing code_verifier" }, { status: 400 });
    }

    const marketplaceUrl = process.env.NEXT_PUBLIC_WWV_MARKETPLACE_URL || "https://app.worldwideview.dev";
    const issuer = new URL(marketplaceUrl);
    const config = new client.Configuration(
        {
            issuer: issuer.toString(),
            authorization_endpoint: new URL("/oauth/authorize", issuer).toString(),
            token_endpoint: new URL("/api/oauth/token", issuer).toString(),
        },
        "local-app",
    );

    try {
        const tokens = await client.authorizationCodeGrant(
            config,
            new URL(req.url),
            { expectedState: stateCookie, pkceCodeVerifier: verifierCookie }
        );

        if (tokens.access_token) {
            const encrypted = await encryptCredential(tokens.access_token);
            await db.marketplaceCredential.upsert({
                where: { tenantId: "local" },
                update: {
                    version: encrypted.version,
                    salt: encrypted.salt,
                    nonce: encrypted.nonce,
                    ciphertext: encrypted.ciphertext
                },
                create: {
                    tenantId: "local",
                    version: encrypted.version,
                    salt: encrypted.salt,
                    nonce: encrypted.nonce,
                    ciphertext: encrypted.ciphertext
                }
            });
        }
    } catch (err) {
        console.error("[PKCE] Exchange failed:", err instanceof Error ? err.message : String(err));
        return NextResponse.json({ error: "Failed to exchange authorization code" }, { status: 500 });
    }

    const res = NextResponse.redirect(new URL("/", req.nextUrl.origin), 302);

    res.cookies.set(`${cookiePrefix}pkce_state`, "", {
        httpOnly: true,
        secure: isHttps,
        sameSite: "lax",
        path: "/api/marketplace/callback",
        maxAge: 0
    });

    res.cookies.set(`${cookiePrefix}pkce_verifier`, "", {
        httpOnly: true,
        secure: isHttps,
        sameSite: "lax",
        path: "/api/marketplace/callback",
        maxAge: 0
    });

    return res;
}
