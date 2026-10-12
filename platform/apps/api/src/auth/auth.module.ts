import { Module, type Provider } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository, PostgresAuthRepository } from './auth.repository.js';
import { GoogleAuthController } from './google-auth.controller.js';
import { GoogleOidcService } from './google-oidc.service.js';
import { DevelopmentOtpDelivery, GatewayOtpDelivery, OtpDeliveryPort } from './otp-delivery.js';
import { SessionActivityService } from './session-activity.service.js';
import { SessionAuthGuard } from './session-auth.guard.js';
import { IdentityEnrollmentRepository } from './identity-enrollment.repository.js';
import { IdentityEnrollmentController } from './identity-enrollment.controller.js';

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
  controllers: [AuthController, GoogleAuthController, IdentityEnrollmentController],
  providers: [
    PostgresAuthRepository,
    IdentityEnrollmentRepository,
    { provide: AuthRepository, useExisting: PostgresAuthRepository },
    otpDeliveryProvider,
    AuthService,
    GoogleOidcService,
    SessionActivityService,
    SessionAuthGuard,
  ],
  exports: [AuthService, SessionActivityService, SessionAuthGuard],
})
export class AuthModule {}
