export const EVENT_CONTRACT_TYPE = 7;
export const DEFAULT_TRANSFER_COIN = 'USDT';
export const TRANSFER_DIRECTION_INTO_EVENT = 'INTO_EVENT';
export const TRANSFER_DIRECTION_OUT_OF_EVENT = 'OUT_OF_EVENT';

const BALANCE_BUCKET_TYPE_MAP = {
  spotBalance: 'SPOT',
  tigerBalance: 'CONTRACT',
  tigerSpuerBalance: 'SUPER',
  otcBalance: 'OTC',
  financialBalance: 'FINANCIAL',
  leverBalance: 'LEVER',
  optionsBalance: 'OPTIONS',
  copyBalance: 'COPY',
};

const WALLET_TYPE_META = {
  1: { code: 'CONTRACT', label: '合约' },
  2: { code: 'SUPER', label: '超级账户' },
  3: { code: 'SPOT', label: '现货' },
  4: { code: 'FINANCIAL', label: '资金账户' },
  5: { code: 'LEVER', label: '杠杆' },
  6: { code: 'OTC', label: 'OTC' },
  7: { code: 'OPTIONS', label: '事件合约（足球预测）', shortLabel: '事件合约' },
  8: { code: 'COPY', label: '跟单账户' },
};

const WALLET_TYPE_CODE_MAP = Object.values(WALLET_TYPE_META).reduce((acc, item, index) => {
  acc[item.code] = Number(Object.keys(WALLET_TYPE_META)[index]);
  return acc;
}, {});

function asNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function safeUpper(value) {
  return value == null ? '' : String(value).trim().toUpperCase();
}

function extractWalletList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.wallets)) return payload.wallets;
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.wallets)) return payload.data.wallets;
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  const source = payload?.data || payload;
  if (source && typeof source === 'object') {
    const flattened = Object.entries(BALANCE_BUCKET_TYPE_MAP).flatMap(([key, typeCode]) => {
      const bucket = source?.[key];
      if (!Array.isArray(bucket)) return [];
      return bucket.map((item) => ({
        ...item,
        balanceType: item?.balanceType ?? typeCode,
      }));
    });
    if (flattened.length > 0) return flattened;
  }
  return [];
}

function extractAvailableWalletTypes(payload) {
  if (Array.isArray(payload?.availableWalletTypes)) return payload.availableWalletTypes;
  if (Array.isArray(payload?.data?.availableWalletTypes)) return payload.data.availableWalletTypes;
  return [];
}

export function normalizeWalletType(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  return WALLET_TYPE_CODE_MAP[raw.toUpperCase()] ?? null;
}

export function getWalletMeta(balanceType) {
  const typeCode = normalizeWalletType(balanceType);
  if (typeCode && WALLET_TYPE_META[typeCode]) {
    return { typeCode, ...WALLET_TYPE_META[typeCode] };
  }
  return {
    typeCode,
    code: typeCode == null ? String(balanceType ?? '') : String(typeCode),
    label: String(balanceType ?? '未知钱包'),
    shortLabel: String(balanceType ?? '未知钱包'),
  };
}

export function normalizeWallet(rawWallet, fallbackCoin = DEFAULT_TRANSFER_COIN) {
  const meta = getWalletMeta(rawWallet?.balanceType ?? rawWallet?.type ?? rawWallet?.typeCode);
  return {
    typeCode: meta.typeCode,
    balanceType: rawWallet?.balanceType ?? meta.code,
    transferWalletType: safeUpper(rawWallet?.walletType ?? rawWallet?.balanceType ?? meta.code),
    label: meta.label,
    shortLabel: meta.shortLabel ?? meta.label,
    coin: safeUpper(rawWallet?.coin || fallbackCoin || DEFAULT_TRANSFER_COIN),
    walletBalance: asNumber(
      rawWallet?.walletBalance ?? rawWallet?.balance ?? rawWallet?.amount ?? rawWallet?.estimatedTotalAmount,
    ),
    availableBalance: asNumber(
      rawWallet?.availableBalance
      ?? rawWallet?.estimatedAvailableAmount
      ?? rawWallet?.amount
      ?? rawWallet?.walletBalance
      ?? rawWallet?.balance,
    ),
    frozenBalance: asNumber(rawWallet?.freezeAmount ?? rawWallet?.crossedMargin),
    allowTransfer: rawWallet?.allowTransfer !== false,
    raw: rawWallet,
  };
}

export function buildEventContractWallet(balance) {
  const meta = getWalletMeta(EVENT_CONTRACT_TYPE);
  return {
    typeCode: EVENT_CONTRACT_TYPE,
    balanceType: meta.code,
    transferWalletType: safeUpper(meta.code),
    label: meta.label,
    shortLabel: meta.shortLabel,
    coin: safeUpper(balance?.coin || DEFAULT_TRANSFER_COIN),
    walletBalance: asNumber(balance?.walletBalance),
    availableBalance: asNumber(balance?.amount ?? balance?.availableBalance ?? balance?.walletBalance),
    frozenBalance: asNumber(balance?.freezeAmount),
    allowTransfer: true,
    raw: balance,
  };
}

