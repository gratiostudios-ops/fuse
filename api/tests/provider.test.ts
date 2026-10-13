/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertGoogleProviderEnabled, GoogleProviderDisabledError } from '../auth/provider';

const config = { url: 'https://project.example.test', publishableKey: 'sb_publishable_test' };

test('disabled Google provider is reported before redirecting out of the app', async () => {
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://project.example.test/auth/v1/settings');
    assert.equal(new Headers(init?.headers).get('apikey'), config.publishableKey);
    return new Response(JSON.stringify({ external: { google: false } }));
  };
  await assert.rejects(assertGoogleProviderEnabled(config, request), GoogleProviderDisabledError);
});

test('enabled Google provider allows the sign-in flow to proceed', async () => {
  await assertGoogleProviderEnabled(config, async () => new Response(JSON.stringify({ external: { google: true } })));
});

test('provider-settings failures are distinguished from a disabled provider', async () => {
  await assert.rejects(assertGoogleProviderEnabled(config, async () => new Response('', { status: 503 })), /Could not check/);
});
