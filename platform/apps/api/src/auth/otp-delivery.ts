import { Injectable } from '@nestjs/common';
import type { DeliveryChannel } from './auth.repository.js';

export abstract class OtpDeliveryPort {
  abstract sendToUser(input: {
    userId: string;
    challengeId: string;
    code: string;
    channel: DeliveryChannel;
  }): Promise<void>;
}

@Injectable()
export class DevelopmentOtpDelivery extends OtpDeliveryPort {
  async sendToUser(input: {
    userId: string;
    challengeId: string;
    code: string;
    channel: DeliveryChannel;
  }): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Development OTP delivery is forbidden in production');
    }

    // Deliberately local-development only. Production adapters must never log OTP values.
    console.info(
      `[DEV OTP] channel=${input.channel} user=${input.userId} challenge=${input.challengeId} code=${input.code}`,
    );
  }
}
