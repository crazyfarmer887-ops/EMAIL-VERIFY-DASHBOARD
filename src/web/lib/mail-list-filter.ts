export interface SearchableMailAlias {
  id: number | string;
  email: string;
  note?: string | null;
}

export function filterMailAliases<T extends SearchableMailAlias>(
  aliases: readonly T[],
  selectedCategory: string,
  searchText: string,
  getDisplayName: (alias: T) => string,
): T[] {
  const query = searchText.trim().toLocaleLowerCase('ko-KR');

  return aliases.filter(alias => {
    const displayName = getDisplayName(alias);
    const matchesCategory = selectedCategory === '전체' || displayName.startsWith(selectedCategory);
    if (!matchesCategory) return false;
    if (!query) return true;

    return [displayName, alias.email, String(alias.id), alias.note ?? '']
      .some(value => value.toLocaleLowerCase('ko-KR').includes(query));
  });
}
