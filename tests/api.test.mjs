import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../server/api.mjs';

const origin = 'https://chat.example.cn';
const env = { AIHUBMIX_API_KEY: 'example-service-credential', FAMILY_ACCESS_CODE: 'sample-household-phrase' };
const auth = { Authorization: 'Bearer example-user-credential' };
function providerReply(text = '请点右上角的设置。') {
  return { status: 'completed', output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }
  ] };
}
function req(path, body, headers = {}, method = body ? 'POST' : 'GET') {
  const opts = { method, headers: { Origin: origin, 'X-Model-Provider':'aihubmix', ...headers } };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return new Request(origin + path, opts);
}
const disposablePhoto = 'data:image/jpeg;base64,/9j/2Q==';
const question = { messages: [{ role: 'user', text: '在哪里设置？' }] };

test('a photo alone, previous turns, and BYOK reach the AIHubMix endpoint', async () => {
  let observed;
  const fetcher = async (url, init) => {
    observed = { url, ...init, body: JSON.parse(init.body) };
    return Response.json(providerReply(JSON.stringify({ text: '请点右上角的设置。', reading: null })));
  };
  const messages = [...question.messages, { role: 'assistant', text: '打开设置。' }, { role: 'user', image: disposablePhoto }];
  const reply = await handleApi(req('/api/chat', { messages }, auth), env, { fetcher });
  assert.equal((await reply.json()).text, '请点右上角的设置。');
  assert.equal(observed.url, 'https://aihubmix.com/v1/responses');
  assert.equal(observed.headers.Authorization, auth.Authorization);
  assert.equal(observed.redirect, 'error');
  assert.deepEqual(observed.body.text.format, { type: 'json_object' });
  assert.equal(observed.body.input[0].role, 'developer');
  assert.deepEqual(observed.body.input[2], { role: 'assistant', content: '打开设置。' });
  assert.deepEqual(observed.body.input[3].content[0], { type: 'input_image', image_url: disposablePhoto, detail: 'auto' });
  assert.equal(observed.body.input[3].content[1].type, 'input_text');
  assert.ok(observed.body.input[3].content[1].text.length);
});

test('rejects remote media, system role injection, oversized body, keyless public setup and upstream key echo', async () => {
  const denied = async (...args) => { throw new Error('unexpected network use'); };
  for (const invalidMessage of [{ role: 'user', image: 'https://example.cn/report.jpg' }, { role: 'system', text: 'test' }]) {
    assert.equal((await handleApi(req('/api/chat', { messages: [invalidMessage] }, auth), {}, { fetcher: denied })).status, 400);
  }
  const oversized = req('/api/chat', question, { ...auth, 'content-length': String(10 * 1024 * 1024) });
  assert.equal((await handleApi(oversized, {}, { fetcher: denied })).status, 413);
  assert.equal((await handleApi(req('/api/chat', question), { AIHUBMIX_API_KEY: env.AIHUBMIX_API_KEY }, { fetcher: denied })).status, 401);
  const response = await handleApi(req('/api/chat', question, auth), {}, {
    fetcher: async () => new Response(auth.Authorization, { status: 401 })
  });
  assert.equal(response.status, 401);
  assert.ok(!(await response.text()).includes(auth.Authorization));
});

test('family authorization is temporary or device-bound by cookie; rotation and sign-out clear access', async () => {
  const fetcher = async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer ' + env.AIHUBMIX_API_KEY);
    return Response.json(providerReply());
  };
  const config = async (headers = {}, options = env) => (await handleApi(req('/api/config', null, headers), options)).json();
  assert.equal((await config()).familyCodeRequired, true);
  assert.equal((await config()).serverKeyAvailable, false);
  assert.equal((await config({ 'X-Family-Code': env.FAMILY_ACCESS_CODE })).serverKeyAvailable, true);
  assert.equal((await handleApi(req('/api/session', { accessCode: 'wrong' }), env)).status, 401);
  assert.equal((await handleApi(req('/api/session', { accessCode: env.FAMILY_ACCESS_CODE }, { Origin: 'https://other.example' }), env)).status, 403);
  const loggedIn = await handleApi(req('/api/session', { accessCode: env.FAMILY_ACCESS_CODE }), env);
  assert.equal(loggedIn.status, 200);
  const header = loggedIn.headers.get('set-cookie');
  assert.match(header, /HttpOnly; SameSite=Strict; Path=\/api; Secure/);
  assert.ok(!header.includes(env.FAMILY_ACCESS_CODE));
  const cookie = header.split(';')[0];
  assert.equal((await config({ cookie })).serverKeyAvailable, true);
  assert.equal((await config({ cookie }, { ...env, FAMILY_ACCESS_CODE: 'another-family-passphrase' })).serverKeyAvailable, false);
  assert.equal((await config({ cookie: cookie.slice(0, -2) + '!!' })).serverKeyAvailable, false);
  assert.equal((await handleApi(req('/api/chat', question, { cookie }), env, { fetcher })).status, 200);
  assert.equal((await handleApi(req('/api/chat', question, { 'x-family-code': env.FAMILY_ACCESS_CODE }), env, { fetcher })).status, 200);
  assert.equal((await handleApi(req('/api/chat', question, { cookie, Origin: 'https://other.example' }), env, { fetcher })).status, 403);
  const loggedOut = await handleApi(req('/api/session', null, { cookie }, 'DELETE'), env);
  assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0/);
});

