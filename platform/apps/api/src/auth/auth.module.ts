import { Module, type Provider } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository, PostgresAuthRepository } from './auth.repository.js';
import { GoogleAuthController } from './google-auth.controller.js';
import { GoogleOidcService } from './google-oidc.service.js';
import { DevelopmentOtpDelivery, OtpDeliveryPort } from './otp-delivery.js';

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
  ],
  exports: [AuthService],
})
export class AuthModule {}
