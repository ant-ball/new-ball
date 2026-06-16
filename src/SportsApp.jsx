import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './SportsApp.css';
import { appendOrReplaceSlipItem, getDuplicateSlipEventIds } from './betSlip';
import HistoryDrawer from './components/HistoryDrawer';
import MarketDrawer from './components/MarketDrawer';
import MatchCard from './components/MatchCard';
import SlipDrawer from './components/SlipDrawer';
import TransferDrawer from './components/TransferDrawer';
import { fetchUserBalance, fetchUserInfo, getExternalTokenFromUrl, getStoredBallToken, tokenLogin } from './auth';
import { getBallApiBaseUrl } from './config';
import {
  formatInplaySelectionLabel,
  formatPreSelectionLabel,
  getMarketDisplayLabel,
} from './marketDisplay';
import {
  applyEventResultSnapshot,
  mergeMavoIntoMatchRaw,
  normalizeMavoFromWs,
} from './wsMatchState';
import {
  MAIN_MARKETS,
  buildCorrectScoreSections,
  buildMainColumn,
  buildMarketSections,
  buildRollingColumns,
} from './matchMarkets';
import {
  createContactOrder,
  createOrder,
  checkUserTransfer,
  getAssociation,
  getBet365All,
  getLeagueGroup,
  getOrderFlow,
  getOrderList,
  getUserBalance,
  getUserWallets,
  submitUserTransfer,
} from './api';
import {
  buildInitialTransferState,
  buildTransferPayload,
  EVENT_CONTRACT_TYPE,
  formatTransferAmount,
  normalizeWalletType,
  normalizeWalletsResponse,
  supportsWalletTransferCoin,
} from './transfer';
import { useOddsSocket } from './useOddsSocket';

const BASE_URL = getBallApiBaseUrl();

const TOP_TABS = ['滚球', '今日', '早盘', '冠军', '综合过关'];
const SPORT_TABS = [
  { label: '足球', icon: '⚽' },
  { label: '篮球 & 美...', icon: '🏀' },
  { label: '网球', icon: '🎾' },
  { label: '排球', icon: '🏐' },
  { label: '棒球', icon: '⚾' },
];
const MODE_META = {
  滚球: { title: '足球', subtitle: '滚球', type: 1 },
  今日: { title: '足球', subtitle: '今日', type: 0 },
  早盘: { title: '足球', subtitle: '早盘', type: 0 },
  冠军: { title: '足球', subtitle: '冠军', type: 0 },
  综合过关: { title: '足球', subtitle: '综合过关', type: 0 },
  晋级: { title: '足球', subtitle: '晋级', type: 0 },
  世界杯: { title: '足球', subtitle: '世界杯', type: 0 },
};
const MODE_HINT = {
  滚球: '主要玩法',
  今日: '赛事',
  早盘: '赛事',
  冠军: '冠军',
  综合过关: '赛事',
  晋级: '晋级',
  世界杯: '赛事',
};
const MODE_BOARD_HINT = {
  滚球: '滚球赛事',
  今日: '今日赛事',
  早盘: '早盘赛事',
  冠军: '冠军盘口',
  综合过关: '综合过关',
  晋级: '晋级盘口',
  世界杯: '世界杯赛事',
};
const DAY_TABS = [
  { label: '今日', index: 0 },
  { label: '明天', index: 1 },
  { label: '后天', index: 2 },
];
const SAME_EVENT_CONFLICT_MESSAGE = '串关不支持同一场比赛选择多个投注项';
function getStartOfDaySingapore(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [year, month, day] = formatter.format(date).split('-').map(Number);
  return Date.UTC(year, month - 1, day, -8, 0, 0);
}

function getSelectedDayTimestamp(dayIndex) {
  return getStartOfDaySingapore(new Date()) + dayIndex * 24 * 3600 * 1000;
}

function normalizeList(payload) {
  const data = payload?.data?.data ?? payload?.data ?? payload ?? [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function flattenMatches(raw, modeType) {
  const data = raw?.data?.data ?? raw?.data ?? raw ?? {};
  const isRolling = modeType === 1 || modeType === '1';
  const groups = isRolling ? data?.inPlay : data?.preMatch;
  if (Array.isArray(groups)) return groups.flatMap((item) => item?.value ?? []);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.list)) return data.list;
  return [];
}

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

function getScore(match) {
  if (match?.ballScore != null && String(match.ballScore).trim() !== '') return String(match.ballScore);
  const home = match?.homeScore ?? match?.scoreHome ?? match?.score1;
  const away = match?.awayScore ?? match?.scoreAway ?? match?.score2;
  if (home != null && away != null) return `${home}-${away}`;
  return '-';
}

