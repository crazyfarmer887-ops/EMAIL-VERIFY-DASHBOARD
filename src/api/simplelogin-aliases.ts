export type SimpleLoginAlias = { id?: number | string; email?: string; [key: string]: unknown };
export type SimpleLoginAliasPage = { aliases?: SimpleLoginAlias[]; error?: unknown; [key: string]: unknown };

type FetchAliasPage = (page: number) => Promise<SimpleLoginAliasPage>;

export async function fetchAllSimpleLoginAliases(
  fetchPage: FetchAliasPage,
  options: { startPage?: number; maxPages?: number } = {},
) {
  const startPage = Math.max(0, options.startPage ?? 0);
  const maxPages = Math.max(1, options.maxPages ?? 20);
  const aliases: SimpleLoginAlias[] = [];
  let firstPageData: SimpleLoginAliasPage | null = null;
  let pagesFetched = 0;

  for (let page = startPage; page < startPage + maxPages; page += 1) {
    const data = await fetchPage(page);
    if (!firstPageData) firstPageData = data;
    pagesFetched += 1;

    if (data?.error) return { ...data, aliases, pagesFetched };

    const pageAliases = Array.isArray(data?.aliases) ? data.aliases : [];
    aliases.push(...pageAliases);

    // SimpleLogin currently returns 20 aliases per page and does not expose a stable
    // "has more" flag here, so a short/empty page means we reached the end.
    if (pageAliases.length < 20) break;
  }

  return {
    ...(firstPageData || {}),
    aliases,
    pagesFetched,
    totalAliases: aliases.length,
  };
}
