import { apiProxyRewrites } from './scripts/api-proxy-config.mjs';

export default {
  allowedDevOrigins: ['127.0.0.1'],
  async rewrites() {
    return apiProxyRewrites(process.env);
  },
};
