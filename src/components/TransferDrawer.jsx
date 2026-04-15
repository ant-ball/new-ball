import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatTransferAmount,
  getTransferCandidates,
  resolveTransferSelection,
  TRANSFER_DIRECTION_INTO_EVENT,
  TRANSFER_DIRECTION_OUT_OF_EVENT,
} from '../transfer';

function WalletSelector({ fixedWallet, isSelect, candidates, value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedWallet = useMemo(
    () => candidates.find((wallet) => String(wallet.typeCode) === String(value)) || null,
    [candidates, value],
  );

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [open]);

  if (!isSelect) {
    return (
      <div className="hg-transfer-wallet-inline">
        {fixedWallet?.label || '-'}
      </div>
    );
  }

  return (
    <div className="hg-transfer-dropdown" ref={rootRef}>
      <button
        type="button"
        className="hg-transfer-dropdown-trigger"
        onClick={() => setOpen((valueOpen) => !valueOpen)}
        disabled={candidates.length === 0}
      >
        <span>{selectedWallet?.label || '暂无可划转钱包'}</span>
        <span className={`hg-transfer-dropdown-caret ${open ? 'open' : ''}`}>⌄</span>
      </button>

      {open && candidates.length > 0 ? (
        <div className="hg-transfer-dropdown-menu">
          {candidates.map((wallet) => (
            <button
              key={wallet.typeCode}
              type="button"
              className={`hg-transfer-dropdown-item ${String(wallet.typeCode) === String(value) ? 'active' : ''}`}
              onClick={() => {
                onChange(wallet.typeCode);
                setOpen(false);
              }}
            >
              {wallet.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TransferDrawer({
  open,
  wallets,
  walletLoading,
  walletError,
  form,
  onClose,
  onChangeDirection,
  onChangeCounterparty,
  onChangeAmount,
  onSubmit,
  submitLoading,
  submitError,
}) {
  if (!open) return null;

  const candidates = getTransferCandidates(wallets);
  const selection = resolveTransferSelection(wallets, form?.direction, form?.counterpartyType);
  const fromWallet = selection.fromWallet;
  const toWallet = selection.toWallet;
  const sourceFixed = form?.direction === TRANSFER_DIRECTION_OUT_OF_EVENT;
  const targetFixed = form?.direction === TRANSFER_DIRECTION_INTO_EVENT;
  const transferRouteText = `${fromWallet?.shortLabel || '钱包'} → ${toWallet?.shortLabel || '事件合约'}`;
  const amountLabelText = `划转金额（${transferRouteText}）`;

  return (
    <div className="hg-overlay" onClick={onClose}>
      <div className="hg-drawer hg-transfer" onClick={(e) => e.stopPropagation()}>
        <div className="hg-transfer-head">
          <div>
            <div className="hg-drawer-title">资金划转</div>
          </div>
          <button type="button" className="hg-icon-btn" onClick={onClose}>×</button>
        </div>

        <div className="hg-transfer-body">
          {walletLoading ? <div className="hg-transfer-notice">钱包加载中...</div> : null}
          {!walletLoading && walletError ? <div className="hg-error hg-transfer-error">{walletError}</div> : null}

          <div className="hg-transfer-route">
            <section className="hg-transfer-card">
              <div className="hg-transfer-card-head">
                <div className="hg-transfer-title">划出</div>
                <div className="hg-transfer-balance-chip">可用 {formatTransferAmount(fromWallet?.availableBalance)} {fromWallet?.coin || 'USDT'}</div>
              </div>
              <WalletSelector
                fixedWallet={fromWallet}
                isSelect={!sourceFixed}
                candidates={candidates}
                value={form?.counterpartyType ?? ''}
                onChange={onChangeCounterparty}
              />
            </section>

            <div className="hg-transfer-switch">
              <button
                type="button"
                className="hg-transfer-swap-btn"
                onClick={() => onChangeDirection(
                  form?.direction === TRANSFER_DIRECTION_INTO_EVENT
                    ? TRANSFER_DIRECTION_OUT_OF_EVENT
                    : TRANSFER_DIRECTION_INTO_EVENT,
                )}
                aria-label="切换划转方向"
              >
                ⇄
              </button>
            </div>

            <section className="hg-transfer-card target">
              <div className="hg-transfer-card-head">
                <div className="hg-transfer-title">球账户</div>
                <div className="hg-transfer-balance-chip">余额 {formatTransferAmount(toWallet?.walletBalance)} {toWallet?.coin || 'USDT'}</div>
              </div>
              <WalletSelector
                fixedWallet={toWallet}
                isSelect={!targetFixed}
                candidates={candidates}
                value={form?.counterpartyType ?? ''}
                onChange={onChangeCounterparty}
              />
            </section>
          </div>

          <div className="hg-transfer-form">
            <label className="hg-transfer-input-label" htmlFor="hg-transfer-amount">{amountLabelText}</label>
            <input
              id="hg-transfer-amount"
              className="hg-transfer-input"
              value={form?.amount ?? ''}
              onChange={(e) => onChangeAmount(e.target.value)}
              placeholder="输入划转金额"
              inputMode="decimal"
            />
            {candidates.length === 0 && !walletLoading ? (
              <div className="hg-error hg-transfer-error">当前没有可与事件合约互转的钱包</div>
            ) : null}
            {submitError ? <div className="hg-error hg-transfer-error">{submitError}</div> : null}
          </div>
        </div>

        <button
          type="button"
          className="hg-submit-btn"
          disabled={submitLoading || walletLoading || candidates.length === 0}
          onClick={onSubmit}
        >
          {submitLoading ? '划转中...' : '确认划转'}
        </button>
      </div>
    </div>
  );
}

export default TransferDrawer;
