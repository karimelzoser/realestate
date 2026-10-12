import { assertNotificationGatewayRuntimeConfiguration } from './runtime-config.js';

assertNotificationGatewayRuntimeConfiguration();
const runtime = await import('./main.js');
export const notificationGatewayServer = runtime.server;
