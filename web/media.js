import {asDataUrl} from './voice-capture.js';

export async function preparePhoto(file) {
  if (!file || (file.type && !file.type.startsWith('image/'))) throw new Error('请选择一张图片。');
  if (file.size > 25 * 1024 * 1024) throw new Error('这张照片太大了，请选择一张小一点的，或截屏后再发。');
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('这张图片打不开。请用相册截屏，再发一次。'));
      img.src = url;
    });
    let scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    for (let attempt = 0; attempt < 4; attempt++) {
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .84));
      if (blob && blob.size <= 1400 * 1024) return await asDataUrl(blob);
      scale *= .75;
    }
    throw new Error('照片处理失败，请截屏后再试。');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function speechParts(text) {
  const runs = text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*|[。！？!?；;\n]+/gu) || [text];
  const parts = [];
  let current = [];
  for (const run of runs) {
    const chars = Array.from(run);
    if (current.length && current.length + chars.length > 480) {
      parts.push(current.join('')); current = [];
    }
    for (const char of chars) {
      current.push(char);
      if (current.length === 480) { parts.push(current.join('')); current = []; }
    }
  }
  if (current.length) parts.push(current.join(''));
  return parts.map(part => part.trim()).filter(Boolean);
}

export function createReader({fetchAudio, onState, onError}) {
  let activeId = null, generation = 0, audioPlayer, utterance, objectUrl, cancelPart, requestController;
  const release = () => {
    if (audioPlayer) { audioPlayer.pause(); audioPlayer.remove(); audioPlayer = null; }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    utterance = null;
  };
  function stop() {
    generation++;
    if (utterance) window.speechSynthesis?.cancel();
    requestController?.abort();
    cancelPart?.();
    release();
    if (activeId !== null) { activeId = null; onState(); }
  }
  async function read(id, text, onControls) {
    stop();
    activeId = id;
    onState();
    const turn = generation;
    const voice = window.speechSynthesis?.getVoices().find(v => v.localService && /^(zh|cmn)([-_]|$)/i.test(v.lang));
    try {
      for (const part of speechParts(text)) {
        if (turn !== generation) break;
        if (voice) {
          await new Promise((resolve,reject) => {
            cancelPart = resolve;
            utterance = new SpeechSynthesisUtterance(part);
            utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = .96;
            utterance.onend = resolve;
            utterance.onerror = event => {
              if (event.error === 'canceled' || event.error === 'interrupted') resolve();
              else reject(new Error('手机朗读出错了，请再点一次朗读。'));
            };
            window.speechSynthesis.speak(utterance);
          });
        } else {
          requestController = new AbortController();
          const blob = await fetchAudio(part, requestController.signal);
          if (turn !== generation) break;
          release();
          objectUrl = URL.createObjectURL(blob);
          audioPlayer = new Audio(objectUrl);
          await new Promise((resolve,reject) => {
            cancelPart = resolve;
            audioPlayer.onended = resolve;
            audioPlayer.onerror = () => reject(new Error('声音没能播放，请再点一次朗读。'));
            audioPlayer.play().catch(error => {
              if (turn !== generation) return resolve();
              if (error.name !== 'NotAllowedError') return reject(new Error('声音没能播放，请再点一次朗读。'));
              audioPlayer.controls = true;
              audioPlayer.setAttribute('aria-label', '点播放，收听这条回答');
              onControls(audioPlayer);
            });
          });
        }
      }
    } catch (error) {
      if (generation === turn) onError(error);
    } finally {
      if (generation === turn) {
        release(); activeId = null; cancelPart = null; requestController = null; onState();
      }
    }
  }
  // Some devices populate their local voices asynchronously after first access.
  window.speechSynthesis?.getVoices();
  return {get active() { return activeId; }, stop, read};
}
