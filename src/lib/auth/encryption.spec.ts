/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { encryptCredential, decryptCredential } from "./encryption";

describe("AES-256-GCM Encryption with PBKDF2", () => {
    beforeAll(() => { process.env.ENCRYPTION_MASTER_KEY = "test-master-key-32-chars-padding!!"; });
    afterAll(() => { delete process.env.ENCRYPTION_MASTER_KEY; });
    it("should correctly encrypt and decrypt a string", async () => {
        const secret = "my-super-secret-api-key";

        const encrypted = await encryptCredential(secret);
        expect(encrypted).toHaveProperty("version", "v1");
        expect(encrypted).toHaveProperty("salt");
        expect(encrypted).toHaveProperty("nonce");
        expect(encrypted).toHaveProperty("ciphertext");

        const decrypted = await decryptCredential(encrypted);
        expect(decrypted).toBe(secret);
    });

    it("should fail to decrypt with wrong payload", async () => {
        const secret = "secret";
        const encrypted = await encryptCredential(secret);

        const tampered = { ...encrypted as any, ciphertext: `tampered.${(encrypted as any).ciphertext.split(".")[1]}` };

        await expect(decryptCredential(tampered)).rejects.toThrow();
    });

    it("should throw on corrupted data", async () => {
        const encrypted = await encryptCredential("test-secret");
        const corrupted = { ...encrypted, ciphertext: "invalid-base64-or-corrupted" };
        await expect(decryptCredential(corrupted)).rejects.toThrow();
    });
});
