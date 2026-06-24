import { fetchUserBalance, fetchUserInfo } from './auth';

function mockResponse({ ok, status, body }) {
  return {
    ok,
    status,
    text: jest.fn().mockResolvedValue(body),
  };
}

beforeEach(() => {
  global.fetch = jest.fn();
  window.localStorage.setItem('ball_token', 'stored-token');
});

afterEach(() => {
  window.localStorage.clear();
  jest.restoreAllMocks();
});

test('接口返回 HTML 错误页时展示 HTTP 状态而不是 JSON 解析异常', async () => {
  fetch.mockResolvedValue(mockResponse({
    ok: false,
    status: 502,
    body: '<html><body>502 Bad Gateway</body></html>',
  }));

  await expect(fetchUserInfo('https://ball-stack.skybit.shop')).rejects.toThrow(
    'user/info 服务暂时不可用（HTTP 502）',
  );
});

test('余额接口正常返回 JSON 时读取 data', async () => {
  fetch.mockResolvedValue(mockResponse({
    ok: true,
    status: 200,
    body: JSON.stringify({ code: 0, data: { amount: 88 } }),
  }));

  await expect(fetchUserBalance('https://ball-stack.skybit.shop')).resolves.toEqual({ amount: 88 });
});
