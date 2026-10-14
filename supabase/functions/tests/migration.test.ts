import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('direct migration preserves archives, retires RPCs, and protects registration/recap transactions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table users(id uuid primary key);
      create table tasks(id uuid primary key);
      create table schedules(id uuid primary key);
      create table calendar_connections(id uuid primary key default gen_random_uuid(),user_id uuid unique,google_account_id text,google_acc text,google_calendar_id text,connection_status text check (connection_status in ('connected','disconnected','error')),calendar_sync_token text,lease_token uuid,lease_until timestamptz,last_error text);
      create table organizer_settings(user_id uuid primary key,connection_generation bigint default 0,timezone text default 'UTC',recap_lease_token uuid,recap_lease_until timestamptz);
      create table organizer_credentials(connection_id uuid primary key,encrypted_refresh_token text);
      create table organizer_oauth_states(state text);
      create table organizer_sync_queue(item_id uuid);
      create table organizer_completion_history(id bigint generated always as identity);
      create table organizer_daily_recaps(user_id uuid,local_date date,timezone text,completed_today text,tomorrow_plan text,generated_at timestamptz,input_revision bigint,source_status jsonb,primary key(user_id,local_date));
      grant all on tasks,schedules,organizer_oauth_states,organizer_sync_queue,organizer_completion_history to anon,authenticated,service_role;
      create function fuse_track_activity() returns trigger language plpgsql as $$ begin return new; end $$;
      create trigger fuse_activity_history before insert or update on tasks for each row execute function fuse_track_activity();
      create trigger fuse_activity_history before insert or update on schedules for each row execute function fuse_track_activity();
      create function fuse_ack_completion(text,uuid,uuid) returns void language sql as $$ select; $$;
      insert into tasks values('00000000-0000-0000-0000-000000000001');
      insert into organizer_settings(user_id) values('00000000-0000-0000-0000-000000000002');
      insert into calendar_connections(id,user_id,google_account_id,connection_status) values('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002','account','connected');
      insert into organizer_credentials(connection_id,encrypted_refresh_token) values('00000000-0000-0000-0000-000000000004','legacy-encrypted');
    `);
    await db.exec(await readFile(new URL('../../migrations/202610140002_google_direct.sql', import.meta.url), 'utf8'));
    const owner = '00000000-0000-0000-0000-000000000002';
    assert.equal((await db.query('select connection_status from calendar_connections')).rows[0].connection_status, 'reconnect_required');
    await db.exec("update calendar_connections set connection_status='error'");
    await assert.rejects(db.exec("update calendar_connections set connection_status='invalid'"), /check constraint/);
    assert.equal((await db.query('select count(*)::int as count from tasks')).rows[0].count, 1);
    assert.equal((await db.query("select to_regprocedure('fuse_ack_completion(text,uuid,uuid)') as rpc")).rows[0].rpc, null);
    assert.equal((await db.query("select has_table_privilege('authenticated','tasks','select') as allowed")).rows[0].allowed, false);
    await db.query("select fuse_register_google($1,0,'account','person@example.com','encrypted','client')", [owner]);
    assert.equal((await db.query('select connection_generation::int as generation from organizer_settings')).rows[0].generation, 1);
    await assert.rejects(db.query("select fuse_register_google($1,0,'account','person@example.com','encrypted','client')", [owner]), /cancelled or replaced/);
    await assert.rejects(db.query("select fuse_register_google($1,1,'another','person@example.com','encrypted','client')", [owner]), /original Google account/);
    const lease = '00000000-0000-0000-0000-000000000003';
    await db.query('update organizer_settings set recap_lease_token=$1 where user_id=$2', [lease,owner]);
    const payload = {local_date:'2026-10-14',completed_today:'Current Google data',tomorrow_plan:'Tomorrow',generated_at:'2026-10-14T12:00:00Z',source_status:{tasks:'ok',events:'ok'}};
    const saved = await db.query('select * from fuse_save_google_recap($1,$2,1,\'UTC\',$3::jsonb)', [owner,lease,JSON.stringify(payload)]);
    assert.equal(saved.rows.length, 1);
    await db.query('select fuse_disconnect_google($1)', [owner]);
    assert.equal((await db.query('select count(*)::int as count from organizer_credentials')).rows[0].count, 0);
    assert.equal((await db.query('select * from fuse_save_google_recap($1,$2,1,\'UTC\',$3::jsonb)', [owner,lease,JSON.stringify(payload)])).rows.length, 0);
  } finally { await db.close(); }
});
