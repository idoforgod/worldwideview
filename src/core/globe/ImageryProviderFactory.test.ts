import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock cesium before importing the module under test
vi.mock("cesium", () => {
    class UrlTemplateImageryProvider {
        _type = "UrlTemplate";
        url: string;
        constructor(opts: any) { this.url = opts.url; }
    }

    const BingMapsImageryProvider = {
        fromUrl: vi.fn().mockResolvedValue({ _type: "Bing" }),
    };

    const IonImageryProvider = {
        fromAssetId: vi.fn().mockResolvedValue({ _type: "Ion" }),
    };

    const ArcGisMapServerImageryProvider = {
        fromUrl: vi.fn().mockResolvedValue({ _type: "ArcGis" }),
    };

    return {
        Ion: { defaultAccessToken: undefined },
        IonImageryProvider,
        BingMapsImageryProvider,
        ArcGisMapServerImageryProvider,
        UrlTemplateImageryProvider,
        BingMapsStyle: { AERIAL: "Aerial", AERIAL_WITH_LABELS: "AerialWithLabels", ROAD: "Road" },
    };
});

import { Ion, IonImageryProvider } from "cesium";
import { createImageryProvider, createOsmProvider } from "./ImageryProviderFactory";

beforeEach(() => {
    vi.clearAllMocks();
    (Ion as any).defaultAccessToken = undefined;
    delete process.env.NEXT_PUBLIC_BING_MAPS_KEY;
});

describe("createOsmProvider", () => {
    it("returns a UrlTemplateImageryProvider for OSM tiles", () => {
        const provider = createOsmProvider();
        expect(provider).toBeDefined();
        expect((provider as any).url).toContain("openstreetmap.org");
    });
});

describe("createImageryProvider", () => {
    it("returns OSM when bing-aerial requested with no Bing key and no Ion token", async () => {
        const provider = await createImageryProvider("bing-aerial");
        expect((provider as any).url).toContain("openstreetmap.org");
        expect(IonImageryProvider.fromAssetId).not.toHaveBeenCalled();
    });

    it("returns OSM when bing-labels requested with no keys", async () => {
        const provider = await createImageryProvider("bing-labels");
        expect((provider as any).url).toContain("openstreetmap.org");
    });

    it("returns OSM when bing-road requested with no keys", async () => {
        const provider = await createImageryProvider("bing-road");
        expect((provider as any).url).toContain("openstreetmap.org");
    });

    it("returns OSM when blue-marble requested with no Ion token", async () => {
        const provider = await createImageryProvider("blue-marble");
        expect((provider as any).url).toContain("openstreetmap.org");
    });

    it("uses Ion when defaultAccessToken is set", async () => {
        (Ion as any).defaultAccessToken = "test-token";
        const provider = await createImageryProvider("bing-aerial");
        expect(IonImageryProvider.fromAssetId).toHaveBeenCalledWith(2);
        expect((provider as any)._type).toBe("Ion");
    });

    it("uses Bing directly when NEXT_PUBLIC_BING_MAPS_KEY is set", async () => {
        process.env.NEXT_PUBLIC_BING_MAPS_KEY = "test-bing-key";
        const { BingMapsImageryProvider } = await import("cesium");
        const provider = await createImageryProvider("bing-aerial");
        expect(BingMapsImageryProvider.fromUrl).toHaveBeenCalled();
        expect((provider as any)._type).toBe("Bing");
    });

    it("returns OSM for 'osm' layer directly", async () => {
        const provider = await createImageryProvider("osm");
        expect((provider as any).url).toContain("openstreetmap.org");
    });

    it("returns OSM for unknown layer ids", async () => {
        const provider = await createImageryProvider("nonexistent-layer");
        expect((provider as any).url).toContain("openstreetmap.org");
    });
});
