import React, { useEffect, useState } from 'react';
import Ball from './Ball';
import { fetchUserBalance, fetchUserInfo, getExternalTokenFromUrl, getStoredBallToken, tokenLogin } from './auth';

function App() {
  const [baseUrl] = useState('https://ball.skybit.shop');
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [userInfo, setUserInfo] = useState(null);
  const [balance, setBalance] = useState(null);

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

  return (
    <div className="container mx-auto py-8">
      <header className="text-center mb-8">
        <h1 className="text-2xl font-bold">ball</h1>
        <div style={{ marginTop: 12, fontSize: 14, color: '#374151' }}>
          {authLoading ? (
            <span>登录中...</span>
          ) : authError ? (
            <span style={{ color: '#dc2626' }}>登录/余额失败：{authError}</span>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span>用户：{userInfo?.account || userInfo?.loginAccount || userInfo?.nickName || '-'}</span>
              <span>用户ID：{userInfo?.id || userInfo?.userId || '-'}</span>
              <span>余额：{balance?.amount ?? '-'}</span>
              <span>冻结：{balance?.froze ?? '-'}</span>
            </div>
          )}
        </div>
      </header>
      <Ball />
    </div>
  );
}

export default App;
