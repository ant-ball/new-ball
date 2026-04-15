import React from 'react';

function MatchCard({ match, mode, subTab, onPickOdds, onMore, homeName, awayName, matchTime, liveClock, score, isRolling, preColumns, rollingColumns, correctScoreSections }) {
  return (
    <section className="hg-match-card">
      <div className="hg-match-head">
        <div className="hg-match-time">
          <span className="hg-heart">♡</span>
          <span>{liveClock || matchTime || '即将开赛'}</span>
          {isRolling ? <span className="hg-live-tag">中</span> : null}
        </div>
        <div className="hg-match-right">
          <span className="hg-score">{score !== '-' ? score : ''}</span>
          <span className="hg-status">{isRolling ? '滚球' : mode}</span>
        </div>
      </div>
      <div className="hg-match-body">
        <div className="hg-team-col">
          <div className="hg-team-name">{homeName}</div>
          <div className="hg-team-name">{awayName}</div>
          <div className="hg-match-mini">ID {match?.bet365Id ?? match?.id ?? '-'}</div>
        </div>
        <div className="hg-odds-col">
          {subTab === '波胆' ? (
            <div className="hg-correct-score-sections">
              {correctScoreSections.length > 0 ? (
                correctScoreSections.map((section) => (
                  <div className="hg-correct-score-block" key={section.key}>
                    <div className="hg-market-title">{section.label}</div>
                    <div className="hg-correct-score-grid">
                      {section.items.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          className={`hg-score-cell ${item.suspended ? 'is-locked' : ''}`}
                          onClick={() => !item.suspended && onPickOdds?.(item.pickPayload)}
                        >
                          <span>{item.label}</span>
                          <strong>{item.odds}</strong>
                          {item.suspended ? <em>🔒</em> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="hg-empty-box">暂无波胆</div>
              )}
            </div>
          ) : isRolling ? (
            <div className="hg-market-grid rolling">
              {rollingColumns.length > 0 ? rollingColumns.map((col) => (
                <div className="hg-market-column" key={col.id}>
                  <div className="hg-market-title">{col.title}</div>
                  <div className="hg-market-items">
                    {col.options.map((item, idx) => (
                      <button
                        type="button"
                        className={`hg-mini-cell ${item.suspended ? 'is-locked' : ''}`}
                        key={item.id || idx}
                        onClick={() => !item.suspended && onPickOdds?.(item.pickPayload)}
                      >
                        <span>{item.label}</span>
                        <strong>{item.odds}</strong>
                        {item.suspended ? <em>🔒</em> : null}
                      </button>
                    ))}
                  </div>
                </div>
              )) : <div className="hg-empty-box">赔率同步中</div>}
            </div>
          ) : (
            <div className="hg-market-grid">
              {preColumns.map((col) => (
                <div className="hg-market-column" key={col.key}>
                  <div className="hg-market-title">{col.label}</div>
                  <div className="hg-market-items">
                    {col.items.length > 0 ? col.items.map((item, idx) => (
                      <button
                        type="button"
                        className="hg-mini-cell"
                        key={item.id || idx}
                        onClick={() => onPickOdds?.(item.pickPayload)}
                      >
                        <span>{item.label}</span>
                        <strong>{item.odds}</strong>
                      </button>
                    )) : <div className="hg-empty-cell">封盘</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="hg-match-footer">
        <button className="hg-more-btn" type="button" onClick={() => onMore?.(match)}>更多玩法</button>
      </div>
    </section>
  );
}

export default MatchCard;
