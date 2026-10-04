import { z } from 'zod';

export const loginMethodSchema = z.enum(['phone', 'national_id']);
export type LoginMethod = z.infer<typeof loginMethodSchema>;

export const otpChannelSchema = z.enum(['sms', 'whatsapp']);
export type OtpChannel = z.infer<typeof otpChannelSchema>;

export const startLoginSchema = z.object({
  method: loginMethodSchema,
  identifier: z.string().trim().min(6).max(64),
  channel: otpChannelSchema.optional().default('sms'),
});
export type StartLoginInput = z.infer<typeof startLoginSchema>;

export const startLoginResponseSchema = z.object({
  challengeId: z.string().uuid(),
  expiresInSeconds: z.number().int().positive(),
  message: z.string(),
});
export type StartLoginResponse = z.infer<typeof startLoginResponseSchema>;

export const verifyOtpSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6,8}$/),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const authSessionSchema = z.object({
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  expiresAt: z.string().datetime(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const genericLoginMessage =
  'If the details match an active PRENEURA account, a one-time code will be sent to the registered phone.';