export function normalizeWalletsResponse(payload, eventBalance) {
  const normalized = extractWalletList(payload)
    .map((item) => normalizeWallet(item, eventBalance?.coin))
    .filter((item) => item.typeCode != null);
  const availableWalletTypes = extractAvailableWalletTypes(payload)
    .map((item) => normalizeWalletType(item))
    .filter((item) => item != null);

  const deduped = [];
  const seen = new Set();
  normalized.forEach((item) => {
    if (seen.has(item.typeCode)) return;
    seen.add(item.typeCode);
    deduped.push(item);
  });

  availableWalletTypes.forEach((typeCode) => {
    if (typeCode == null || typeCode === EVENT_CONTRACT_TYPE || seen.has(typeCode)) return;
    const meta = getWalletMeta(typeCode);
    seen.add(typeCode);
    deduped.push({
      typeCode,
      balanceType: meta.code,
      label: meta.label,
      shortLabel: meta.shortLabel ?? meta.label,
      coin: String(eventBalance?.coin || DEFAULT_TRANSFER_COIN).toUpperCase(),
      walletBalance: 0,
      availableBalance: 0,
      frozenBalance: 0,
      allowTransfer: true,
      raw: null,
    });
  });

  const eventWalletFromBalance = buildEventContractWallet(eventBalance);
  const eventWalletIndex = deduped.findIndex((item) => item.typeCode === EVENT_CONTRACT_TYPE);
  if (eventWalletIndex >= 0) {
    deduped[eventWalletIndex] = {
      ...deduped[eventWalletIndex],
      ...eventWalletFromBalance,
      allowTransfer: deduped[eventWalletIndex].allowTransfer !== false,
    };
  } else {
    deduped.unshift(eventWalletFromBalance);
  }

  deduped.sort((left, right) => {
    if (left.typeCode === EVENT_CONTRACT_TYPE) return -1;
    if (right.typeCode === EVENT_CONTRACT_TYPE) return 1;
    return left.typeCode - right.typeCode;
  });

  return deduped;
}

export function getTransferCandidates(wallets) {
  return (Array.isArray(wallets) ? wallets : []).filter(
    (item) => item.typeCode !== EVENT_CONTRACT_TYPE && item.allowTransfer !== false,
  );
}

export function buildInitialTransferState(wallets) {
  const candidates = getTransferCandidates(wallets);
  return {
    direction: TRANSFER_DIRECTION_INTO_EVENT,
    counterpartyType: candidates[0]?.typeCode ?? null,
    coinType: DEFAULT_TRANSFER_COIN,
    amount: '',
  };
}

export function resolveTransferSelection(wallets, direction, counterpartyType) {
  const allWallets = Array.isArray(wallets) ? wallets : [];
  const eventWallet = allWallets.find((item) => item.typeCode === EVENT_CONTRACT_TYPE) || null;
  const counterpartyWallet = allWallets.find((item) => item.typeCode === normalizeWalletType(counterpartyType)) || null;

  if (!eventWallet || !counterpartyWallet) {
    return {
      fromWallet: direction === TRANSFER_DIRECTION_OUT_OF_EVENT ? eventWallet : counterpartyWallet,
      toWallet: direction === TRANSFER_DIRECTION_OUT_OF_EVENT ? counterpartyWallet : eventWallet,
      fromType: direction === TRANSFER_DIRECTION_OUT_OF_EVENT ? EVENT_CONTRACT_TYPE : null,
      toType: direction === TRANSFER_DIRECTION_INTO_EVENT ? EVENT_CONTRACT_TYPE : null,
      valid: false,
    };
  }

  if (direction === TRANSFER_DIRECTION_OUT_OF_EVENT) {
    return {
      fromWallet: eventWallet,
      toWallet: counterpartyWallet,
      fromType: EVENT_CONTRACT_TYPE,
      toType: counterpartyWallet.typeCode,
      valid: true,
    };
  }

  return {
    fromWallet: counterpartyWallet,
    toWallet: eventWallet,
    fromType: counterpartyWallet.typeCode,
    toType: EVENT_CONTRACT_TYPE,
    valid: true,
  };
}

export function formatTransferAmount(value) {
  const amount = asNumber(value);
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function extractTransferCoinEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.supportedWallets)) return payload.supportedWallets;
  if (Array.isArray(payload?.data?.supportedWallets)) return payload.data.supportedWallets;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

export function normalizeTransferCoinsResponse(payload) {
  return extractTransferCoinEntries(payload)
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      userWalletType: safeUpper(item.userWalletType),
      coins: Array.isArray(item.coins)
        ? item.coins.map((coin) => safeUpper(coin)).filter(Boolean)
        : [],
    }))
    .filter((item) => item.userWalletType);
}

export function supportsWalletTransferCoin(payload, wallet, coin = DEFAULT_TRANSFER_COIN) {
  const walletType = safeUpper(wallet?.transferWalletType ?? wallet?.balanceType);
  const targetCoin = safeUpper(coin || DEFAULT_TRANSFER_COIN);
  if (!walletType || !targetCoin) return false;
  const supported = normalizeTransferCoinsResponse(payload).find((item) => item.userWalletType === walletType);
  if (!supported) return false;
  return supported.coins.includes(targetCoin);
}

export function buildTransferPayload(wallets, form) {
  const selection = resolveTransferSelection(wallets, form?.direction, form?.counterpartyType);
  const amount = Number(form?.amount);

  if (!selection.valid) {
    return { error: '请选择可划转钱包' };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: '请输入有效划转金额' };
  }

  return {
    payload: {
      fromWalletType: String(selection.fromWallet?.transferWalletType ?? selection.fromWallet?.balanceType ?? '').toLowerCase(),
      toWalletType: String(selection.toWallet?.transferWalletType ?? selection.toWallet?.balanceType ?? '').toLowerCase(),
      coin: safeUpper(form?.coinType || DEFAULT_TRANSFER_COIN),
      amount,
    },
    selection,
  };
}
