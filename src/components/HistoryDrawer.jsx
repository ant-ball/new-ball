import React from 'react';

function HistoryDrawer({ open, tab, setTab, loading, orderList, orderFlow, error, onClose, onRefresh }) {
  if (!open) return null;

  return (
    <div className="hg-overlay" onClick={onClose}>
      <div className="hg-drawer hg-history" onClick={(e) => e.stopPropagation()}>
        <div className="hg-drawer-head">
          <div>
            <div className="hg-drawer-title">投注记录</div>
            <div className="hg-drawer-sub">交易状况 / 账户历史</div>
          </div>
          <button type="button" className="hg-icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="hg-history-tabs">
          {['交易状况', '账户历史'].map((x) => (
            <button key={x} type="button" className={tab === x ? 'active' : ''} onClick={() => setTab(x)}>
              {x}
            </button>
          ))}
          <button type="button" className="hg-history-refresh" onClick={onRefresh}>刷新</button>
        </div>
        <div className="hg-history-body">
          {loading ? <div className="hg-empty-state">加载中...</div> : null}
          {!loading && error ? <div className="hg-empty-state error">{error}</div> : null}
          {!loading && !error && tab === '交易状况' ? (
            orderList.length > 0 ? orderList.map((item, idx) => (
              <div key={item.orderId || idx} className="hg-history-card">
                <div className="hg-history-card-head">
                  <strong>{item.betOrderName || item.marketName || '交易'}</strong>
                  <span>{item.betAmount ?? '-'}</span>
                </div>
                <div className="hg-history-card-body">{item.selectionText || item.betName || item.oddsMarkets || '-'}</div>
                <div className="hg-history-card-foot">
                  <span>{item.statusName || item.status || '已确认'}</span>
                  <span>{item.orderId || item.id || '-'}</span>
                </div>
              </div>
            )) : <div className="hg-empty-state">暂无交易</div>
          ) : !loading && !error ? (
            <div className="hg-history-summary">
              <div className="hg-summary-row"><span>总共</span><strong>{orderFlow?.sumBetsAmount ?? 0}</strong></div>
              <div className="hg-summary-row"><span>有效</span><strong>{orderFlow?.sumEffectiveAmount ?? 0}</strong></div>
              <div className="hg-summary-row"><span>赢 / 输</span><strong>{orderFlow?.sumSettlementAmount ?? 0}</strong></div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default HistoryDrawer;
