import { initializeObservability, shutdownObservability } from '@preneura/observability';

initializeObservability('preneura-notification-gateway');

process.once('beforeExit', () => {
  void shutdownObservability().catch(() => undefined);
});
