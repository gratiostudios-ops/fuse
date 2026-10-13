import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
test('AI SQL enforces owner reads and independent atomic request budgets', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      create table auth.users (id uuid primary key);
      insert into auth.users values ('${alice}'), ('${bob}');`);
    for (const table of ['schedules', 'preferences', 'user_topics', 'user_suggestions']) {
      await db.exec(`create table public.${table} (id uuid primary key, user_id uuid);
        insert into public.${table} values ('${alice}', '${alice}'), ('${bob}', '${bob}');
        create policy broad_read on public.${table} for select using (true);`);
    }
    const sql = await readFile('api/sql/ai-setup.sql', 'utf8');
    await db.exec(sql); await db.exec(sql);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${alice}';`);
    for (const table of ['schedules', 'preferences', 'user_topics', 'user_suggestions']) {
      assert.deepEqual((await db.query(`select id from public.${table}`)).rows, [{ id: alice }]);
    }
    const allow = async (mode: string) => (await db.query<{ allowed: boolean }>('select public.fuse_ai_allow_request($1) as allowed', [mode])).rows[0].allowed;
    for (let i = 0; i < 20; i++) assert.equal(await allow('chat'), true);
    assert.equal(await allow('chat'), false);
    for (let i = 0; i < 6; i++) assert.equal(await allow('home'), true);
    assert.equal(await allow('home'), false);
    assert.equal(await allow('invalid'), false);
    await assert.rejects(db.query('update public.fuse_ai_limits set request_count = 0'), /permission denied/);
    await db.exec(`set request.jwt.claim.sub = '${bob}';`);
    assert.equal(await allow('chat'), true);
    await db.exec(`reset role; update public.fuse_ai_limits set window_start = now() - interval '2 hours'; set role authenticated; set request.jwt.claim.sub = '${alice}';`);
    assert.equal(await allow('chat'), true);
    await db.exec(`set request.jwt.claim.sub = '';`);
    assert.equal(await allow('chat'), false);
  } finally { await db.close(); }
});
