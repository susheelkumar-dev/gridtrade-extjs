import type { AppConfig } from '@extreact/framework';

/** GridTrade on the React shell: the API, the display registry, and the display that opens first. */
export const appConfig: AppConfig = {
  appId: 'gridtrade',
  title: 'GridTrade Contracts',
  subtitle: 'Energy contracts, trades and market data',
  apiBase: '/api',
  registryBase: '/registry/api/v1',
  home: 'dashboard',
};
