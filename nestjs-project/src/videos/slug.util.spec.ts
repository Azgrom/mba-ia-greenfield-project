import { generateSlug } from './slug.util';

describe('slug.util', () => {
  describe('generateSlug', () => {
    it('returns a URL-safe base64 string', () => {
      const slug = generateSlug();
      expect(typeof slug).toBe('string');
      // URL-safe base64 contains only alphanumeric, -, and _
      expect(/^[A-Za-z0-9_-]+$/.test(slug)).toBe(true);
    });

    it('returns an 11-character string (8 bytes encoded in base64url)', () => {
      const slug = generateSlug();
      expect(slug.length).toBe(11);
    });

    it('generates different slugs on multiple calls', () => {
      const slug1 = generateSlug();
      const slug2 = generateSlug();
      expect(slug1).not.toBe(slug2);
    });
  });
});
