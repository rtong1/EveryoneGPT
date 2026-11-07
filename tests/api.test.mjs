import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../server/api.mjs';

const origin = 'https://chat.example.cn';
const env = { OPENAI_API_KEY: 'example-service-credential', FAMILY_ACCESS_CODE: 'sample-household-phrase' };
const auth = { Authorization: 'Bearer example-user-credential' };
const providerReply = { choices: [{ message: { content: '请点右上角的设置。' } }] };
function req(path, body, headers = {}, method = body ? 'POST' : 'GET') {
  const opts = { method, headers: { Origin: origin, 'X-Model-Provider':'openai', ...headers } };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return new Request(origin + path, opts);
}
const disposablePhoto = 'data:image/jpeg;base64,/9j/2Q==';
const question = { messages: [{ role: 'user', text: '在哪里设置？' }] };

test('a photo alone, previous turns, and BYOK reach the official OpenAI chat endpoint', async () => {
  let observed;
  const fetcher = async (url, init) => {
    observed = { url, ...init, body: JSON.parse(init.body) };
    return Response.json({ choices: [{ message: { content: JSON.stringify({ text: '请点右上角的设置。', reading: null }) } }] });
  };
  const messages = [...question.messages, { role: 'assistant', text: '打开设置。' }, { role: 'user', image: disposablePhoto }];
  const reply = await handleApi(req('/api/chat', { messages }, auth), env, { fetcher });
  assert.equal((await reply.json()).text, providerReply.choices[0].message.content);
  assert.equal(observed.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(observed.headers.Authorization, auth.Authorization);
  assert.equal(observed.body.messages[0].role, 'system');
  assert.deepEqual(observed.body.messages[2], { role: 'assistant', content: '打开设置。' });
  assert.equal(observed.body.messages[3].content[0].image_url.url, disposablePhoto);
  assert.ok(observed.body.messages[3].content[1].text.length);
});

test('rejects remote media, system role injection, oversized body, keyless public setup and upstream key echo', async () => {
  const denied = async (...args) => { throw new Error('unexpected network use'); };
  for (const invalidMessage of [{ role: 'user', image: 'https://example.cn/report.jpg' }, { role: 'system', text: 'test' }]) {
    assert.equal((await handleApi(req('/api/chat', { messages: [invalidMessage] }, auth), {}, { fetcher: denied })).status, 400);
  }
  const oversized = req('/api/chat', question, { ...auth, 'content-length': String(10 * 1024 * 1024) });
  assert.equal((await handleApi(oversized, {}, { fetcher: denied })).status, 413);
  assert.equal((await handleApi(req('/api/chat', question), { OPENAI_API_KEY: env.OPENAI_API_KEY }, { fetcher: denied })).status, 401);
  const response = await handleApi(req('/api/chat', question, auth), {}, {
    fetcher: async () => new Response(auth.Authorization, { status: 401 })
  });
  assert.equal(response.status, 401);
  assert.ok(!(await response.text()).includes(auth.Authorization));
});

test('family authorization is temporary or device-bound by cookie; rotation and sign-out clear access', async () => {
  const fetcher = async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer ' + env.OPENAI_API_KEY);
    return Response.json(providerReply);
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
      fetcher: async () => Response.json({ choices: [{ message: { content: JSON.stringify(record) } }] })
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

test('each question uses the same model, with server-selected effort and one upstream call', async () => {
  const config = await (await handleApi(req('/api/config'), env)).json();
  assert.equal(config.provider, 'openai');
  assert.equal(config.model, 'gpt-6-astra');
  for (const [question, expected] of [
    [{text: '怎么打开手机相册？'}, 'low'], [{text: '周末我想带家人出去走走'}, 'medium'],
    [{text: '帮我比较这两个解决办法'}, 'high'], [{image: disposablePhoto}, 'high']
  ]) {
    const messages = [{role: 'user', ...question}];
    let calls = 0;
    const reply = await handleApi(req('/api/chat', {messages, model:'other', reasoning_effort:'max'}, auth), {}, {
      fetcher: async (url, init) => {
        calls++;
        assert.equal(url, 'https://api.openai.com/v1/chat/completions');
        const input = JSON.parse(init.body);
        assert.equal(input.model, config.model);
        assert.equal(input.reasoning_effort, expected);
        assert.equal(input.store, false);
        return Response.json(question.image ? {choices:[{message:{content:'{"text":"照片","reading":null}'}}]} : providerReply);
      }
    });
    assert.equal(reply.status, 200);
    assert.equal(calls, 1);
  }
});

test('old clients must explicitly bind their key to OpenAI; upstream denials never trigger fallback', async () => {
  for (const value of [null, 'another-service']) {
    const request = req('/api/chat', question, auth);
    if (value) request.headers.set('X-Model-Provider', value);
    else request.headers.delete('X-Model-Provider');
    const reply = await handleApi(request, {}, {fetcher: () => assert.fail('unexpected request')});
    assert.equal(reply.status, 409);
  }
  let calls = 0;
  const denied = await handleApi(req('/api/chat', question, auth), {}, {fetcher: async url => {
    calls++;
    assert.equal(new URL(url).hostname, 'api.openai.com');
    return new Response('', {status:403});
  }});
  assert.equal(denied.status, 403);
  assert.equal(calls, 1);
});

test('OpenAI voice routes use the selected account for ASR and speech', async () => {
  const headers = { ...auth, 'X-Model-Provider':'openai' };
  const asr = await handleApi(req('/api/transcribe', { audio: 'data:audio/wav;base64,AAAA' }, headers), env, {
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
      assert.equal(init.body.get('model'), 'gpt-transcribe');
      assert.equal(init.body.get('file').size, 3);
      return Response.json({ text: '您好' });
    }
  });
  assert.equal((await asr.json()).text, '您好');
  const speech = await handleApi(req('/api/speak', { text: '您好' }, headers), env, {
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/audio/speech');
      assert.equal(JSON.parse(init.body).response_format, 'wav');
      return new Response(new Uint8Array(16));
    }
  });
  assert.equal(speech.headers.get('content-type'), 'audio/wav');
});
