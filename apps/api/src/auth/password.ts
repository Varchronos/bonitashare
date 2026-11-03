import argon2 from 'argon2';

export const PASSWORD_MIN_LENGTH = 8;
// argon2 hashes whatever it's given, so an unbounded password is a cheap way to burn server CPU.
export const PASSWORD_MAX_LENGTH = 128;

// argon2id with the library's defaults; the parameters are encoded in the hash, so raising them later
// doesn't break existing ones.
export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);

/* 
For a login whose email has no account (or no password in potential rare case): checking against this costs as long as a
 real verify, so response time doesn't reveal which emails are registered. Always false.
*/
let dummyHash: Promise<string> | undefined;
export async function verifyNothing(password: string): Promise<false> {
    dummyHash ??= hashPassword('no account has this password');
    await verifyPassword(await dummyHash, password).catch(() => false);
    return false;
}
