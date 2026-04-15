const MARKET_LABELS = new Map([
  ['40_full_time_result', '胜平负'],
  ['10114_double_chance', '双重机会'],
  ['10150_both_teams_to_score', 'BTTS（双方进球）'],
  ['42_half_time_full_time', '半全场'],
  ['10208_2nd_half_result', '下半场胜平负'],
  ['50433_2nd_half_goals_odd_even', '下半场进球单双'],
  ['1094_to_qualify', '晋级'],
  ['10116_to_win_the_trophy', '冠军'],
  ['938_asian_handicap', '让球'],
  ['981_goals_over_under', '大小球'],
  ['10143_goal_line', '球线'],
  ['43_correct_score', '波胆'],
  ['10540_half_time_correct_score', '半场波胆'],
  ['1579_half_time_result', '半场胜平负'],
  ['10257_half_time_double_chance', '半场双重机会'],
  ['760_corners', '角球大小球'],
  ['10539_first_half_corners', '半场角球大小球'],
  ['10164_asian_total_corners', '亚洲角球大小球'],
  ['10535_corner_handicap', '角球让球'],
  ['10165_asian_handicap_corners', '亚洲角球让球'],
  ['1175_corner_match_bet', '角球独赢'],
  ['1786', '晋级'],
  ['10115', '双重机会'],
  ['10560', '半全场'],
  ['50246', '下半场独赢'],
  ['50390', '上半场双方进球'],
  ['50391', '下半场双方进球'],
  ['50461', '赛果 / 双方进球'],
  ['10565', 'BTTS（双方进球）'],
  ['10147', '让球'],
  ['10148', '大小球'],
  ['10171', '半场大小球'],
  ['50285', '备选大小球'],
  ['10001', '波胆'],
  ['10561', '半场波胆'],
  ['50275', '点球波胆'],
  ['50590', '加时上半场波胆'],
  ['50591', '加时波胆'],
]);

const MARKET_TITLE_ALIASES = new Map([
  ['Fulltime Result', '胜平负'],
  ['Full Time Result', '胜平负'],
  ['Fulltime', '胜平负'],
  ['Match Result', '胜平负'],
  ['Double Chance', '双重机会'],
  ['Double', '双重机会'],
  ['Match', '大小球'],
  ['4th Goal', '第4球'],
  ['1st Goal', '第1球'],
  ['2nd Goal', '第2球'],
  ['3rd Goal', '第3球'],
  ['5th Goal', '第5球'],
  ['6th Goal', '第6球'],
  ['7th Goal', '第7球'],
  ['8th Goal', '第8球'],
  ['Anytime Goalscorer', '任意进球球员'],
  ['Both Teams To Score', '双方进球'],
  ['Both Teams to Score', '双方进球'],
  ['Correct Score', '波胆'],
  ['Final Score', '波胆'],
  ['Half Time Correct Score', '半场波胆'],
  ['Shootout Correct Score', '点球波胆'],
  ['Extra Time Half Time Correct Score', '加时上半场波胆'],
  ['Extra Time Correct Score', '加时波胆'],
  ['Match Goals', '大小球'],
  ['Goal Line', '大小球'],
  ['Asian Handicap', '让球'],
  ['Half Time Result', '半场胜平负'],
  ['Half Time Double Chance', '半场双重机会'],
  ['Half Time/Full Time', '半全场'],
]);

const TEAM_TYPE_CODE_ALIASES = {
  '1': '1',
  '2': '2',
  X: 'X',
  Draw: 'X',
  draw: 'X',
  平局: 'X',
  和局: 'X',
  Over: 'Over',
  Under: 'Under',
  Yes: 'Yes',
  No: 'No',
  Tie: 'Tie',
  Exactly: 'Exactly',
  Odd: 'Odd',
  Even: 'Even',
  '1X': '1&X',
  'X1': '1&X',
  '1/X': '1&X',
  '1&X': '1&X',
  'X2': 'X&2',
  '2X': 'X&2',
  'X/2': 'X&2',
  'X&2': 'X&2',
  '2&X': 'X&2',
  '1&2': '1&2',
  '12': '1&2',
  '1/2': '1&2',
  '21': '1&2',
};

const DOUBLE_CHANCE_MARKET_IDS = new Set(['10114', '10257', '10115']);
const COMBINED_RESULT_MARKET_IDS = new Set(['42', '10560', '50190']);
const HANDICAP_MARKET_IDS = new Set(['938', '439', '440', '50138', '50137', '50265', '50264', '171', '10204', '10147', '50281', '10159', '50346', '10535', '10165']);
const GOAL_LINE_MARKET_IDS = new Set(['981', '430', '431', '50386', '10143', '50139', '50136', '50266', '10148', '10171', '50285', '760', '10539', '10164', '50155', '50156']);
const CORRECT_SCORE_MARKET_IDS = new Set(['43', '50590', '50591', '50275', '10540', '10001', '10561']);

function translateRawSelectionLabel(value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return '';

  if (/^No\s+Goal$/i.test(raw)) return '无进球';
  if (/^No\s+1st\s+Goal$/i.test(raw)) return '无首球';

  const noNthGoal = raw.match(/^No\s+(\d+)(?:st|nd|rd|th)\s+Goal$/i);
  if (noNthGoal) return `无第${noNthGoal[1]}球`;

  const nthGoal = raw.match(/^(\d+)(?:st|nd|rd|th)\s+Goal$/i);
  if (nthGoal) return `第${nthGoal[1]}球`;

  return '';
}

function translateMarketTitle(value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return '';

  const direct = MARKET_TITLE_ALIASES.get(raw);
  if (direct) return direct;

  const goalMatch = raw.match(/^(\d+)(?:st|nd|rd|th)\s+Goal$/i);
  if (goalMatch) return `第${goalMatch[1]}球`;

  return '';
}

export {
  COMBINED_RESULT_MARKET_IDS,
  CORRECT_SCORE_MARKET_IDS,
  DOUBLE_CHANCE_MARKET_IDS,
  GOAL_LINE_MARKET_IDS,
  HANDICAP_MARKET_IDS,
  MARKET_LABELS,
  MARKET_TITLE_ALIASES,
  TEAM_TYPE_CODE_ALIASES,
  translateMarketTitle,
  translateRawSelectionLabel,
};
