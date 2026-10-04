import { Module, type Provider } from '@nestjs/common';
import { createDatabase } from '@preneura/database';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import {
  AuthRepository,
  DATABASE,
  PostgresAuthRepository,
} from './auth.repository.js';
import { DevelopmentOtpDelivery, OtpDeliveryPort } from './otp-delivery.js';

const databaseProvider: Provider = {
  provide: DATABASE,
  useFactory: () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required');
    }
    return createDatabase(connectionString);
  },
};

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
  controllers: [AuthController],
  providers: [
    databaseProvider,
    PostgresAuthRepository,
    { provide: AuthRepository, useExisting: PostgresAuthRepository },
    otpDeliveryProvider,
    AuthService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
