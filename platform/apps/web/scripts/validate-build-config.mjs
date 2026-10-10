const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
if (!raw) {
  throw new Error('NEXT_PUBLIC_API_URL is required for the production web build.');
}

let url;
try {
  url = new URL(raw);
} catch {
  throw new Error('NEXT_PUBLIC_API_URL must be an absolute URL.');
}

const hostname = url.hostname.toLowerCase();
const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
const githubLoopbackFixture = process.env.GITHUB_ACTIONS === 'true' && loopback && url.protocol === 'http:';

if (!githubLoopbackFixture && url.protocol !== 'https:') {
  throw new Error('NEXT_PUBLIC_API_URL must use HTTPS for the production web build.');
}

if (!githubLoopbackFixture && loopback) {
  throw new Error('NEXT_PUBLIC_API_URL must not target localhost for the production web build.');
}

if (url.username || url.password) {
  throw new Error('NEXT_PUBLIC_API_URL must not contain credentials.');
}

if (url.search || url.hash) {
  throw new Error('NEXT_PUBLIC_API_URL must not contain query parameters or a fragment.');
}

console.log(`Validated production API origin: ${url.origin}${githubLoopbackFixture ? ' (GitHub CI fixture)' : ''}`);
