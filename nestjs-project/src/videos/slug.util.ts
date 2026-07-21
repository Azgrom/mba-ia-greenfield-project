import { randomBytes } from 'crypto';

export function generateSlug(): string {
  return randomBytes(8).toString('base64url');
}