function getMatchTime(match) {
  const ts = match?.time ?? match?.timeTs ?? match?.matchTime ?? match?.startTime;
  if (!ts) return '';
  const ms = Number(ts) < 1e12 ? Number(ts) * 1000 : Number(ts);
  const d = new Date(ms);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function getLiveClockDisplay(match) {
  if (match?.timeStatus !== '1' && match?.rolling !== true) return '';
  const min = Number(match?.liveClockMinute ?? match?.tM ?? 0);
  const sec = Number(match?.liveClockSecond ?? match?.tS ?? 0);
  const elapsedSeconds = Number(match?.clockEstimatedElapsedSeconds);
  const hasClock = (
    match?.liveClockMinute != null ||
    match?.liveClockSecond != null ||
    match?.tM != null ||
    match?.tS != null
  );
  if (!hasClock && min === 0 && sec === 0) return '';
  if (Number.isNaN(min) || Number.isNaN(sec)) return '';
  const half = match?.liveHalf ?? (Number.isFinite(elapsedSeconds) ? (elapsedSeconds < 45 * 60 ? 1 : 2) : (min < 45 ? 1 : 2));
  const halfLabel = half === 1 ? '上半场' : '下半场';
  return `${halfLabel} ${Math.max(0, min)}:${String(Math.max(0, Math.min(59, sec))).padStart(2, '0')}`;
}

function getMatchKey(match, index) {
  return (
    match?.id ||
    match?.bet365Id ||
    match?.eventId ||
    `${getHomeName(match)}_${getAwayName(match)}_${index}`
  );
}

function formatLeagueName(item) {
  return (
    item?.leagueName ??
    item?.league_name ??
    item?.leagueNameCN ??
    item?.name ??
    item?.leagueId ??
    item?.id ??
    '联赛'
  );
}

function normalizeLeagues(raw) {
  const data = raw?.data?.data ?? raw?.data ?? raw ?? [];
  if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === 'object' && 'key' in data[0] && Array.isArray(data[0].value)) {
    return data.map((group) => ({
      title: group?.key?.leagueNameCN || group?.key?.leagueNameEN || group?.key?.name || group?.key?.id || '联赛',
      count: Array.isArray(group?.value) ? group.value.length : 0,
      items: Array.isArray(group?.value)
        ? group.value.map((league) => ({
            leagueId: String(league?.leagueId ?? league?.id ?? league?.league_id ?? ''),
            leagueName: formatLeagueName(league),
            raw: league,
          }))
        : [],
    }));
  }
  const items = Array.isArray(data)
    ? data.map((league) => ({
        leagueId: String(league?.leagueId ?? league?.id ?? league?.league_id ?? ''),
        leagueName: formatLeagueName(league),
        raw: league,
      }))
    : [];
  return [{ title: '联赛', count: items.length, items }];
}

function normalizeLeagueSectionTitle(title, mode) {
  if (mode === '今日') {
    if (title === '联赛') return '今日赛事';
    return title;
  }
  if (mode === '早盘') {
    if (title === '联赛') return '赛事 - ' + getTodayLabel();
    return title;
  }
  return title;
}

function getTodayLabel() {
  return new Date().toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).replace(/\//g, '-');
}

function getAssociationMap(list) {
  const map = new Map();
  (Array.isArray(list) ? list : []).forEach((vo) => {
    const type = vo?.type != null ? Number(vo.type) : null;
    if (type == null) return;
    const bySmall = new Map();
    (Array.isArray(vo?.value) ? vo.value : []).forEach((item) => {
      const smallId = item?.smallId ?? item?.small_id ?? item?.smallID;
      if (smallId == null) return;
      bySmall.set(String(smallId), {
        betName: item?.betName ?? item?.bet_name ?? '',
        samllName: item?.samllName ?? item?.samll_name ?? item?.small_name ?? '',
        smallId,
      });
    });
    map.set(type, bySmall);
  });
  return map;
}

function parseBallTokenFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('token') || params.get('authToken') || '';
  } catch {
    return '';
  }
}

function BrandAvatar({ onClick, balance, coin }) {
  return (
    <button className="hg-avatar" type="button" onClick={onClick}>
      <span className="hg-avatar-dot" />
      <span className="hg-avatar-label">账户</span>
      <small className="hg-avatar-balance">
        {balance != null ? `${(coin || 'USDT').toUpperCase()} ${formatTransferAmount(balance)}` : 'USDT 0'}
      </small>
    </button>
  );
}

function OddsCell({ title, item, onClick, className = '' }) {
  const isSuspended = item?.suspended === true || item?.odds === '-' || item?.odds === '';
  return (
    <button
      type="button"
      className={`hg-odds-cell ${isSuspended ? 'is-locked' : ''} ${className}`}
      onClick={() => !isSuspended && onClick?.(item)}
    >
      <span className="hg-odds-top">{title}</span>
      <span className="hg-odds-mid">{item?.label ?? '-'}</span>
      <strong className="hg-odds-bottom">{item?.odds ?? '-'}</strong>
      {isSuspended ? <span className="hg-lock">🔒</span> : null}
    </button>
  );
}

