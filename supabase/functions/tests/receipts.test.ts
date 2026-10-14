import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('receipt migration preserves history and deduplicates authenticated retries', async () => {
  const db = new PGlite();
  const owner = '00000000-0000-0000-0000-000000000001';
  const video = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.owner', true),'')::uuid $$;
      create table suggestions(id uuid primary key);
      create table user_suggestions(id uuid default gen_random_uuid(), user_id uuid, suggestion_id uuid, recommended_at timestamptz, is_interested boolean);
      insert into suggestions values ('${video}');
      insert into user_suggestions(user_id,suggestion_id,is_interested) values ('${owner}','${video}',true),('${owner}','${video}',false);`);
    await db.exec(await readFile(new URL('../../migrations/202610140004_suggestion_receipts.sql', import.meta.url), 'utf8'));
    await db.exec(`set role authenticated; select set_config('test.owner','${owner}',false); select fuse_receive_suggestions(array['${video}']::uuid[],auth.uid()); reset role;`);
    assert.equal((await db.query('select count(*)::int as n from user_suggestions')).rows[0].n, 2);
    await db.exec(`set role authenticated; select set_config('test.owner','00000000-0000-0000-0000-000000000003',false); select fuse_receive_suggestions(array['${video}','${video}']::uuid[],auth.uid()); select fuse_receive_suggestions(array['${video}']::uuid[],auth.uid()); reset role;`);
    assert.equal((await db.query('select count(*)::int as n from user_suggestions')).rows[0].n, 3);
    await db.exec(`set role authenticated; select set_config('test.owner','${owner}',false);`);
    await assert.rejects(db.exec(`select fuse_receive_suggestions(array['${video}']::uuid[],'00000000-0000-0000-0000-000000000003')`), /Sign in required/);
    await db.exec("set role authenticated; select set_config('test.owner','',false);");
    await assert.rejects(db.exec(`select fuse_receive_suggestions(array['${video}']::uuid[],auth.uid())`), /Sign in required/);
  } finally { await db.close(); }
});
