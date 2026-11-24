import type { ModelSelectGroup, ModelSelectGroupItem } from "@/ModelConfigSelect.js";

function normaliseQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

/** Search across the visible model identity, not just the display name. */
export function modelSelectItemMatches(item: ModelSelectGroupItem, query: string): boolean {
  const needle = normaliseQuery(query);
  if (!needle) return true;
  return `${item.name} ${item.detail ?? ""} ${item.value}`.toLocaleLowerCase().includes(needle);
}

export function filterModelSelectItems(
  items: readonly ModelSelectGroupItem[],
  query: string,
): ModelSelectGroupItem[] {
  if (!normaliseQuery(query)) return [...items];
  return items.filter((item) => modelSelectItemMatches(item, query));
}

/** Keep provider groups that still have a match; an empty query is a no-op. */
export function filterModelSelectGroups(
  groups: readonly ModelSelectGroup[],
  query: string,
): ModelSelectGroup[] {
  if (!normaliseQuery(query)) return [...groups];
  return groups
    .map((group) => ({ ...group, items: filterModelSelectItems(group.items, query) }))
    .filter((group) => group.items.length > 0);
}

/** Slider position for a level value; unknown values fall back to the lowest level. */
export function reasoningLevelIndex(levels: readonly string[], value: string | undefined): number {
  if (levels.length === 0) return 0;
  const index = levels.findIndex((level) => level === value);
  return index < 0 ? 0 : index;
}

export function reasoningLevelValue(
  levels: readonly string[],
  index: number,
): string | undefined {
  if (levels.length === 0) return undefined;
  return levels[Math.min(Math.max(index, 0), levels.length - 1)];
}
