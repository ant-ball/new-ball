import {
  formatInplaySelectionLabel,
  formatPreSelectionLabel,
  getMarketDisplayLabel,
  parseCorrectScoreLabel,
  resolveCorrectScoreDirection,
} from './marketDisplay';

const MAIN_MARKETS = [
  { key: '938_asian_handicap', rows: 2 },
  { key: '981_goals_over_under', rows: 2 },
  { key: '40_full_time_result', rows: 3 },
];

const PRE_CORRECT_SCORE_MARKETS = [
  '43_correct_score',
  '10540_half_time_correct_score',
];

const ROLLING_CORRECT_SCORE_MARKET_IDS = new Set(['10001', '10561', '50275', '50590', '50591']);

const ROLLING_MARKET_PRIORITY = {
  '10147': 10,
  '10148': 11,
  '10115': 12,
  '10560': 13,
  '10001': 14,
  '10561': 15,
  '50275': 16,
  '50590': 17,
  '50591': 18,
};

function oddsValue(value) {
  if (value == null) return '-';
  const text = String(value).trim();
  return text === '' ? '-' : text;
}

function getStableKey(...parts) {
  return parts
    .map((part) => String(part ?? '').trim())
    .join('__');
}

function getMarketId(marketKey) {
  if (marketKey == null || marketKey === '') return '';
  return String(marketKey).split('_')[0] || '';
}

function resolveCorrectScoreBucket(direction, label) {
  if (direction === '1') return 'home';
  if (direction === '2') return 'away';
  if (direction === 'X') return 'draw';

  const score = parseCorrectScoreLabel(label);
  if (!score) return 'draw';
  if (Number(score.home) > Number(score.away)) return 'home';
  if (Number(score.home) < Number(score.away)) return 'away';
  return 'draw';
}

function interleaveCorrectScoreItems(items, getDirection) {
  const columns = {
    home: [],
    draw: [],
    away: [],
  };

  items.forEach((item) => {
    const bucket = resolveCorrectScoreBucket(getDirection(item), item?.label);
    columns[bucket].push(item);
  });

  const ordered = [];
  const maxLength = Math.max(columns.home.length, columns.draw.length, columns.away.length);

  for (let index = 0; index < maxLength; index += 1) {
    if (columns.home[index]) ordered.push(columns.home[index]);
    if (columns.draw[index]) ordered.push(columns.draw[index]);
    if (columns.away[index]) ordered.push(columns.away[index]);
  }

  return ordered;
}

function getOrderedRollingMarkets(treeResults) {
  return (Array.isArray(treeResults) ? treeResults : [])
    .map((mavo, index) => ({ mavo, index }))
    .filter(({ mavo }) => {
      const options = (mavo?.co ?? []).flatMap((co) => co?.pa || []);
      return options.some((pa) => {
        const name = pa?.na ?? pa?.NA ?? pa?.pNa ?? '';
        return String(name).trim() !== '';
      });
    })
    .sort((left, right) => {
      const leftId = left.mavo?.id != null ? String(left.mavo.id) : left.mavo?.ID != null ? String(left.mavo.ID) : '';
      const rightId = right.mavo?.id != null ? String(right.mavo.id) : right.mavo?.ID != null ? String(right.mavo.ID) : '';
      const leftPriority = Object.prototype.hasOwnProperty.call(ROLLING_MARKET_PRIORITY, leftId) ? ROLLING_MARKET_PRIORITY[leftId] : 999;
      const rightPriority = Object.prototype.hasOwnProperty.call(ROLLING_MARKET_PRIORITY, rightId) ? ROLLING_MARKET_PRIORITY[rightId] : 999;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.index - right.index;
    })
    .map(({ mavo }) => mavo);
}

function buildPreItem(match, marketKey, item, label, oddsObj) {
  const direction = resolveCorrectScoreDirection(item?.team ?? item?.header, match);
  const displayLabel = item?.displayLabel || formatPreSelectionLabel(match, marketKey, item);
  return {
    id: item?.id ?? item?.ID ?? getStableKey(marketKey, item?.header, item?.name, item?.handicap, item?.odds ?? item?.OD ?? item?.od ?? item?.price),
    label: displayLabel,
    odds: oddsValue(item?.odds ?? item?.OD ?? item?.od ?? item?.price),
    suspended: false,
    raw: item,
    correctScoreDirection: direction,
    pickPayload: {
      type: 'pre',
      match,
      marketKey,
      label,
      item: {
        ...item,
        displayLabel,
        correctScoreDirection: direction,
        odds: oddsValue(item?.odds ?? item?.OD ?? item?.od ?? item?.price),
      },
      oddsObj,
      betPlayId: String(getMarketId(marketKey)),
      betPlayName: String(marketKey).split('_').slice(1).join('_'),
      bigTypeName: label,
    },
  };
}

