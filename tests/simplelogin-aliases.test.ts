import { describe, expect, test } from 'vitest';
import { fetchAllSimpleLoginAliases } from '../src/api/simplelogin-aliases.ts';

describe('fetchAllSimpleLoginAliases', () => {
  test('continues past SimpleLogin first 20-alias page until a short page', async () => {
    const requestedPages: number[] = [];
    const page0 = Array.from({ length: 20 }, (_, i) => ({ id: i, email: `alias${i}@example.com` }));
    const page1 = [
      { id: 21, email: 'handgrip_sturdily209@simplelogin.com' },
      { id: 22, email: 'next@example.com' },
    ];

    const result = await fetchAllSimpleLoginAliases(async (page) => {
      requestedPages.push(page);
      return { aliases: page === 0 ? page0 : page === 1 ? page1 : [] };
    });

    expect(requestedPages).toEqual([0, 1]);
    expect(result.totalAliases).toBe(22);
    expect(result.aliases.map(a => a.email)).toContain('handgrip_sturdily209@simplelogin.com');
  });
});
