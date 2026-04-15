import React from 'react';

function SlipDrawer({
  open,
  slip,
  balance,
  coin,
  onClose,
  onChangeStake,
  onRemove,
  onSubmit,
  submitLoading,
  submitDisabled,
  submitError,
  conflictMessage,
  totalWin,
}) {
  if (!open) return null;

  return (
    <div className="hg-overlay" onClick={onClose}>
      <div className="hg-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="hg-drawer-head">
          <div>
            <div className="hg-drawer-title">注单 {slip.length}</div>
            <div className="hg-drawer-sub">余额 {(coin || 'USDT').toUpperCase()} {Number(balance ?? 0).toLocaleString('en-US')}</div>
          </div>
          <button type="button" className="hg-icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="hg-slip-list">
          {slip.length === 0 ? <div className="hg-empty-state">点击赔率加入注单</div> : slip.map((item) => (
            <div key={item.key} className="hg-slip-item">
              <button type="button" className="hg-slip-remove" onClick={() => onRemove(item.key)}>×</button>
              <div className="hg-slip-meta">
                <div className="hg-slip-kind">{item.displayBigTypeName || item.bigTypeName || item.label || '投注'}</div>
                <div className="hg-slip-desc">{item.selectionText}</div>
                <div className="hg-slip-odd">{item.marketText} @ {item.odds}</div>
              </div>
              <div className="hg-slip-stake">
                <input
                  value={item.stake ?? ''}
                  onChange={(e) => onChangeStake(item.key, e.target.value)}
                  placeholder="输入下注金额"
                />
                <small>可赢 {item.win ?? '-'}</small>
              </div>
            </div>
          ))}
        </div>
        <div className="hg-slip-summary">
          <div>总额 {slip.reduce((sum, item) => sum + (Number(item.stake) || 0), 0).toFixed(2)}</div>
          <div>预计可赢 {totalWin.toFixed(2)}</div>
          {conflictMessage ? <div className="hg-error">{conflictMessage}</div> : null}
          {submitError ? <div className="hg-error">{submitError}</div> : null}
        </div>
        <button type="button" className="hg-submit-btn" onClick={onSubmit} disabled={submitDisabled || submitLoading}>
          {submitLoading ? '下注中...' : '下注'}
        </button>
      </div>
    </div>
  );
}

export default SlipDrawer;
