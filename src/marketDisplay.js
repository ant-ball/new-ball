import {
  COMBINED_RESULT_MARKET_IDS,
  CORRECT_SCORE_MARKET_IDS,
  DOUBLE_CHANCE_MARKET_IDS,
  GOAL_LINE_MARKET_IDS,
  HANDICAP_MARKET_IDS,
  MARKET_LABELS,
  TEAM_TYPE_CODE_ALIASES,
  translateMarketTitle,
  translateRawSelectionLabel,
} from './marketMapping';

function getHomeName(match) {
  return (
    match?.homeNameCN ||
    match?.homeNameEN ||
    match?.homeTeamName ||
    match?.team1Name ||
    match?.home ||
    match?.homeName ||
    '主队'
  );
}

function getAwayName(match) {
  return (
    match?.awayNameCN ||
    match?.awayNameEN ||
    match?.awayTeamName ||
    match?.team2Name ||
    match?.away ||
    match?.awayName ||
    '客队'
  );
}

function getMarketId(marketKey) {
  if (marketKey == null || marketKey === '') return '';
  return String(marketKey).split('_')[0] || '';
}

function getMatchTeamNames(match) {
  return {
    home: [getHomeName(match), match?.homeNameEN, match?.homeTeamName, match?.homeName, match?.oHomeName]
      .filter((value) => value != null && String(value).trim() !== '')
      .map((value) => String(value).trim().toLowerCase()),
    away: [getAwayName(match), match?.awayNameEN, match?.awayTeamName, match?.awayName, match?.oAwayName]
      .filter((value) => value != null && String(value).trim() !== '')
      .map((value) => String(value).trim().toLowerCase()),
  };
}

function normalizeTeamType(value, match) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return '';
  if (TEAM_TYPE_CODE_ALIASES[raw]) return TEAM_TYPE_CODE_ALIASES[raw];

  const lower = raw.toLowerCase();
  const { home, away } = getMatchTeamNames(match);
  if (home.includes(lower)) return '1';
  if (away.includes(lower)) return '2';
  if (lower === 'draw') return 'X';

  return raw;
}

function normalizeCompositeTeamType(value, match) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return '';

  let parts = null;
  if (raw.includes(' - ')) {
    parts = raw.split(' - ');
  } else if (/\s+or\s+/i.test(raw)) {
    parts = raw.split(/\s+or\s+/i);
  } else if (raw.includes('/')) {
    parts = raw.split('/');
  } else if (raw.includes('&')) {
    parts = raw.split('&');
  }
  if (!parts || parts.length !== 2) return '';

  const left = normalizeTeamType(parts[0], match);
  const right = normalizeTeamType(parts[1], match);
  const valid = new Set(['1', '2', 'X']);
  if (!valid.has(left) || !valid.has(right)) return '';
  return `${left}&${right}`;
}

function isHandicapMarket(marketKey) {
  return HANDICAP_MARKET_IDS.has(getMarketId(marketKey));
}

function isGoalLineMarket(marketKey) {
  return GOAL_LINE_MARKET_IDS.has(getMarketId(marketKey));
}

function isDoubleChanceMarket(marketKey) {
  return DOUBLE_CHANCE_MARKET_IDS.has(getMarketId(marketKey));
}

function isCombinedResultMarket(marketKey) {
  return COMBINED_RESULT_MARKET_IDS.has(getMarketId(marketKey));
}

function isCorrectScoreMarket(marketKey) {
  return CORRECT_SCORE_MARKET_IDS.has(getMarketId(marketKey));
}

function parseCorrectScoreLabel(label) {
  const normalized = String(label ?? '').trim();
  const matched = normalized.match(/^(\d+)\s*[-:]\s*(\d+)$/);

  if (!matched) {
    return null;
  }

  return {
    home: matched[1],
    away: matched[2],
  };
}

function resolveCorrectScoreDirection(value, match) {
  const normalized = normalizeTeamType(value, match);
  return normalized === '1' || normalized === '2' || normalized === 'X' ? normalized : '';
}

function formatCorrectScoreLabel(rawScore, direction) {
  const score = parseCorrectScoreLabel(rawScore);

  if (!score) {
    return String(rawScore ?? '').trim() || '-';
  }

  if (direction === '2') {
    return `${score.away}-${score.home}`;
  }

  return `${score.home}-${score.away}`;
}

function getSelectionLabelByTeamType(teamType, match) {
  const combo = teamType != null ? String(teamType).split('&') : [];
  if (combo.length === 2) {
    const valid = new Set(['1', '2', 'X']);
    const [left, right] = combo;
    if (valid.has(left) && valid.has(right)) {
      return `${getSelectionLabelByTeamType(left, match)} / ${getSelectionLabelByTeamType(right, match)}`;
    }
  }

  switch (teamType) {
    case '1':
      return '主';
    case '2':
      return '客';
    case 'X':
      return '平';
    case 'Over':
      return 'Over';
    case 'Under':
      return 'Under';
    case 'Exactly':
      return '等于';
    case 'Yes':
      return '是';
    case 'No':
      return '否';
    case 'Odd':
      return '单';
    case 'Even':
      return '双';
    default:
      return teamType;
  }
}

