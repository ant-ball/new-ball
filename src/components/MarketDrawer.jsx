import React from 'react';

function MarketDrawer({ open, match, sections, onClose, onPickOdds }) {
  if (!open || !match) return null;

  return (
    <div className="hg-overlay" onClick={onClose}>
      <div className="hg-drawer hg-market-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="hg-drawer-head">
          <div>
            <div className="hg-drawer-title">更多玩法</div>
            <div className="hg-drawer-sub">{match?.homeNameCN || match?.homeTeamName || '主队'} VS {match?.awayNameCN || match?.awayTeamName || '客队'}</div>
          </div>
          <button type="button" className="hg-icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="hg-market-drawer-body">
          {sections.length === 0 ? (
            <div className="hg-empty-state">暂无玩法数据</div>
          ) : (
            sections.map((section) => (
              <section className="hg-market-drawer-section" key={section.key}>
                <div className="hg-market-drawer-title">{section.label}</div>
                <div className="hg-market-drawer-grid">
                  {section.items.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`hg-mini-cell ${item.suspended ? 'is-locked' : ''}`}
                      onClick={() => !item.suspended && onPickOdds?.(item.pickPayload)}
                    >
                      <span>{item.label}</span>
                      <strong>{item.odds}</strong>
                      {item.suspended ? <em>🔒</em> : null}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default MarketDrawer;
