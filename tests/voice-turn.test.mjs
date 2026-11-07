import assert from 'node:assert/strict';
import test from 'node:test';
import { openMicrophone } from '../web/voice-capture.js';
import { handleApi } from '../server/api.mjs';

// Exercise the same path used by browsers whose embedded engine supplies
// ScriptProcessor. Replace only the hardware, FileReader and model network call.
test('a captured voice turn reaches the recognizer as mono 16 kHz PCM and releases the mic', async t => {
  let processor, trackStopped = false, contextClosed = false;
  class AudioNode {
    connect(next) { return next; }
    disconnect() {}
  }
  class StubAudioContext {
    sampleRate = 48000;
    async resume() {}
    createMediaStreamSource() { return new AudioNode(); }
    createScriptProcessor() { processor = new AudioNode(); return processor; }
    createGain() { return Object.assign(new AudioNode(), { gain: { value: 1 } }); }
    async close() { contextClosed = true; }
  }
  class BlobReader {
    async readAsDataURL(blob) {
      this.result = 'data:' + blob.type + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64');
      this.onload();
    }
  }
  const mediaDevices = { async getUserMedia() { return { getTracks: () => [{ stop() { trackStopped = true; } }] }; } };
  for (const [name, value] of Object.entries({ window: { AudioContext: StubAudioContext }, navigator: { mediaDevices }, FileReader: BlobReader })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  const mic = await openMicrophone();
  // A 48 kHz half-second input should retain exactly 8,000 samples.
  const samples = new Float32Array(24000).fill(0.25);
  processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples } });
  const audio = await mic.finish();
  assert.ok(trackStopped && contextClosed);
  const request = new Request('https://family.example/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Model-Provider': 'openai', Authorization: 'Bearer test-only-key' },
    body: JSON.stringify({ audio })
  });
  const response = await handleApi(request, {}, {
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
      const bytes = Buffer.from(await init.body.get('file').arrayBuffer());
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.readUInt16LE(22), 1);
      assert.equal(bytes.readUInt32LE(24), 16000);
      assert.equal(bytes.readUInt16LE(34), 16);
      assert.equal(bytes.readUInt32LE(40), 16000);
      assert.equal(bytes.length, 16044);
      assert.ok(bytes.readInt16LE(44) > 0);
      return Response.json({ text: '帮我看看照片。' });
    }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, '帮我看看照片。');
});
