export function buildSlipItemKey(item) {
  return [
    item?.type,
    item?.eventId,
    item?.bet365Id,
    item?.timeType,
    item?.oddsMarkets,
    item?.betPlayId,
    item?.oddingId,
    item?.paId,
    item?.handicap,
  ]
    .map((part) => String(part ?? '').trim())
    .join('__');
}

export function appendOrReplaceSlipItem(previousItems, nextItem) {
  const nextKey = buildSlipItemKey(nextItem);
  const existingIndex = previousItems.findIndex((item) => item.key === nextKey);

  if (existingIndex < 0) {
    return [...previousItems, { ...nextItem, key: nextKey }];
  }

  return previousItems.map((item, index) => {
    if (index !== existingIndex) return item;
    return {
      ...item,
      ...nextItem,
      key: nextKey,
      stake: item.stake ?? '',
      win: item.win ?? nextItem.win,
    };
  });
}

export function getDuplicateSlipEventIds(items) {
  const counts = new Map();

  (Array.isArray(items) ? items : []).forEach((item) => {
    const eventId = String(item?.eventId ?? item?.bet365Id ?? '').trim();
    if (!eventId) return;
    counts.set(eventId, (counts.get(eventId) || 0) + 1);
  });

  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([eventId]) => eventId);
}
