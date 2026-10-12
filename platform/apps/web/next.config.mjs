import { apiProxyRewrites } from './scripts/api-proxy-config.mjs';

export default {
  async rewrites() {
    return apiProxyRewrites(process.env);
  },
};
