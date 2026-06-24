import { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { fetchUserBalance, fetchUserInfo, getExternalTokenFromUrl, getStoredBallToken } from './auth';

jest.mock('./auth');
jest.mock('./Ball', () => () => <div>球盘内容</div>);
jest.mock('./PolymarketApp', () => () => <div>预测市场内容</div>);

test('登录成功后展示用户与余额', async () => {
  getExternalTokenFromUrl.mockReturnValue('');
  getStoredBallToken.mockReturnValue('stored-token');
  fetchUserInfo.mockResolvedValue({ id: 7, account: 'tester' });
  fetchUserBalance.mockResolvedValue({ amount: 88, froze: 3 });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<App />);
  });

  expect(container.textContent).toContain('用户：tester');
  expect(container.textContent).toContain('余额：88');
  expect(container.textContent).toContain('球盘内容');

  act(() => root.unmount());
  container.remove();
});
