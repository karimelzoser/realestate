import { Module, type Provider } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository, PostgresAuthRepository } from './auth.repository.js';
import { GoogleAuthController } from './google-auth.controller.js';
import { GoogleOidcService } from './google-oidc.service.js';
import { DevelopmentOtpDelivery, GatewayOtpDelivery, OtpDeliveryPort } from './otp-delivery.js';
import { SessionAuthGuard } from './session-auth.guard.js';

const otpDeliveryProvider: Provider = {
  provide: OtpDeliveryPort,
  useFactory: () => {
    const provider = process.env.OTP_PROVIDER ?? 'console';
    if (provider === 'console') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('OTP_PROVIDER=console is forbidden in production');
      }
      return new DevelopmentOtpDelivery();
    }
    if (provider === 'gateway') return new GatewayOtpDelivery();
    throw new Error(`Unsupported OTP provider: ${provider}`);
  },
};

@Module({
  controllers: [AuthController, GoogleAuthController],
  providers: [
    PostgresAuthRepository,
    { provide: AuthRepository, useExisting: PostgresAuthRepository },
    otpDeliveryProvider,
    AuthService,
    GoogleOidcService,
    SessionAuthGuard,
  ],
  exports: [AuthService, SessionAuthGuard],
})
export class AuthModule {}
