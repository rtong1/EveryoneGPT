// Record locally. A fixed-size 16 kHz WAV works across ArkWeb and browsers, regardless
// of which recording container the platform's MediaRecorder happens to support.
export async function openMicrophone() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!navigator.mediaDevices?.getUserMedia || !Audio) {
    throw new Error('这个页面开不了麦克风。请用系统浏览器打开安全网址，也可以用键盘上的语音键。');
  }
  const context = new Audio();
  let stream, processor, source, muted, recorder;
  let active = true;
  const chunks = [];
  let frames = 0;
  let mediaParts = [];
  const close = () => {
    active = false;
    stream?.getTracks().forEach(track => track.stop());
    processor?.disconnect();
    source?.disconnect();
    muted?.disconnect();
    if (context.state !== 'closed') context.close().catch(() => {});
  };
  try {
    await context.resume();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true}, video: false
    });
    const add = block => {
      if (!active || frames >= context.sampleRate * 60 || !block?.length) return;
      const part = block.slice(0, Math.min(block.length, context.sampleRate * 60 - frames));
      frames += part.length;
      chunks.push(part);
    };
    source = context.createMediaStreamSource(stream);
    if (context.audioWorklet) {
      try {
        await context.audioWorklet.addModule(new URL('./voice-worklet.js', import.meta.url));
        processor = new AudioWorkletNode(context, 'voice-input');
        processor.port.onmessage = event => add(event.data);
      } catch { /* Older embedded browsers use the equivalent audio callback below. */ }
    }
    if (!processor && context.createScriptProcessor) {
      processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = event => add(event.inputBuffer.getChannelData(0));
    }
    if (processor) {
      muted = context.createGain();
      muted.gain.value = 0;
      source.connect(processor).connect(muted).connect(context.destination);
    } else if (window.MediaRecorder) {
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = event => { if (event.data.size) mediaParts.push(event.data); };
      recorder.start();
    } else {
      throw new Error('这个浏览器录不了音，请用键盘上的语音输入。');
    }
    return {
      cancel() {
        if (recorder?.state === 'recording') recorder.stop();
        close();
      },
      async finish() {
        try {
          if (recorder) {
            await new Promise((resolve, reject) => {
              recorder.onstop = resolve;
              recorder.onerror = () => reject(new Error('录音中断了，请再说一次。'));
              recorder.stop();
            });
            const blob = new Blob(mediaParts, {type: recorder.mimeType});
            mediaParts = [];
            const decoded = await context.decodeAudioData(await blob.arrayBuffer());
            return await encodeWav(decoded.getChannelData(0), decoded.sampleRate);
          }
          const pcm = new Float32Array(frames);
          let offset = 0;
          for (const part of chunks) { pcm.set(part, offset); offset += part.length; }
          return await encodeWav(pcm, context.sampleRate);
        } finally {
          close();
        }
      }
    };
  } catch (error) {
    close();
    if (['NotAllowedError','SecurityError'].includes(error.name)) {
      throw new Error('麦克风权限没有打开。请在浏览器或手机设置中允许使用麦克风，再点说话。');
    }
    if (['NotFoundError','NotReadableError'].includes(error.name)) {
      throw new Error('麦克风暂时用不了。请检查设备，或用键盘上的语音输入。');
    }
    throw error;
  }
}

async function encodeWav(samples, rate) {
  const target = 16000;
  const length = Math.min(60 * target, Math.floor(samples.length * target / rate));
  if (length < target * 0.2) throw new Error('刚刚的录音太短了，请再说一次。');
  const data = new ArrayBuffer(44 + length * 2);
  const view = new DataView(data);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset+i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, target, true); view.setUint32(28, target*2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, length*2, true);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * rate / target);
    const end = Math.min(samples.length, Math.max(start+1, Math.floor((i+1)*rate/target)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    const value = Math.min(1, Math.max(-1, sum / (end-start)));
    view.setInt16(44 + i*2, value * (value < 0 ? 32768 : 32767), true);
  }
  return asDataUrl(new Blob([data], {type: 'audio/wav'}));
}

export function asDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败，请重新选择。'));
    reader.readAsDataURL(blob);
  });
}