test('only structured readings matching visible digits in a photo answer are offered for confirmation', async () => {
  const messages = [{ role: 'user', image: disposablePhoto }];
  const run = async record => {
    const response = await handleApi(req('/api/chat', { messages }, auth), {}, {
      fetcher: async () => Response.json(providerReply(JSON.stringify(record)))
    });
    return response.json();
  };
  const reading = { kind: 'blood_pressure', systolic: 138, diastolic: 81, unit: 'mmHg' };
  const clear = { text: '屏幕显示高压138、低压81毫米汞柱。', reading };
  assert.deepEqual(await run(clear), clear);
  const mismatch = await run({ ...clear, reading: { ...reading, systolic: 148 } });
  assert.ok(!mismatch.reading);
  const glucose = { kind: 'blood_glucose', value: 6.8, unit: 'mmol/L' };
  assert.deepEqual((await run({ text: '屏幕显示6.8 mmol/L。', reading: glucose })).reading, glucose);
  const reference = await run({ text: '说明书写着示例数值120/80毫米汞柱。', reading: null });
  assert.ok(!reference.reading);
  assert.equal((await run({ text: '这张照片有反光。', reading: null, readingUnclear: true })).readingUnclear, true);
});

test('an incomplete photo response is retriable and a model refusal stays visible without a health reading', async () => {
  const run = result => handleApi(req('/api/chat', {messages: [{role: 'user', image: disposablePhoto}]}, auth), {}, {
    fetcher: async () => Response.json(result)
  });
  const partial = await run({...providerReply('{"text":"屏幕上显示'), status: 'incomplete'});
  assert.equal(partial.status, 502);
  assert.equal((await partial.json()).code, 'incomplete_reply');
  const refusal = await run({status: 'completed', output: [{type: 'message', role: 'assistant',
    content: [{type: 'refusal', refusal: '图片模糊，读不清数字。'}]}]});
  assert.deepEqual(await refusal.json(), {text: '图片模糊，读不清数字。'});
});

test('each question uses the same model, with server-selected effort and one upstream call', async () => {
  const config = await (await handleApi(req('/api/config'), env)).json();
  assert.equal(config.provider, 'aihubmix');
  assert.equal(config.model, 'gpt-6.1-terra');
  for (const [question, expected] of [
    [{text: '怎么打开手机相册？'}, 'low'], [{text: '周末我想带家人出去走走'}, 'medium'],
    [{text: '帮我比较这两个解决办法'}, 'high'], [{image: disposablePhoto}, 'high']
  ]) {
    const messages = [{role: 'user', ...question}];
    let calls = 0;
    const reply = await handleApi(req('/api/chat', {messages, model:'other', reasoning_effort:'max'}, auth), {}, {
      fetcher: async (url, init) => {
        calls++;
        assert.equal(url, 'https://aihubmix.com/v1/responses');
        const input = JSON.parse(init.body);
        assert.equal(input.model, config.model);
        assert.equal(input.reasoning.effort, expected);
        assert.equal(input.store, false);
        return Response.json(question.image ? providerReply('{"text":"照片","reading":null}') : providerReply());
      }
    });
    assert.equal(reply.status, 200);
    assert.equal(calls, 1);
  }
});

test('old credentials cannot be forwarded to AIHubMix and upstream denials propagate', async () => {
  let unexpectedCalls = 0;
  const options = {localAccess: true, fetcher: () => { unexpectedCalls++; throw new Error('unexpected request'); }};
  for (const path of ['/api/chat', '/api/transcribe', '/api/speak']) {
    for (const value of [null, 'openai', 'another-service']) {
      const request = req(path, question, auth);
      if (value) request.headers.set('X-Model-Provider', value);
      else request.headers.delete('X-Model-Provider');
      assert.equal((await handleApi(request, env, options)).status, 409);
    }
  }
  const legacyEnv = {OPENAI_API_KEY: 'old-provider-key'};
  const config = await (await handleApi(req('/api/config'), legacyEnv, options)).json();
  assert.equal(config.serverKeyAvailable, false);
  assert.equal((await handleApi(req('/api/chat', question), legacyEnv, options)).status, 401);
  assert.equal(unexpectedCalls, 0);
  let calls = 0;
  const denied = await handleApi(req('/api/chat', question, auth), {}, {fetcher: async url => {
    calls++;
    assert.equal(new URL(url).hostname, 'aihubmix.com');
    return new Response('', {status:403});
  }});
  assert.equal(denied.status, 403);
  assert.equal(calls, 1);
});

test('AIHubMix voice routes use the selected account for ASR and speech', async () => {
  const headers = { ...auth, 'X-Model-Provider':'aihubmix' };
  const asr = await handleApi(req('/api/transcribe', { audio: 'data:audio/wav;base64,AAAA' }, headers), env, {
    fetcher: async (url, init) => {
      assert.equal(url, 'https://aihubmix.com/v1/audio/transcriptions');
      assert.equal(init.headers.Authorization, auth.Authorization);
      assert.equal(init.body.get('model'), 'whisper-large-v3');
      assert.equal(init.body.get('response_format'), 'json');
      assert.equal(init.body.get('file').size, 3);
      return Response.json({ text: '您好' });
    }
  });
  assert.equal((await asr.json()).text, '您好');
  const speech = await handleApi(req('/api/speak', { text: '您好' }, headers), env, {
    fetcher: async (url, init) => {
      assert.equal(url, 'https://aihubmix.com/v1/audio/speech');
      assert.equal(init.headers.Authorization, auth.Authorization);
      assert.deepEqual(JSON.parse(init.body), { model: 'gpt-4o-mini-tts', input: '您好', voice: 'coral', response_format: 'wav' });
      return new Response(new Uint8Array(16));
    }
  });
  assert.equal(speech.headers.get('content-type'), 'audio/wav');
});
