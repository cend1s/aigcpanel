import {
    createHash,
    randomBytes,
    scryptSync,
    timingSafeEqual,
} from "node:crypto";

export const hashPassword = (password: string): string => {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 64);
    return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
    const [scheme, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) {
        return false;
    }
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const newToken = (): string => randomBytes(32).toString("hex");

// Api-Token 只存哈希，库泄露时无法直接还原出可用 token
export const sha256 = (value: string): string =>
    createHash("sha256").update(value).digest("hex");
