// Primitivas de segurança: senhas (scrypt), tokens aleatórios e hashes.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// Token opaco de 256 bits; no banco fica só o hash.
export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Senha deve ter ao menos 12 caracteres.');
  }
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || typeof password !== 'string') return false;
  const [, N, r, p, salt, key] = parts;
  const expected = Buffer.from(key, 'base64url');
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Hash calculado contra uma senha descartável, para igualar o tempo de resposta de usuário inexistente.
export const DUMMY_HASH = hashPassword(randomBytes(18).toString('base64url'));
