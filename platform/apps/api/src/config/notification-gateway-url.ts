export function resolveNotificationGatewayUrl(
  explicitEnvName: 'AUTH_OTP_GATEWAY_URL' | 'CONTACT_VERIFICATION_GATEWAY_URL',
  path: '/auth-otp' | '/contact-verification',
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env[explicitEnvName]?.trim();
  if (explicit) return explicit;

  const hostport = env.NOTIFICATION_GATEWAY_HOSTPORT?.trim();
  if (!hostport) {
    throw new Error(`${explicitEnvName} or NOTIFICATION_GATEWAY_HOSTPORT is required.`);
  }

  return `http://${hostport}${path}`;
}