function buildInplayItem(match, mavo, pa) {
  const odds = oddsValue(pa?.od ?? pa?.OD);
  const odDecimal = Number.parseFloat(pa?.od ?? pa?.OD);
  const suspended = String(pa?.od ?? pa?.OD ?? '').trim() === '' || String(pa?.od ?? pa?.OD ?? '').trim() === '-';
  const direction = resolveCorrectScoreDirection(pa?.pNa ?? pa?.n2 ?? pa?.N2 ?? pa?.ha ?? pa?.HA, match);
  const label = formatInplaySelectionLabel(match, mavo, pa);

  return {
    id: pa?.id ?? pa?.ID ?? getStableKey(mavo?.id, mavo?.ID, pa?.na, pa?.NA, pa?.pNa, pa?.ha, pa?.HA, pa?.od, pa?.OD),
    label,
    odds,
    suspended,
    raw: pa,
    correctScoreDirection: direction,
    pickPayload: {
      type: 'inplay',
      match,
      mavo,
      pa: { ...pa, displayLabel: label, correctScoreDirection: direction },
      odDecimal,
    },
  };
}

function buildMainColumn(match, marketKey, limit = 3) {
  const oddsObj = match?.odds?.[marketKey];
  const list = Array.isArray(oddsObj?.odds) ? oddsObj.odds : [];
  const label = getMarketDisplayLabel(marketKey, oddsObj?.name ?? '玩法');
  return {
    key: marketKey,
    label,
    items: list.slice(0, limit).map((item) => buildPreItem(match, marketKey, item, label, oddsObj)),
  };
}

function buildRollingColumns(match, associationMap, limit = 6) {
  return getOrderedRollingMarkets(match?.treeResults).slice(0, limit).map((mavo) => {
    const marketId = mavo?.id ?? mavo?.ID;
    const label = getMarketDisplayLabel(
      marketId,
      associationMap?.get(5)?.get(String(marketId ?? ''))?.betName || (mavo?.na ?? mavo?.NA ?? '玩法'),
    );

    return {
      id: marketId ?? getStableKey(match?.id, match?.bet365Id, mavo?.na, mavo?.NA),
      title: label,
      options: (mavo?.co ?? []).flatMap((c) => c.pa || []).slice(0, 6).map((pa) => buildInplayItem(match, mavo, pa)),
    };
  });
}

function buildCorrectScoreSections(match, isRolling) {
  if (isRolling) {
    return getOrderedRollingMarkets(match?.treeResults)
      .filter((mavo) => ROLLING_CORRECT_SCORE_MARKET_IDS.has(String(mavo?.id ?? mavo?.ID ?? '')))
      .map((mavo) => ({
        key: String(mavo?.id ?? mavo?.ID ?? ''),
        label: getMarketDisplayLabel(mavo?.id ?? mavo?.ID, mavo?.na ?? mavo?.NA ?? '波胆'),
        items: interleaveCorrectScoreItems(
          (mavo?.co ?? []).flatMap((c) => c.pa || []).map((pa) => buildInplayItem(match, mavo, pa)),
          (item) => item?.correctScoreDirection,
        ),
      }))
      .filter((section) => section.items.length > 0);
  }

  return PRE_CORRECT_SCORE_MARKETS.map((marketKey) => {
    const oddsObj = match?.odds?.[marketKey];
    const list = Array.isArray(oddsObj?.odds) ? oddsObj.odds : [];
    const label = getMarketDisplayLabel(marketKey, oddsObj?.name ?? '波胆');
    return {
      key: marketKey,
      label,
      items: interleaveCorrectScoreItems(
        list.map((item) => buildPreItem(match, marketKey, item, label, oddsObj)),
        (entry) => entry?.correctScoreDirection,
      ),
    };
  }).filter((section) => section.items.length > 0);
}

function buildMarketSections(match, isRolling, associationMap) {
  if (isRolling) {
    return getOrderedRollingMarkets(match?.treeResults).map((mavo) => {
      const marketId = mavo?.id ?? mavo?.ID;
      return {
        key: String(marketId ?? ''),
        label: getMarketDisplayLabel(
          marketId,
          associationMap?.get(5)?.get(String(marketId ?? ''))?.betName || (mavo?.na ?? mavo?.NA ?? '玩法'),
        ),
        items: (mavo?.co ?? []).flatMap((c) => c.pa || []).map((pa) => buildInplayItem(match, mavo, pa)),
      };
    }).filter((section) => section.items.length > 0);
  }

  return Object.entries(match?.odds ?? {})
    .map(([marketKey, oddsObj]) => {
      const list = Array.isArray(oddsObj?.odds) ? oddsObj.odds : [];
      const label = getMarketDisplayLabel(marketKey, oddsObj?.name ?? '玩法');
      return {
        key: marketKey,
        label,
        items: list.map((item) => buildPreItem(match, marketKey, item, label, oddsObj)),
      };
    })
    .filter((section) => section.items.length > 0);
}

export {
  MAIN_MARKETS,
  PRE_CORRECT_SCORE_MARKETS,
  ROLLING_CORRECT_SCORE_MARKET_IDS,
  buildCorrectScoreSections,
  buildMainColumn,
  buildMarketSections,
  buildRollingColumns,
  getOrderedRollingMarkets,
};
