# Object-storage CORS for browser uploads

PRENEURA transaction documents are uploaded directly from the production web application to S3-compatible object storage. The API issues a short-lived, transaction-scoped presigned `PUT` URL and verifies the resulting object before the document record can be finalized.

The storage bucket therefore needs an explicit CORS policy for the production web origin. Do **not** use `*` in production when a fixed PRENEURA web domain is available.

## Required browser request

The browser sends:

- method: `PUT`
- `Content-Type`
- `x-amz-checksum-sha256`
- `x-amz-meta-preneura-sha256`

The browser owns `Content-Length`; JavaScript cannot set that forbidden header directly. PRENEURA still declares the expected byte size when signing the `PutObject` request and verifies the stored `ContentLength` again with `HeadObject` before finalization.

## AWS S3 example

Replace the origin with the actual production web domain:

```json
[
  {
    "AllowedOrigins": [
      "https://app.example.com"
    ],
    "AllowedMethods": [
      "PUT"
    ],
    "AllowedHeaders": [
      "Content-Type",
      "x-amz-checksum-sha256",
      "x-amz-meta-preneura-sha256"
    ],
    "ExposeHeaders": [
      "ETag"
    ],
    "MaxAgeSeconds": 300
  }
]
```

For local development, add the exact local web origin separately, for example `http://localhost:3000`. Do not replace the production origin with a wildcard just to make local testing easier.

## S3-compatible providers

Cloudflare R2, MinIO and other S3-compatible stores use provider-specific CORS configuration surfaces, but the effective policy must permit the same origin, `PUT` method and headers above.

The object store must also preserve at least one of these integrity values so PRENEURA can verify the object:

- provider SHA-256 checksum matching `x-amz-checksum-sha256`, or
- object metadata `preneura-sha256` matching the expected SHA-256 hex digest.

## Failure behavior

A successful raw `PUT` is not enough to create a valid PRENEURA document. The finalize endpoint performs `HeadObject` and rejects the business record unless all of these match the original upload intent:

1. object key prefix and exact object key,
2. byte size,
3. MIME type,
4. SHA-256 integrity digest.

This keeps object storage outside the API data path without trusting browser-supplied metadata after upload.
