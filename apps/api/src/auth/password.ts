import argon2 from 'argon2';

export const PASSWORD_MIN_LENGTH = 8;
// argon2 hashes whatever it's given, so an unbounded password is a cheap way to burn server CPU.
export const PASSWORD_MAX_LENGTH = 128;

// argon2id with the library's defaults; the parameters are encoded in the hash, so raising them later
// doesn't break existing ones.
export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);
