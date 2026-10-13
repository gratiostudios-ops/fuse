/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

test('SQL keeps suggestions public and enforces task ownership despite a broad policy', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      grant usage on schema auth to anon, authenticated;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table auth.users (
        id uuid primary key, email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now()
      );
      create table public.users (id uuid primary key references auth.users(id), name text, email_id text, created_at timestamptz);
      create table public.tasks (
        id uuid primary key, user_id uuid references public.users(id), title text,
        due_date date, due_time time
      );
      create table public.suggestions (id uuid primary key, is_active boolean);
      create table public.topics (id uuid primary key, name text);
      create table public.suggestion_topics (
        suggestion_id uuid references public.suggestions(id), topic_id uuid references public.topics(id),
        primary key (suggestion_id, topic_id)
      );
      insert into auth.users (id, email) values ('${ALICE}', 'alice@example.test');
      create policy legacy_broad_task_read on public.tasks for select using (true);
      grant select on public.tasks to anon, authenticated;
    `);
    const catalog = await readFile('api/sql/catalog-read.sql', 'utf8');
    const tasks = await readFile('api/sql/private-tasks.sql', 'utf8');
    await db.exec(catalog);
    await db.exec(tasks);
    // Both scripts must be safe to rerun.
    await db.exec(catalog);
    await db.exec(tasks);
    assert.equal((await db.query('select * from public.users')).rows.length, 1);
    await db.exec(`
      insert into auth.users (id, email) values ('${BOB}', 'bob@example.test');
      insert into public.tasks (id, user_id, title) values ('${ALICE}', '${ALICE}', 'Alice task'), ('${BOB}', '${BOB}', 'Bob task');
      insert into public.topics values ('${ALICE}', 'React');
      insert into public.suggestions values ('${ALICE}', true), ('${BOB}', false);
      insert into public.suggestion_topics values ('${ALICE}', '${ALICE}'), ('${BOB}', '${ALICE}');
      set role anon;
    `);
    assert.equal((await db.query('select * from public.suggestions')).rows.length, 1);
    assert.equal((await db.query('select * from public.suggestion_topics')).rows.length, 1);
    assert.equal((await db.query('select * from public.topics')).rows.length, 1);
    await assert.rejects(db.query('select * from public.tasks'), /permission denied/);
    // Even if an old grant is restored later, restrictive RLS prevents anonymous reads.
    await db.exec('reset role; grant select on public.tasks to anon; set role anon;');
    assert.deepEqual((await db.query('select * from public.tasks')).rows, []);
    await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${ALICE}';`);
    assert.deepEqual((await db.query('select title from public.tasks')).rows, [{ title: 'Alice task' }]);
    assert.deepEqual((await db.query(`select * from public.tasks where user_id = '${BOB}'`)).rows, []);
    await db.exec(`set request.jwt.claim.sub = '${BOB}';`);
    assert.deepEqual((await db.query('select title from public.tasks')).rows, [{ title: 'Bob task' }]);
    await db.exec(`reset role;`);
    assert.equal((await db.query('select * from public.users')).rows.length, 2);
  } finally {
    await db.close();
  }
});
