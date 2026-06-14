import { BALL_API_ORIGIN, getBallApiBaseUrl } from './config';

test('正式 API 域名指向 ball-stack', () => {
  expect(BALL_API_ORIGIN).toBe('https://ball-stack.skybit.shop');
});

test('浏览器环境使用当前同源地址以走开发或生产代理', () => {
  expect(getBallApiBaseUrl()).toBe(window.location.origin);
});
