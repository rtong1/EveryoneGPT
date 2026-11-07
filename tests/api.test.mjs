import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../server/api.mjs';

const origin = 'https://chat.example.cn';
const env = { DASHSCOPE_API_KEY: 'example-service-credential', FAMILY_ACCESS_CODE: 'sample-household-phrase' };
const auth = { Authorization: 'Bearer example-user-credential' };
const providerReply = { choices: [{ message: { content: '请点右上角的设置。' } }] };
function req(path, body, headers = {}, method = body ? 'POST' : 'GET') {
  const opts = { method, headers: { Origin: origin, ...headers } };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return new Request(origin + path, opts);
}
const disposablePhoto = 'data:image/jpeg;base64,/9j/2Q==';
const question = { messages: [{ role: 'user', text: '在哪里设置？' }] };

test('a photo alone, previous turns, and BYOK reach the documented Beijing chat endpoint', async () => {
  let observed;
  const fetcher = async (url, init) => {
    observed = { url, ...init, body: JSON.parse(init.body) };
    return Response.json({ choices: [{ message: { content: JSON.stringify({ text: '请点右上角的设置。', reading: null }) } }] });
  };
  const messages = [...question.messages, { role: 'assistant', text: '打开设置。' }, { role: 'user', image: disposablePhoto }];
  const reply = await handleApi(req('/api/chat', { messages }, auth), env, { fetcher });
  assert.equal((await reply.json()).text, providerReply.choices[0].message.content);
  assert.equal(observed.url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
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
  assert.equal((await handleApi(req('/api/chat', question), { DASHSCOPE_API_KEY: env.DASHSCOPE_API_KEY }, { fetcher: denied })).status, 401);
  const response = await handleApi(req('/api/chat', question, auth), {}, {
    fetcher: async () => new Response(auth.Authorization, { status: 401 })
  });
  assert.equal(response.status, 401);
  assert.ok(!(await response.text()).includes(auth.Authorization));
});

test('family authorization is temporary or device-bound by cookie; rotation and sign-out clear access', async () => {
  const fetcher = async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer ' + env.DASHSCOPE_API_KEY);
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

test('speech recognition forwards a data URI; synthesis downloads its WAV over HTTPS without the user key', async () => {
  const wav = new Uint8Array(46);
  const view = new DataView(wav.buffer);
  for (const [offset, value] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
    wav.set(new TextEncoder().encode(value), offset);
  }
  for (const [offset, value] of [[4, 38], [16, 16], [24, 16000], [28, 32000], [40, 2]]) view.setUint32(offset, value, true);
  for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) view.setUint16(offset, value, true);
  const audio = 'data:audio/wav;base64,' + Buffer.from(wav).toString('base64');
  const asr = await handleApi(req('/api/transcribe', { audio }, auth), {}, {
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'qwen3-asr-flash');
      assert.equal(body.messages[0].content[0].input_audio.data, audio);
      return Response.json({ choices: [{ message: { content: '我想问个问题' } }] });
    }
  });
  assert.equal((await asr.json()).text, '我想问个问题');
  const fileURL = 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/audio.wav?Signature=example';
  const urls = [];
  const fetcher = async (url, init) => {
    urls.push(url);
    if (urls.length === 1) {
      assert.equal(JSON.parse(init.body).input.text, '我来读给您听。');
      return Response.json({ output: { audio: { url: fileURL } } });
    }
    assert.equal(init.headers, undefined);
    return new Response(wav);
  };
  const file = await handleApi(req('/api/speak', { text: '我来读给您听。' }, auth), {}, { fetcher });
  assert.equal(file.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), wav);
  assert.equal(urls[1], fileURL.replace('http:', 'https:'));
  const blocked = await handleApi(req('/api/speak', { text: '再见。' }, auth), {}, {
    fetcher: async () => Response.json({ output: { audio: { url: 'https://example.com/anything' } } })
  });
  assert.equal(blocked.status, 502);
});
