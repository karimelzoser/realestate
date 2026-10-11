import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AuthRepository } from './auth.repository.js';
import { AuthService, type VerifiedLogin } from './auth.service.js';
import { oidcAssuranceFromClaims } from './auth-assurance.js';

export interface GoogleAuthorizationRequest {
  url: string;
  state: string;
  codeVerifier: string;
}

@Injectable()
export class GoogleOidcService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly authService: AuthService,
  ) {}

  createAuthorizationRequest(input: { requireAal2?: boolean } = {}): GoogleAuthorizationRequest {
    const issuer = this.required('OIDC_ISSUER').replace(/\/$/, '');
    const clientId = this.required('OIDC_CLIENT_ID');
    const redirectUri = this.required('OIDC_REDIRECT_URI');
    const state = randomBytes(24).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const url = new URL(`${issuer}/protocol/openid-connect/auth`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('kc_idp_hint', 'google');
    url.searchParams.set('prompt', input.requireAal2 ? 'login' : 'select_account');

    if (input.requireAal2) {
      const acrValues = this.approvedAcrValues();
      if (acrValues.length > 0) {
        url.searchParams.set('acr_values', acrValues.join(' '));
      }
    }

    return { url: url.toString(), state, codeVerifier };
  }

  async completeAuthorization(input: {
    code: string;
    codeVerifier: string;
    requireAal2?: boolean;
    targetUserId?: string;
  }): Promise<{ login: VerifiedLogin; accountStatus: 'ACTIVE' | 'PENDING' }> {
    const issuer = this.required('OIDC_ISSUER').replace(/\/$/, '');
    const clientId = this.required('OIDC_CLIENT_ID');
    const clientSecret = this.required('OIDC_CLIENT_SECRET');
    const redirectUri = this.required('OIDC_REDIRECT_URI');

    const tokenResponse = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code: input.code,
        code_verifier: input.codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      throw new UnauthorizedException('Google authentication could not be completed.');
    }

    const tokens = (await tokenResponse.json()) as { id_token?: string };
    if (!tokens.id_token) {
      throw new UnauthorizedException('Google identity token was not returned.');
    }

    const jwks = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
    const verified = await jwtVerify(tokens.id_token, jwks, {
      issuer,
      audience: clientId,
    });

    const subject = verified.payload.sub;
    if (!subject) {
      throw new UnauthorizedException('Google identity is missing a subject identifier.');
    }

    const assurance = oidcAssuranceFromClaims({
      acr: verified.payload.acr,
      amr: verified.payload.amr,
      approvedAcrValues: this.approvedAcrValues(),
    });
    if (input.requireAal2 && assurance.assuranceLevel !== 'AAL2') {
      throw new UnauthorizedException(
        'The identity provider did not satisfy the required multi-factor assurance.',
      );
    }

    const email =
      verified.payload.email_verified === true && typeof verified.payload.email === 'string'
        ? verified.payload.email
        : null;
    const displayName =
      typeof verified.payload.name === 'string'
        ? verified.payload.name
        : email ?? 'Google User';

    if (input.targetUserId) {
      if (assurance.assuranceLevel !== 'AAL2') {
        throw new UnauthorizedException('Account step-up requires AAL2 identity evidence.');
      }
      const linked = await this.repository.linkExternalIdentityToUser({
        userId: input.targetUserId,
        provider: 'google',
        providerSubject: subject,
        verifiedEmail: email,
      });
      if (linked === 'CONFLICT') {
        throw new UnauthorizedException(
          'This Google identity is already linked to another PRENEURA account.',
        );
      }

      const login = await this.authService.issueSessionForUser(
        input.targetUserId,
        { eventType: linked === 'LINKED' ? 'LOGIN_GOOGLE_OIDC_STEP_UP_LINKED' : 'LOGIN_GOOGLE_OIDC_STEP_UP_VERIFIED' },
        assurance,
      );
      return { login, accountStatus: 'ACTIVE' };
    }

    const identity = await this.repository.findOrProvisionExternalIdentity({
      provider: 'google',
      providerSubject: subject,
      displayName,
      verifiedEmail: email,
    });

    if (identity.status === 'DISABLED') {
      throw new UnauthorizedException('This PRENEURA account is disabled.');
    }

    const login = await this.authService.issueSessionForUser(
      identity.userId,
      {
        eventType: assurance.assuranceLevel === 'AAL2'
          ? 'LOGIN_GOOGLE_OIDC_AAL2_VERIFIED'
          : 'LOGIN_GOOGLE_OIDC_VERIFIED',
      },
      assurance,
    );

    return {
      login,
      accountStatus: identity.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING',
    };
  }

  private approvedAcrValues(): string[] {
    return (process.env.OIDC_AAL2_ACR_VALUES ?? '')
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private required(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`${name} is required`);
    }
    return value;
  }
}