function SidebarSection({ title, count, items, mode, selectedLeague, onSelectLeague }) {
  const sectionTitle = normalizeLeagueSectionTitle(title, mode);
  return (
    <div className="hg-league-group">
      <div className="hg-league-group-title">
        <span>{sectionTitle}</span>
        <small>{count}</small>
      </div>
      <div className="hg-league-group-list">
        {(items || []).map((league) => {
          const active = selectedLeague?.leagueId === league.leagueId;
          return (
            <button
              type="button"
              key={league.leagueId || league.leagueName}
              className={`hg-league-row ${active ? 'active' : ''}`}
              onClick={() => onSelectLeague?.(league)}
            >
              <span className="hg-league-dot" />
              <span className="hg-league-name">{league.leagueName}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SidebarHotRows({ mode, onSelectLeague, selectedLeague, groups }) {
  const firstLeague = groups?.[0]?.items?.[0];
  return (
    <div className="hg-sidebar-hot">
      <button
        type="button"
        className={`hg-hot-row ${selectedLeague?.leagueId === firstLeague?.leagueId ? 'active' : ''}`}
        onClick={() => firstLeague && onSelectLeague?.(firstLeague)}
      >
        最火
      </button>
      <button
        type="button"
        className="hg-hot-row subtle"
        onClick={() => firstLeague && onSelectLeague?.(firstLeague)}
      >
        {mode === '早盘' ? '赛事 - 今日' : mode === '今日' ? '今日赛事' : MODE_BOARD_HINT[mode]}
      </button>
    </div>
  );
}

function SidebarLoadingPlaceholder({ rows = 4 }) {
  return (
    <div className="hg-league-skeleton" aria-hidden="true">
      <div className="hg-league-skeleton-title" />
      <div className="hg-league-skeleton-list">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="hg-league-skeleton-row">
            <span className="hg-league-skeleton-dot" />
            <span className="hg-league-skeleton-line" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ReceiptDrawer({ open, receipt, onClose, onDone }) {
  if (!open) return null;
  return (
    <div className="hg-overlay" onClick={onClose}>
      <div className="hg-drawer hg-receipt" onClick={(e) => e.stopPropagation()}>
        <div className="hg-drawer-head">
          <div>
            <div className="hg-drawer-title">注单收据</div>
            <div className="hg-drawer-sub">下注成功</div>
          </div>
          <button type="button" className="hg-icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="hg-receipt-list">
          {(receipt?.items ?? []).map((item, idx) => (
            <div key={idx} className="hg-receipt-item">
              <div className="hg-receipt-kind">{item.displayBigTypeName || item.bigTypeName || item.label || '投注'}</div>
              <div className="hg-receipt-desc">{item.selectionText}</div>
              <div className="hg-receipt-row">
                <span>已确认</span>
                <span>{item.orderId || receipt?.orderId || '-'}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="hg-receipt-bar">
          <button type="button" className="hg-secondary-btn" onClick={onClose}>保留选项</button>
          <button type="button" className="hg-submit-btn" onClick={onDone}>完成</button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [baseUrl] = useState(BASE_URL);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [userInfo, setUserInfo] = useState(null);
  const [balance, setBalance] = useState(null);
  const [walletPayload, setWalletPayload] = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [transferCoinPayload, setTransferCoinPayload] = useState(null);
  const [transferCoinLoading, setTransferCoinLoading] = useState(false);
  const [transferCoinError, setTransferCoinError] = useState('');
  const [transferForm, setTransferForm] = useState(buildInitialTransferState([]));
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError] = useState('');

  const [mode, setMode] = useState('滚球');
  const [sportIndex, setSportIndex] = useState(0);
  const [subTab, setSubTab] = useState('主要玩法');
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [leagueGroups, setLeagueGroups] = useState([]);
  const [leagueLoading, setLeagueLoading] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchRaw, setMatchRaw] = useState(null);
  const [associationList, setAssociationList] = useState([]);
  const associationMap = useMemo(() => getAssociationMap(associationList), [associationList]);
  const [detailMatch, setDetailMatch] = useState(null);

  const [showSlip, setShowSlip] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [historyTab, setHistoryTab] = useState('交易状况');
  const [orderList, setOrderList] = useState([]);
  const [orderFlow, setOrderFlow] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const [betSlip, setBetSlip] = useState([]);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const batchRefreshRef = useRef(false);
  const leagueRefreshTimerRef = useRef(null);

  const selectedLeagueRef = useRef(selectedLeague);
  selectedLeagueRef.current = selectedLeague;
  const selectedDayTs = useMemo(() => getSelectedDayTimestamp(selectedDayIndex), [selectedDayIndex]);
  const currentMode = MODE_META[mode] || MODE_META.滚球;
  const isRolling = mode === '滚球';
  const matchList = useMemo(() => flattenMatches(matchRaw, currentMode.type), [matchRaw, currentMode.type]);
  const wallets = useMemo(() => normalizeWalletsResponse(walletPayload, balance), [walletPayload, balance]);
  const detailSections = useMemo(() => (
    detailMatch
      ? buildMarketSections(
          detailMatch,
          isRolling || detailMatch?.timeStatus === '1' || detailMatch?.rolling === true,
          associationMap,
        )
      : []
  ), [associationMap, detailMatch, isRolling]);

  const loadBalances = useCallback(async () => {
    try {
      const bal = await fetchUserBalance(baseUrl);
      if (bal) setBalance(bal);
    } catch {
      // ignore
    }
    try {
      const res = await getUserBalance({ baseUrl });
      setBalance(res?.data?.data ?? res?.data ?? null);
    } catch {
      // ignore
    }
  }, [baseUrl]);

  const loadWallets = useCallback(async () => {
    setWalletLoading(true);
    setWalletError('');
    try {
      const res = await getUserWallets({ baseUrl });
      setWalletPayload(res?.data ?? null);
    } catch (err) {
      setWalletPayload(null);
      setWalletError(err?.message || '钱包列表加载失败');
    } finally {
      setWalletLoading(false);
    }
  }, [baseUrl]);

  const loadTransferCoins = useCallback(async () => {
    setTransferCoinLoading(true);
    setTransferCoinError('');
    try {
      const res = await checkUserTransfer({ baseUrl });
      setTransferCoinPayload(res?.data ?? null);
    } catch (err) {
      setTransferCoinPayload(null);
      setTransferCoinError(err?.message || '可划转币种加载失败');
    } finally {
      setTransferCoinLoading(false);
    }
  }, [baseUrl]);

  const loadOrderData = useCallback(async (tab = historyTab) => {
    if (authLoading) {
      return;
    }

    if (authError || !getStoredBallToken()) {
      setOrderList([]);
      setOrderFlow(null);
      setHistoryError(authError || '请先登录后查看投注记录');
      return;
    }

    setHistoryLoading(true);
    setHistoryError('');
    try {
      if (tab === '交易状况') {
        const res = await getOrderList({
          baseUrl,
          type: 0,
          page: 1,
          size: 50,
          ...(mode === '今日' ? { day: selectedDayTs } : {}),
        });
        const page = res?.data?.data;
        setOrderList(Array.isArray(page?.data) ? page.data : []);
      } else {
        const res = await getOrderFlow({ baseUrl });
        setOrderFlow(res?.data?.data ?? res?.data ?? null);
      }
    } catch (err) {
      setOrderList([]);
      setOrderFlow(null);
      setHistoryError(err?.message || '投注记录加载失败');
    } finally {
      setHistoryLoading(false);
    }
  }, [authError, authLoading, baseUrl, historyTab, mode, selectedDayTs]);

  useEffect(() => {
    setTransferForm((previous) => {
      const initial = buildInitialTransferState(wallets);
      const hasCurrentCounterparty = wallets.some(
        (wallet) => wallet.typeCode === Number(previous?.counterpartyType) && wallet.typeCode !== 7 && wallet.allowTransfer !== false,
      );

      return {
        direction: previous?.direction || initial.direction,
        counterpartyType: hasCurrentCounterparty ? normalizeWalletType(previous.counterpartyType) : initial.counterpartyType,
        coinType: (balance?.coin || previous?.coinType || initial.coinType || 'USDT').toUpperCase(),
        amount: previous?.amount ?? '',
      };
    });
  }, [wallets, balance?.coin]);

  const loadLeagues = useCallback(async () => {
    setLeagueLoading(true);
    try {
      const res = await getLeagueGroup({
        baseUrl,
        type: currentMode.type,
        sportId: sportIndex + 1,
        day: isRolling ? undefined : selectedDayTs,
        daysOfTime: isRolling ? undefined : 1,
      });
      const groups = normalizeLeagues(res);
      const flatLeagues = groups.flatMap((group) => group.items || []);
      const previousLeague = selectedLeagueRef.current;
      const matchedLeague = previousLeague?.leagueId
        ? flatLeagues.find((league) => league.leagueId === previousLeague.leagueId) || null
        : null;
      const first = flatLeagues[0] ?? null;
      const nextLeague = matchedLeague || first;

      setLeagueGroups(groups);
      setSelectedLeague(nextLeague);
      if (!nextLeague) {
        setMatchRaw(null);
      }
      return { groups, nextLeague };
    } catch {
      setLeagueGroups([]);
      setSelectedLeague(null);
      setMatchRaw(null);
      return { groups: [], nextLeague: null };
    } finally {
      setLeagueLoading(false);
    }
  }, [baseUrl, currentMode.type, isRolling, selectedDayTs, sportIndex]);

  const loadMatches = useCallback(async (league) => {
    if (!league?.leagueId) return;
    setMatchLoading(true);
    try {
      const res = await getBet365All({
        baseUrl,
        day: isRolling ? undefined : selectedDayTs,
        leagueIds: league.leagueId,
        daysOfTime: isRolling ? undefined : 1,
      });
      setMatchRaw(res);
    } catch {
      setMatchRaw(null);
    } finally {
      setMatchLoading(false);
    }
  }, [baseUrl, isRolling, selectedDayTs]);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      setAuthLoading(true);
      setAuthError('');
      try {
        const externalToken = getExternalTokenFromUrl();
        const existingToken = getStoredBallToken();
        if (externalToken) {
          await tokenLogin(baseUrl, externalToken);
          const clean = new URL(window.location.href);
          clean.searchParams.delete('token');
          clean.searchParams.delete('authToken');
          window.history.replaceState({}, '', clean.pathname + (clean.search || '') + (clean.hash || ''));
        } else if (!existingToken) {
          throw new Error('缺少登录 token');
        }
        const [user, bal] = await Promise.all([
          fetchUserInfo(baseUrl),
          fetchUserBalance(baseUrl),
        ]);
        if (!cancelled) {
          setUserInfo(user);
          setBalance(bal);
        }
      } catch (err) {
        if (!cancelled) setAuthError(err?.message || '登录失败');
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  useEffect(() => {
    let cancelled = false;
    async function loadAssociations() {
      try {
        const res = await getAssociation({ baseUrl });
        if (!cancelled) setAssociationList(normalizeList(res));
      } catch {
        if (!cancelled) setAssociationList([]);
      }
    }
    loadAssociations();
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  useEffect(() => {
    if (authLoading || authError) {
      return;
    }

    let cancelled = false;

    async function syncLeagueBoard() {
      batchRefreshRef.current = true;
      try {
        const { nextLeague } = await loadLeagues();
        if (!cancelled && nextLeague?.leagueId) {
          await loadMatches(nextLeague);
        }
      } finally {
        if (!cancelled) {
          batchRefreshRef.current = false;
        }
      }
    }

    syncLeagueBoard();
    loadBalances();

    return () => {
      cancelled = true;
      batchRefreshRef.current = false;
    };
  }, [authLoading, authError, loadLeagues, loadMatches, loadBalances]);

  useEffect(() => {
    if (!selectedLeague?.leagueId || authLoading || authError) return;
    if (batchRefreshRef.current) return;
    loadMatches(selectedLeague);
  }, [authLoading, authError, loadMatches, selectedLeague]);

  useEffect(() => {
    if (!showHistory || authLoading || authError) {
      return;
    }

    loadOrderData(historyTab);
  }, [authError, authLoading, historyTab, loadOrderData, showHistory]);

  useEffect(() => {
    if (!showTransfer || authLoading || authError) {
      return;
    }
    loadWallets();
    loadTransferCoins();
  }, [authError, authLoading, loadTransferCoins, loadWallets, showTransfer]);

  const addToSlip = useCallback((payload) => {
    if (payload.type === 'pre') {
      const { match, marketKey, label, item, oddsObj, betPlayName: bpName } = payload;
      const odds = Number.parseFloat(item?.odds);
      if (!Number.isFinite(odds) || !match?.id) return;
      const playSmallId = marketKey ? String(marketKey.split('_')[0]) : '';
      const assocByType = associationMap.get(1);
      const assoc = assocByType && playSmallId ? assocByType.get(playSmallId) : null;
      const bigTypeName = assoc?.betName ?? '';
      const displayBigTypeName = getMarketDisplayLabel(playSmallId, assoc?.betName ?? label ?? '');
      const betPlayName = assoc?.samllName ?? bpName ?? (marketKey ? marketKey.split('_').slice(1).join('_') : '');
      const betPlayId = assoc != null ? String(assoc.smallId) : playSmallId;
      const atTime = oddsObj?.updateAt ?? oddsObj?.at_time ?? item?.updateAt ?? item?.at_time ?? null;
      const timeStr = atTime != null ? String(atTime) : '';
      setBetSlip((prev) => {
        const selectionLabel = item?.displayLabel || formatPreSelectionLabel(match, marketKey, item);
        const nextItem = {
          type: 'pre',
          match,
          marketKey,
          label,
          item,
          eventId: String(match.id),
          bet365Id: String(match.bet365Id ?? match.id),
          timeType: 0,
          oddingId: String(item.id),
          handicap: item.handicap != null ? String(item.handicap) : '',
          odds,
          betPlayId,
          betPlayName,
          bigTypeName,
          displayBigTypeName,
          oddsMarkets: marketKey,
          at_time: atTime,
          timeStr,
          stake: '',
          selectionText: `${getHomeName(match)} vs ${getAwayName(match)} ${label} ${selectionLabel} @${item.odds}`,
          marketText: `${label} ${selectionLabel}`,
        };
        return appendOrReplaceSlipItem(prev, nextItem);
      });
      setShowSlip(true);
      return;
    }

    const { match, mavo, pa, odDecimal } = payload;
    const paIdVal = pa?.id ?? pa?.ID;
    const mavoIdVal = mavo?.id ?? mavo?.ID;
    if (!match?.id && !match?.bet365Id) return;
    if (paIdVal == null || paIdVal === '') return;
    if (odDecimal == null) return;
    const assocByType = associationMap.get(5);
    const playSmallId = mavoIdVal != null ? String(mavoIdVal) : '';
    const assoc = assocByType && playSmallId ? assocByType.get(playSmallId) : null;
    const bigTypeName = assoc?.betName ?? '';
    const displayBigTypeName = getMarketDisplayLabel(playSmallId, assoc?.betName ?? mavo?.na ?? mavo?.NA ?? '');
    const betPlayName = assoc?.samllName ?? '';
    const betPlayId = assoc != null ? String(assoc.smallId) : playSmallId;
    const eventIdStr = String(match.id ?? match.bet365Id ?? '');
    const bet365IdStr = String(match.bet365Id ?? match.id ?? '');
    const odRaw = pa?.od ?? pa?.OD ?? '';
    const atTime = mavo?.updateAt ?? mavo?.UpdateAt ?? null;
    const timeStr = atTime != null ? String(atTime) : '';
    const marketLabel = getMarketDisplayLabel(mavoIdVal, assoc?.betName ?? mavo?.na ?? mavo?.NA ?? '玩法');
    setBetSlip((prev) => appendOrReplaceSlipItem(prev, {
        type: 'inplay',
        match,
        mavo,
        pa,
        eventId: eventIdStr,
        bet365Id: bet365IdStr,
        timeType: 1,
        oddingId: String(paIdVal),
        paId: mavoIdVal != null ? String(mavoIdVal) : '',
        handicap: (pa?.ha ?? pa?.HA) != null ? String(pa.ha ?? pa.HA) : '',
        odds: odDecimal,
        oddsMarkets: 'inplay',
        betPlayId,
        betPlayName,
        bigTypeName,
        displayBigTypeName,
        at_time: atTime,
        timeStr,
        stake: '',
        selectionText: `${getHomeName(match)} vs ${getAwayName(match)} ${marketLabel} ${formatInplaySelectionLabel(match, mavo, pa)} @${odRaw}`,
        marketText: `${marketLabel} ${formatInplaySelectionLabel(match, mavo, pa)}`,
      }));
    setShowSlip(true);
  }, [associationMap]);

  const updateStake = useCallback((key, value) => {
    setBetSlip((prev) => prev.map((item) => (item.key === key ? { ...item, stake: value } : item)));
  }, []);

  const removeSlipItem = useCallback((key) => {
    setBetSlip((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const handleChangeTransferDirection = useCallback((direction) => {
    setTransferError('');
    setTransferForm((previous) => ({
      ...previous,
      direction,
    }));
  }, []);

  const handleChangeTransferCounterparty = useCallback((counterpartyType) => {
    setTransferError('');
    setTransferForm((previous) => ({
      ...previous,
      counterpartyType: normalizeWalletType(counterpartyType),
    }));
  }, []);

  const handleChangeTransferAmount = useCallback((amount) => {
    setTransferError('');
    setTransferForm((previous) => ({
      ...previous,
      amount,
    }));
  }, []);

  const handleSubmitTransfer = useCallback(async () => {
    const next = buildTransferPayload(wallets, transferForm);
    if (next.error) {
      setTransferError(next.error);
      return;
    }
    const counterpartyWallet =
      next.selection.fromWallet?.typeCode === EVENT_CONTRACT_TYPE ? next.selection.toWallet : next.selection.fromWallet;
    if (!transferCoinPayload) {
      setTransferError('未获取到可划转币种信息');
      return;
    }
    if (!supportsWalletTransferCoin(transferCoinPayload, counterpartyWallet, next.payload.coin)) {
      setTransferError(`${counterpartyWallet?.label || '当前钱包'} 不支持 ${next.payload.coin} 划转`);
      return;
    }

    setTransferSubmitting(true);
    setTransferError('');
    try {
      await submitUserTransfer({
        baseUrl,
        payload: next.payload,
      });
      await Promise.all([loadBalances(), loadWallets()]);
      setTransferForm((previous) => ({
        ...previous,
        amount: '',
      }));
      setShowTransfer(false);
    } catch (err) {
      setTransferError(err?.message || '划转失败');
    } finally {
      setTransferSubmitting(false);
    }
  }, [baseUrl, loadBalances, loadWallets, transferCoinPayload, transferForm, wallets]);

  const totalWin = useMemo(() => {
    return betSlip.reduce((sum, item) => {
      const stake = Number(item.stake);
      const odds = Number(item.odds);
      if (!Number.isFinite(stake) || !Number.isFinite(odds)) return sum;
      return sum + stake * odds;
    }, 0);
  }, [betSlip]);
  const duplicateSlipEventIds = useMemo(() => getDuplicateSlipEventIds(betSlip), [betSlip]);
  const hasSameEventConflict = duplicateSlipEventIds.length > 0;
  const slipConflictMessage = hasSameEventConflict ? SAME_EVENT_CONFLICT_MESSAGE : '';

  const submitBet = useCallback(async () => {
    if (hasSameEventConflict) {
      return;
    }
    const validSlip = betSlip.filter((item) => Number(item.stake) > 0);
    if (validSlip.length === 0 || validSlip.length !== betSlip.length) {
      setSubmitError('请为每一项输入有效金额');
      return;
    }
    setSubmitLoading(true);
    setSubmitError('');
    try {
      const betOrderList = validSlip.map((item) => {
        const order = {
          eventId: item.eventId,
          bet365Id: item.bet365Id,
          odds: item.odds,
          timeType: item.timeType,
          oddingId: item.oddingId,
          handicap: item.handicap ?? '',
          oddsMarkets: item.oddsMarkets ?? '',
          betPlayId: item.betPlayId ?? '',
          betPlayName: item.betPlayName ?? '',
          bigTypeName: item.bigTypeName ?? '',
          time: item.at_time ?? undefined,
          timeStr: item.timeStr ?? (item.at_time != null ? String(item.at_time) : ''),
          betAmount: Number(item.stake),
        };
        if (item.type === 'inplay') order.paId = item.paId ?? '';
        return order;
      });
      let res;
      if (betOrderList.length === 1) {
        res = await createOrder({ baseUrl, betOrder: { ...betOrderList[0] }, isBestOdd: true });
      } else {
        res = await createContactOrder({ baseUrl, betOrderList, isBestOdd: true });
      }
      const code = res?.data?.code;
      if (code != null && code !== 0) {
        throw new Error(res?.data?.msg || res?.data?.message || '下注失败');
      }
      setReceipt({ items: validSlip, orderId: res?.data?.data?.orderId || res?.data?.data?.id || '' });
      setShowReceipt(true);
      setBetSlip([]);
      setShowSlip(false);
      await Promise.all([loadBalances(), loadOrderData('交易状况')]);
    } catch (err) {
      setSubmitError(err?.message || '下注失败');
    } finally {
      setSubmitLoading(false);
    }
  }, [baseUrl, betSlip, hasSameEventConflict, loadBalances, loadOrderData]);

  const refreshHistory = useCallback(() => {
    if (!showHistory) {
      return;
    }
    loadOrderData(historyTab);
  }, [historyTab, loadOrderData, showHistory]);

  const scheduleLeagueRefresh = useCallback(() => {
    if (!isRolling || !selectedLeague?.leagueId) return;
    if (leagueRefreshTimerRef.current) clearTimeout(leagueRefreshTimerRef.current);
    leagueRefreshTimerRef.current = setTimeout(() => {
      loadMatches(selectedLeague);
      leagueRefreshTimerRef.current = null;
    }, 800);
  }, [isRolling, loadMatches, selectedLeague]);

  useEffect(() => () => {
    if (leagueRefreshTimerRef.current) clearTimeout(leagueRefreshTimerRef.current);
  }, []);

  const onWsOddsUpdate = useCallback((payload) => {
    if (!payload) return;
    const normalized = normalizeMavoFromWs(payload);
    setMatchRaw((prev) => mergeMavoIntoMatchRaw(prev, normalized));
  }, []);

  const onWsLeagueUpdate = useCallback(() => {
    loadLeagues();
    scheduleLeagueRefresh();
  }, [loadLeagues, scheduleLeagueRefresh]);

  const onWsEventResult = useCallback((payload) => {
    if (!payload) return;
    setMatchRaw((prev) => applyEventResultSnapshot(prev, payload));
  }, []);

  const { connected } = useOddsSocket({
    baseUrl,
    enabled: isRolling && !!selectedLeague?.leagueId && !authLoading && !authError,
    eventIds: [],
    leagueId: selectedLeague?.leagueId ?? null,
    onOddsUpdate: onWsOddsUpdate,
    onInplayLeagueUpdate: onWsLeagueUpdate,
    onLeagueEventsUpdate: onWsLeagueUpdate,
    onEventResult: onWsEventResult,
  });

  const currentMatches = matchList;
  const handleSelectLeague = useCallback((league) => {
    setSelectedLeague(league);
    loadMatches(league);
  }, [loadMatches]);

  return (
    <div className="hg-app">
      <div className="hg-shell">
        <header className="hg-topbar hg-clone-topbar">
          <div className="hg-topline">
            <button className="hg-home-btn" type="button" aria-label="首页">⌂</button>
            {TOP_TABS.map((tab) => (
              <button key={tab} type="button" className={`hg-top-tab ${tab === mode ? 'active' : ''}`} onClick={() => setMode(tab)}>
                {tab}
              </button>
            ))}
            <div className="hg-top-spacer" />
            <BrandAvatar
              onClick={() => {
                setTransferError('');
                setWalletError('');
                setShowTransfer(true);
              }}
              balance={balance?.amount ?? balance?.walletBalance ?? 0}
              coin={balance?.coin || 'USDT'}
            />
          </div>
        </header>

        <section className="hg-sports-row">
          {SPORT_TABS.map((sport, idx) => (
            <button
              key={sport.label}
              type="button"
              className={idx === sportIndex ? 'active' : ''}
              onClick={() => setSportIndex(idx)}
            >
              <span className="hg-sport-icon">{sport.icon}</span>
              <span>{sport.label}</span>
            </button>
          ))}
        </section>

        <section className="hg-hero">
          <div className="hg-hero-top">
            <div className="hg-back">←</div>
            <div className="hg-hero-center">
              <span>{currentMode.subtitle}</span>
              <strong>{currentMode.title}</strong>
            </div>
            <div className="hg-hero-right">{mode === '早盘' ? '📅' : '🏆'}</div>
          </div>
          <div className="hg-hero-tabs">
            <button type="button" className={subTab === '主要玩法' ? 'active' : ''} onClick={() => setSubTab('主要玩法')}>
              {mode === '今日' ? '赛事' : '主要玩法'}
            </button>
            <button type="button" className={subTab === '波胆' ? 'active' : ''} onClick={() => setSubTab('波胆')}>
              波胆
            </button>
          </div>
          {mode !== '滚球' ? (
            <div className="hg-day-tabs">
              {DAY_TABS.map((day) => (
                <button
                  type="button"
                  key={day.label}
                  className={day.index === selectedDayIndex ? 'active' : ''}
                  onClick={() => setSelectedDayIndex(day.index)}
                >
                  {day.label}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <main className="hg-main">
          <section className="hg-stream">
            <div className="hg-league-head">
              <strong>{MODE_BOARD_HINT[mode]}</strong>
            </div>
            <SidebarHotRows mode={mode} onSelectLeague={handleSelectLeague} selectedLeague={selectedLeague} groups={leagueGroups} />
            <div className="hg-leagues-body" aria-busy={leagueLoading}>
              {leagueLoading && (leagueGroups || []).length === 0 ? (
                <SidebarLoadingPlaceholder rows={4} />
              ) : null}
              {(leagueGroups || []).map((group) => (
                <SidebarSection
                  key={group.title}
                  title={group.title}
                  count={group.count}
                  items={group.items}
                  mode={mode}
                  selectedLeague={selectedLeague}
                  onSelectLeague={handleSelectLeague}
                />
              ))}
              {mode !== '滚球' ? (
                <div className="hg-az-divider">
                  <span>联盟 A-Z</span>
                </div>
              ) : null}
              {leagueLoading && (leagueGroups || []).length > 0 ? (
                <div className="hg-leagues-refresh-mask">
                  <span>联赛刷新中...</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="hg-board">
            <div className="hg-board-head">
              <strong>{selectedLeague ? selectedLeague.leagueName : '最火'}</strong>
              <span>{currentMode.title}</span>
            </div>
            {authLoading ? (
              <div className="hg-empty-state">登录中...</div>
            ) : authError ? (
              <div className="hg-empty-state error">登录失败：{authError}</div>
            ) : null}
            {selectedLeague ? (
              currentMatches.length > 0 ? (
                currentMatches.map((match, index) => {
                  const liveClock = getLiveClockDisplay(match);
                  const score = getScore(match);
                  const rolling = mode === '滚球' || match?.timeStatus === '1' || match?.rolling === true;
                  const preColumns = MAIN_MARKETS.map((market) => buildMainColumn(match, market.key, market.rows));
                  const rollingColumns = buildRollingColumns(match, associationMap, 6);
                  const correctScoreSections = buildCorrectScoreSections(match, rolling);

                  return (
                    <MatchCard
                      key={getMatchKey(match, index)}
                      match={match}
                      mode={mode}
                      subTab={subTab}
                      homeName={getHomeName(match)}
                      awayName={getAwayName(match)}
                      matchTime={getMatchTime(match)}
                      liveClock={liveClock}
                      score={score}
                      isRolling={rolling}
                      preColumns={preColumns}
                      rollingColumns={rollingColumns}
                      correctScoreSections={correctScoreSections}
                      onPickOdds={addToSlip}
                      onMore={() => setDetailMatch(match)}
                    />
                  );
                })
              ) : (
                <div className="hg-empty-state">暂无比赛数据</div>
              )
            ) : (
              <div className="hg-empty-state">请选择联赛</div>
            )}
          </section>
        </main>

        <footer className="hg-bottom-nav">
          <button type="button" className="active">体育</button>
          <button type="button">赛程</button>
          <button type="button" className="hg-bottom-center" onClick={() => setShowSlip(true)}>
            <span>{betSlip.length}</span>
            注单
          </button>
          <button type="button" onClick={() => { setShowHistory(true); setHistoryTab('交易状况'); }}>我的赛事</button>
          <button type="button" onClick={() => { setShowHistory(true); setHistoryTab('账户历史'); }}>投注记录</button>
        </footer>
      </div>

      <div className="hg-floating-bet" onClick={() => setShowSlip(true)}>
        <span>{betSlip.length}</span>
        注单
      </div>

      <SlipDrawer
        open={showSlip}
        slip={betSlip}
        balance={balance?.amount ?? balance?.walletBalance ?? 0}
        coin={balance?.coin || 'USDT'}
        onClose={() => setShowSlip(false)}
        onChangeStake={updateStake}
        onRemove={removeSlipItem}
        onSubmit={submitBet}
        submitLoading={submitLoading}
        submitDisabled={betSlip.length === 0 || hasSameEventConflict}
        submitError={hasSameEventConflict ? '' : submitError}
        conflictMessage={slipConflictMessage}
        totalWin={totalWin}
      />

      <TransferDrawer
        open={showTransfer}
        wallets={wallets}
        walletLoading={walletLoading || transferCoinLoading}
        walletError={walletError || transferCoinError}
        form={transferForm}
        onClose={() => setShowTransfer(false)}
        onChangeDirection={handleChangeTransferDirection}
        onChangeCounterparty={handleChangeTransferCounterparty}
        onChangeAmount={handleChangeTransferAmount}
        onSubmit={handleSubmitTransfer}
        submitLoading={transferSubmitting}
        submitError={transferError}
      />

      <MarketDrawer
        open={detailMatch != null}
        match={detailMatch}
        sections={detailSections}
        onClose={() => setDetailMatch(null)}
        onPickOdds={(payload) => {
          addToSlip(payload);
          setDetailMatch(null);
        }}
      />

      <ReceiptDrawer
        open={showReceipt}
        receipt={receipt}
        onClose={() => setShowReceipt(false)}
        onDone={() => setShowReceipt(false)}
      />

      <HistoryDrawer
        open={showHistory}
        mode={mode}
        tab={historyTab}
        setTab={setHistoryTab}
        loading={historyLoading}
        orderList={orderList}
        orderFlow={orderFlow}
        error={historyError}
        onClose={() => setShowHistory(false)}
        onRefresh={refreshHistory}
      />

      {!authLoading && !authError ? (
        <div className="hg-status-bar">
          <span className={connected ? 'online' : 'offline'} />
          <span>{connected ? 'WS 已连接' : 'WS 断开'}</span>
          <span>用户：{userInfo?.account || userInfo?.loginAccount || userInfo?.nickName || '-'}</span>
          <span>余额：{(balance?.coin || 'USDT').toUpperCase()} {formatTransferAmount(balance?.amount ?? balance?.walletBalance ?? 0)}</span>
        </div>
      ) : null}
    </div>
  );
}

export default App;
