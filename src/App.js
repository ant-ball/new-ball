import React, { useCallback, useEffect, useState } from 'react';
import './App.css';
import Ball from './Ball';
import { fetchUserBalance, fetchUserInfo, getExternalTokenFromUrl, getStoredBallToken, tokenLogin } from './auth';
import PolymarketApp from './PolymarketApp';

function App() {
  const [baseUrl] = useState('https://ball.skybit.shop');
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [userInfo, setUserInfo] = useState(null);
  const [balance, setBalance] = useState(null);
  const [viewMode, setViewMode] = useState('ball');

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
        if (!cancelled) {
          setAuthError(err?.message || '登录失败');
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  const activeLabel = viewMode === 'ball' ? '球盘' : 'Polymarket';

  const refreshBalance = useCallback(async () => {
    try {
      const bal = await fetchUserBalance(baseUrl);
      setBalance(bal);
    } catch (err) {
      console.warn('刷新余额失败:', err);
    }
  }, [baseUrl]);

  // 将刷新余额函数挂载到 window 上，供子组件调用
  useEffect(() => {
    window.refreshBalance = refreshBalance;
    return () => {
      delete window.refreshBalance;
    };
  }, [refreshBalance]);

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-brand">
          <div className="app-brand-mark">B</div>
          <div>
            <div className="app-brand-title">ball</div>
            <div className="app-brand-subtitle">隔离视图切换</div>
          </div>
        </div>
        <div className="app-mode-switch" role="tablist" aria-label="view mode switch">
          <button
            type="button"
            className={viewMode === 'ball' ? 'app-mode-btn active' : 'app-mode-btn'}
            onClick={() => setViewMode('ball')}
          >
            球盘
          </button>
          <button
            type="button"
            className={viewMode === 'poly' ? 'app-mode-btn active' : 'app-mode-btn'}
            onClick={() => setViewMode('poly')}
          >
            Polymarket
          </button>
        </div>
      </header>

      <section className="app-statusbar">
        <div className="app-status-meta">
          {authLoading ? (
            <span>登录中...</span>
          ) : authError ? (
            <span className="app-error">登录/余额失败：{authError}</span>
          ) : (
            <>
              <span>用户：{userInfo?.account || userInfo?.loginAccount || userInfo?.nickName || '-'}</span>
              <span>用户ID：{userInfo?.id || userInfo?.userId || '-'}</span>
              <span>余额：{balance?.amount ?? '-'}</span>
              <span>冻结：{balance?.froze ?? '-'}</span>
            </>
          )}
        </div>
        <div className="app-active-mode">当前视图：{activeLabel}</div>
      </section>

      <main className="app-main">
        {authLoading ? null : authError ? null : viewMode === 'ball' ? (
          <Ball />
        ) : (
          <PolymarketApp baseUrl={baseUrl} balance={balance} />
        )}
      </main>
    </div>
  );
}

export default App;