function getPreTeamType(marketKey, item, match) {
  const headerCode = normalizeTeamType(item?.header, match);
  const nameCode = normalizeTeamType(item?.name, match);
  const comboCode = (isCombinedResultMarket(marketKey) || isDoubleChanceMarket(marketKey))
    ? normalizeCompositeTeamType(item?.name ?? item?.header, match)
    : '';

  if (isCorrectScoreMarket(marketKey)) {
    const score = item?.name != null ? String(item.name).trim() : '';
    return headerCode && score ? `${headerCode}&${score}` : headerCode || score;
  }

  return comboCode || headerCode || nameCode;
}

function getInplayTeamType(mavo, pa, match) {
  const marketKey = mavo?.id ?? mavo?.ID;
  const paName = pa?.na ?? pa?.NA ?? pa?.pNa ?? '';
  const comboCode = (isCombinedResultMarket(marketKey) || isDoubleChanceMarket(marketKey))
    ? normalizeCompositeTeamType(paName, match)
    : '';

  if (isCorrectScoreMarket(marketKey)) {
    const scoreHeader = normalizeTeamType(pa?.ha ?? pa?.HA, match);
    const score = paName != null ? String(paName).trim() : '';
    return scoreHeader && score ? `${scoreHeader}&${score}` : scoreHeader || score;
  }

  return comboCode || normalizeTeamType(paName, match);
}

function formatPreSelectionLabel(match, marketKey, item) {
  const headerCode = normalizeTeamType(item?.header, match);
  const nameCode = normalizeTeamType(item?.name, match);
  const comboCode = (isCombinedResultMarket(marketKey) || isDoubleChanceMarket(marketKey))
    ? normalizeCompositeTeamType(item?.name ?? item?.header, match)
    : '';
  const selectionCode = comboCode || headerCode || nameCode;
  const selectionLabel = getSelectionLabelByTeamType(selectionCode, match);
  const handicap = item?.handicap != null ? String(item.handicap).trim() : '';
  const nameText = item?.name != null ? String(item.name).trim() : '';
  const translatedName = translateRawSelectionLabel(nameText);

  if (isHandicapMarket(marketKey)) {
    if (selectionLabel && handicap) return `${selectionLabel} (${handicap})`;
    return selectionLabel || handicap || nameText || '-';
  }

  if (isGoalLineMarket(marketKey)) {
    if (selectionLabel && nameText) return `${selectionLabel} ${nameText}`;
    return selectionLabel || nameText || handicap || '-';
  }

  if (isCorrectScoreMarket(marketKey)) {
    const direction = resolveCorrectScoreDirection(item?.team ?? item?.header, match);
    return formatCorrectScoreLabel(nameText, direction);
  }

  if (isDoubleChanceMarket(marketKey) || isCombinedResultMarket(marketKey)) {
    return selectionLabel || translatedName || nameText || '-';
  }

  if (selectionLabel && nameText && normalizeTeamType(nameText, match) === selectionCode) {
    return selectionLabel;
  }

  if (selectionLabel && nameText && selectionCode !== nameText) {
    return `${selectionLabel} ${nameText}`;
  }

  return selectionLabel || translatedName || nameText || handicap || '-';
}

function formatInplaySelectionLabel(match, mavo, pa) {
  const rawName = pa?.na ?? pa?.NA ?? pa?.pNa ?? '';
  const marketKey = mavo?.id ?? mavo?.ID;
  const scoreHeader = isCorrectScoreMarket(marketKey)
    ? resolveCorrectScoreDirection(pa?.pNa ?? pa?.n2 ?? pa?.N2 ?? pa?.ha ?? pa?.HA, match)
    : '';
  const comboCode = (isCombinedResultMarket(marketKey) || isDoubleChanceMarket(marketKey))
    ? normalizeCompositeTeamType(rawName, match)
    : '';
  const teamType = scoreHeader || comboCode || normalizeTeamType(rawName, match);
  const selectionLabel = getSelectionLabelByTeamType(teamType, match) || String(rawName || '').trim();
  const handicap = pa?.ha ?? pa?.HA;
  const translatedName = translateRawSelectionLabel(rawName);

  if (isHandicapMarket(marketKey)) {
    const handicapText = handicap != null ? String(handicap).trim() : '';
    if (selectionLabel && handicapText) return `${selectionLabel} (${handicapText})`;
    return selectionLabel || handicapText || '-';
  }

  if (isGoalLineMarket(marketKey)) {
    const handicapText = handicap != null ? String(handicap).trim() : '';
    if (selectionLabel && handicapText) return `${selectionLabel} ${handicapText}`;
    return selectionLabel || handicapText || '-';
  }

  if (isCorrectScoreMarket(marketKey)) {
    return formatCorrectScoreLabel(rawName, scoreHeader);
  }

  if (isDoubleChanceMarket(marketKey) || isCombinedResultMarket(marketKey)) {
    return selectionLabel || translatedName || String(rawName || '').trim() || '-';
  }

  return translatedName || selectionLabel || '-';
}

function getMarketDisplayLabel(marketKey, fallback = '玩法') {
  if (marketKey == null || marketKey === '') return translateMarketTitle(fallback) || fallback;
  const direct = MARKET_LABELS.get(String(marketKey));
  if (direct) return direct;
  const byId = MARKET_LABELS.get(getMarketId(marketKey));
  return byId || translateMarketTitle(fallback) || fallback;
}

export {
  formatCorrectScoreLabel,
  formatInplaySelectionLabel,
  formatPreSelectionLabel,
  getInplayTeamType,
  getMarketDisplayLabel,
  getPreTeamType,
  parseCorrectScoreLabel,
  resolveCorrectScoreDirection,
  normalizeTeamType,
};
