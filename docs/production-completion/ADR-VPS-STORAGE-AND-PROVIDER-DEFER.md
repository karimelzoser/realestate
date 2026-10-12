# Private storage integrity and deferred delivery credentials

The isolated VPS uses real service implementations. The user will supply external delivery credentials later. This does not permit simulated delivery or phone-OTP privilege escalation.

## Stored-byte and immutable-object contract

Browser upload URLs now sign `If-None-Match: *`, the content type, checksum and metadata headers. Checksum/metadata remain signed headers rather than being duplicated in both query and headers. The backend also streams the physical object and verifies its length and SHA256; provider metadata alone is insufficient evidence. Inspection reads enforce their maximum even when the object response omits Content-Length. A separate public HTTPS origin is used for browser URLs while internal API reads use the private S3 endpoint.

The actual Garage2.4.1 candidate failed conditional overwrite rejection. Only the newly created Garage container was stopped; its own volumes were retained. It is not a qualified document store. SeaweedFS4.48 passed actual private S3 PUT/HEAD/GET, native checksum rejection, eight simultaneous conditional creates with one winner, presigned upload/replay/tampering, anonymous-access rejection and CORS qualification. It runs as UID1000 with no additional Linux capabilities and its own persistent volume. The single-node configuration is for public testing; encrypted off-host backup/restore, public browser-path qualification and durable production capacity/availability remain acceptance items. No existing project storage is reused.

The new authenticated scanner restricts exact object origins and the owned bucket/tenant prefix, refuses redirects, bounds body size/concurrency, verifies physical SHA256 before ClamAV INSTREAM, and treats unknown/scan-limit verdicts as unavailable. Health and scanning require recent antivirus definitions. ClamAV1.5.4 is a real private engine: actual clean-file, benign EICAR detection, wrong-digest and unauthorized-call tests passed. Unit transport simulators are explicitly separate from hosted engine evidence.

## Provider deferral

In `APP_ENV=public-test`, `AUTH_PHONE_LOGIN_ENABLED=false` returns unavailable before identity lookup or challenge creation. The bilingual login shows this condition and offers organization SSO only when configured. It uses the server-selected SMS/WhatsApp channel when phone delivery is enabled. Empty `OIDC_IDP_HINT` selects the separate organization realm without pretending Google federation is configured. Verified issuer/nonce/fresh-MFA requirements and reviewed privileged-factor enrollment remain intact.

`NOTIFICATION_EXTERNAL_DELIVERY_ENABLED=false` prevents external jobs from being claimed or consuming attempts; real IN_APP delivery remains enabled and idempotent. New actual-DB certification proves this behavior. Neither pause is permitted to masquerade as a normal production configuration. The gateway stays in the explicit `delivery` profile and requires genuine provider credentials before starting. It receives a separate restricted database role and contact key, not API cookie/authentication secrets. Workers cannot read auth-session/MFA evidence or write role assignments.

## Operational boundaries

The new Keycloak26.8.0 realm/database/client are independent of existing PRENEURA. Configuration checks confirm required password/OTP steps, genuine LoA mapping, PKCE, exact callback, client-secret resolution and disabled direct/implicit/device/service grants. No hardcoded AAL2 claim mapper is used. Human MFA, independent owner approval and subsequent staff/provider UAT remain outstanding.

Private telemetry strips query strings and authorization/cookie fields. Runtime bootstrap persists a private secret bundle before writing environments, resumes only matching interrupted initialization, and never silently rotates encryption keys on a later release. API, worker, gateway and frontend have separate runtime environments. The public edge owns only8443/8444 and uses a separate certificate; it never attaches to n8n's proxy/network.

Primary references: [AWS conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html), [SeaweedFS4.48 release](https://github.com/seaweedfs/seaweedfs/releases/tag/4.48), [ClamAV1.5.4 release](https://github.com/Cisco-Talos/clamav/releases/tag/clamav-1.5.4), [Keycloak step-up authentication](https://www.keycloak.org/docs/latest/server_admin/index.html#_step-up-flow).
