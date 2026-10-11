import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Database } from '@preneura/database';
import type { Kysely } from 'kysely';
import { PostgresAuthRepository } from '../src/auth/auth.repository.js';

function repositoryFixture(subjectOwner: string | null = null, userSubject: string | null = null) {
  let read = 0;
  let insertions = 0;
  const database = {
    transaction: () => ({ execute: (action: (db: unknown) => unknown) => action(database) }),
    selectFrom: () => {
      const index = read++;
      const query = {
        select: () => query,
        where: () => query,
        executeTakeFirst: async () => index === 0
          ? subjectOwner ? { user_id: subjectOwner } : undefined
          : userSubject ? { provider_subject: userSubject } : undefined,
      };
      return query;
    },
    insertInto: () => {
      const query = {
        values: () => query,
        onConflict: () => query,
        returning: () => query,
        executeTakeFirst: async () => { insertions++; return { user_id: 'target' }; },
      };
      return query;
    },
  };
  return {
    repository: new PostgresAuthRepository(database as unknown as Kysely<Database>),
    insertions: () => insertions,
  };
}

const request = { userId: 'target', provider: 'google', providerSubject: 'verified-subject' };

test('an unrelated MFA identity cannot enroll during ordinary privileged step-up', async () => {
  const fixture = repositoryFixture();
  assert.equal(await fixture.repository.linkExternalIdentityToUser(request), 'ENROLLMENT_REQUIRED');
  assert.equal(fixture.insertions(), 0);
});

test('an existing matching identity can step up without enrolling a new factor', async () => {
  const fixture = repositoryFixture('target');
  assert.equal(await fixture.repository.linkExternalIdentityToUser(request), 'ALREADY_LINKED');
  assert.equal(fixture.insertions(), 0);
});

test('another account identity cannot be reassigned even with enrollment permission', async () => {
  const fixture = repositoryFixture('other-user');
  assert.equal(await fixture.repository.linkExternalIdentityToUser({ ...request, allowNewLink: true }), 'CONFLICT');
  assert.equal(fixture.insertions(), 0);
});

test('a bound provider identity cannot be replaced by a different subject', async () => {
  const fixture = repositoryFixture(null, 'original-subject');
  assert.equal(await fixture.repository.linkExternalIdentityToUser({ ...request, allowNewLink: true }), 'CONFLICT');
  assert.equal(fixture.insertions(), 0);
});

test('first-time nonprivileged enrollment requires explicit permission', async () => {
  const fixture = repositoryFixture();
  assert.equal(await fixture.repository.linkExternalIdentityToUser({ ...request, allowNewLink: true }), 'LINKED');
  assert.equal(fixture.insertions(), 1);
});
