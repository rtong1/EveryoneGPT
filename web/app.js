import {modelMessages, shouldSuggestNewChat} from './conversation.js';
import {openMicrophone} from './voice-capture.js';
import {createReader, preparePhoto} from './media.js';
import {wireJournal} from './journal-ui.js';

const byId = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
function el(tag, style, text) {
  const node = document.createElement(tag);
  if (style) node.className = style;
  if (text) node.textContent = text;
  return node;
}
function button(text, action) {
  const node = el('button','inline-action',text);
  node.type = 'button'; node.addEventListener('click', action); return node;
}
function getPref(name) {
  try { return localStorage.getItem('zhiban.pref.' + name); } catch { return null; }
}
function setPref(name, value) {
  try { localStorage.setItem('zhiban.pref.' + name, value); } catch { /* Session settings still work. */ }
}

const input = byId('chat-text'), status = byId('chat-status'), photoPicker = byId('photo-input');
const chatLog = byId('chat-messages'), settingsStatus = byId('settings-status');
const messages = [];
let nextId = 0, page = 'home', toastTimer, config = {}, apiKey = '', familyCode = '';
let chatPending = false, chatGeneration = 0, chatController = null, selectedPhoto = null;
let preparingPhoto = false, pendingVoice = null, mic = null, micReady = false, finishingMic = false;
let micTurn = 0, micTimer, dictation = null, uploadingVoice = false, journal, cloudDialog = false;
let autoRead = getPref('auto-read') === 'yes', cloudOkay = false;
let previousPage = 'home', retryDraft = null, nextTopicPrompt = 0;
let choosingTopic = false;
function announce(message) {
  const toast = byId('toast'); clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible','shown');
  toastTimer = setTimeout(() => { toast.textContent = ''; toast.classList.remove('visible','shown'); }, 6500);
}
function askDialog(dialog, yes, no, onCancel = false) {
  return new Promise(resolve => {
    const done = value => {
      yes.removeEventListener('click', accept); no.removeEventListener('click', decline);
      dialog.removeEventListener('cancel', cancelled);
      if (dialog.open && dialog.close) dialog.close(); else dialog.removeAttribute('open');
      resolve(value);
    };
    const accept = () => done(true), decline = () => done(false);
    const cancelled = event => { event.preventDefault(); done(onCancel); };
    yes.addEventListener('click',accept); no.addEventListener('click',decline);
    dialog.addEventListener('cancel',cancelled);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open','');
  });
}
async function confirmNotice(title, body, yes, no) {
  const dialog = byId('privacy-consent-dialog');
  if (dialog.open) return false;
  byId('consent-title').textContent = title; byId('consent-body').textContent = body;
  byId('consent-accept').textContent = yes; byId('consent-decline').textContent = no;
  return await askDialog(dialog, byId('consent-accept'), byId('consent-decline'));
}
async function allowCloud() {
  if (!config.provider) await loadConfig();
  if (!config.provider) { announce('请先检查网络并连接问答服务。'); return false; }
  if (cloudOkay) return true;
  if (cloudDialog) return false;
  cloudDialog = true;
  try {
    cloudOkay = await confirmNotice('使用智能问答', '您发送的问题、照片、录音和需要云端朗读的文字，会经 AIHubMix 转交给模型处理。健康本里的其他记录保存在本机。', '同意并继续','暂时不用');
    if (cloudOkay) setPref('cloud-consent-v1-aihubmix','yes');
    return cloudOkay;
  } finally { cloudDialog = false; }
}
const policyBlocked = code => ['key_required','family_code_required','unauthorized','invalid_key','invalid_api_key'].includes(code);
function statusLine(text, actions = []) {
  status.replaceChildren();
  if (text) status.append(el('span','',text));
  for (const [label,fn] of actions) status.append(button(label,fn));
}
function keyActions(err) {
  return err.status === 401 || policyBlocked(err.code) ? [['去设置', () => go('settings')]] : [];
}

async function api(path, data, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort',abort,{once:true});
  const timer = setTimeout(abort, path === '/api/chat' ? 135000 : 95000);
  try {
    const headers = {'X-Model-Provider':'aihubmix'};
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    if (options.auth !== false) {
      if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
      if (familyCode) headers['X-Family-Code'] = familyCode;
    }
    const response = await fetch(path, {method:options.method || (data === undefined ? 'GET':'POST'),
      body:data === undefined ? undefined : JSON.stringify(data), headers, signal:controller.signal, credentials:'same-origin', cache:'no-store'});
    if (!response.ok) {
      let result;
      try { result = await response.json(); } catch { result = {}; }
      const err = new Error(typeof result.error === 'string' ? result.error : '服务暂时没有接通，请稍后再试。');
      err.code = result.code; err.status = response.status; throw err;
    }
    return options.audio ? await response.blob() : await response.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('连接用时较长，您可以再试一次。');
    if (err instanceof TypeError || err instanceof SyntaxError) throw new Error('暂时连不上问答服务，请检查网络后再试一次。');
    throw err;
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort',abort);
  }
}
function serviceState() {
  if (apiKey) return '正在使用本次填写的服务密钥。关闭或刷新页面会清除它。';
  if (config.serverKeyAvailable || familyCode) return '家庭问答服务已连接。';
  if (config.familyCodeRequired) return '输入家人提供的家庭服务码，就可以开始聊天。';
  return config.provider ? '请填写 AIHubMix 密钥。' : '正在读取服务配置。';
}
function updateSetupNotice() {
  const hint=byId('home-service-setup');
  if (hint) hint.hidden=!!(apiKey || familyCode || config.serverKeyAvailable);
}
function applyConfig(updated) {
  if (updated.provider !== 'aihubmix') throw new Error('请家人更新问答服务后，再刷新页面。');
  config = updated;
  cloudOkay = getPref('cloud-consent-v1-aihubmix') === 'yes';
  const family = byId('family-access');
  if (family) family.hidden = !config.familyAccessEnabled;
  if (byId('forget-family')) byId('forget-family').hidden = !config.familyAccessEnabled || (!config.serverKeyAvailable && !familyCode);
  settingsStatus.textContent = serviceState();updateSetupNotice();
}
async function loadConfig() {
  try { applyConfig(await api('/api/config', undefined, {auth:false})); }
  catch (err) { settingsStatus.textContent = err.message;updateSetupNotice(); }
}
function go(view, {focus = true, saveHistory = true} = {}) {
  if (!['home','chat','health','settings'].includes(view)) return;
  if (view !== page) {
    previousPage = page;
    stopRecording();
    reader.stop();
  }
  page = view;
  if (saveHistory && location.hash !== '#' + view) history.pushState(null,'','#'+view);
  all('[data-view]').forEach(section => { section.hidden = section.dataset.view !== view; });
  all('[data-nav]').forEach(link => {
    if (link.dataset.nav === view) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
  });
  if (view === 'health') journal?.refresh();
  if (view === 'chat') { showDraft(); }
  if (focus) {
    window.scrollTo(0,0);
    const heading = document.querySelector('[data-view="'+view+'"] h1');
    heading.tabIndex = -1; heading.focus({preventScroll:true});
  }
}
function setFont(large) {
  document.documentElement.dataset.font = large?'large':'standard';
  const label = byId('font-toggle-state');
  if (label) label.textContent=large?'大字号':'字号';
  all('[data-action="font"]').forEach(b => b.setAttribute('aria-pressed',String(large)));
}
function updateActions() {
  const blocked = choosingTopic || chatPending || preparingPhoto || uploadingVoice;
  byId('chat-send').disabled = blocked || !!mic || micReady || !!dictation || finishingMic;
  all('[data-action="photo"],[data-action="voice"],[data-prompt]').forEach(b => {b.disabled = blocked || micReady || !!mic || finishingMic;});
  all('[data-action="finish-voice"]').forEach(b => {b.disabled = !mic || finishingMic;});
}
function showDraft() {
  const holder = byId('chat-attachment');
  holder.replaceChildren();
  if (selectedPhoto) {
    const image = el('img'); image.alt='待发送的照片'; image.src=selectedPhoto;
    holder.append(image, button('移除照片', () => { selectedPhoto=null; showDraft(); }));
  }
  if (pendingVoice && !pendingVoice.dictation) holder.append(el('span','','录音已保留。'),button('重试语音', sendVoice),button('清除录音',()=>{pendingVoice=null;showDraft();statusLine('');}));
  holder.hidden = !holder.childNodes.length;
}
function latest() { chatLog.lastElementChild?.scrollIntoView({block:'nearest'}); }
const reader = createReader({
  fetchAudio:(text,signal) => api('/api/speak',{text},{audio:true,signal}),
  onState:() => {
    all('[data-read-id]').forEach(control => {
      const active = Number(control.dataset.readId) === reader.active;
      control.textContent = active ? '停止朗读' : '朗读回答'; control.setAttribute('aria-pressed',String(active));
    });
  },
  onError:err => {statusLine(err.message,keyActions(err));}
});
function speak(msg) {
  if (reader.active === msg.id) return reader.stop();
  void reader.read(msg.id,msg.text, player => {
    msg.element.querySelector('.message-actions').append(player);
    statusLine('点回答下方的播放键，就能听到声音。');
  });
}
function appendMessage(msg) {
  const entry = el('article','message '+msg.role);
  entry.dataset.id=String(msg.id);
  entry.append(el('strong','message-label message-author', msg.role==='assistant'?'知伴':'您'));
  if (msg.image) {
    const img = el('img','message-image');
    img.alt='您发来的照片'; img.src=msg.image; entry.append(img);
  }
  if (msg.text) entry.append(el('div','message-text message-body',msg.text));
  const actions = el('div','message-actions');
  if (msg.role === 'assistant') {
    const control = button('朗读回答',() => speak(msg));
    control.dataset.readId = String(msg.id); actions.append(control);
    if (msg.reviewFor) journal.addRecordAction(msg.reviewFor, actions);
  } else if (!msg.deferReview) journal.addRecordAction(msg,actions);
  entry.append(actions); msg.element=entry; chatLog.append(entry); latest();
}
function archiveChat() {
  const archive = byId('previous-chats');
  const section = el('details', 'previous-chat');
  const label = messages[0]?.text || '照片提问';
  const excerpt = label.length > 20 ? label.slice(0, 20) + '…' : label;
  section.append(el('summary', '', '查看之前的聊天 · ' + excerpt));
  while (chatLog.firstChild) section.append(chatLog.firstChild);
  archive.prepend(section);
  messages.length = 0;
  retryDraft = null;
  nextTopicPrompt = 0;
}
function scrollLate() { if (page==='chat') requestAnimationFrame(latest); }
async function sendMessage({voice=false} = {}) {
  if (choosingTopic || chatPending || preparingPhoto || uploadingVoice || mic || micReady || finishingMic) return;
  const text = input.value.trim(), image = selectedPhoto;
  if (!text && !image) { input.focus(); return; }
  if (text.length > 3500) { statusLine('这个问题比较长，请分成两次发送。'); return; }
  if (!(await allowCloud()) || chatPending || choosingTopic) return;
  if (page!=='chat') go('chat');
  reader.stop();
  const outgoing = retryDraft && retryDraft.text===text && retryDraft.image===image ? retryDraft : {id:++nextId,role:'user',text,image,fromVoice:voice};
  if (outgoing !== retryDraft && shouldSuggestNewChat(messages, outgoing, nextTopicPrompt)) {
    const version = chatGeneration;
    choosingTopic = true;
    updateActions();
    let answer;
    try {
      answer = await askDialog(byId('topic-dialog'), byId('topic-new'), byId('topic-continue'), null);
    } finally {
      choosingTopic = false;
      updateActions();
    }
    if (answer === null || version !== chatGeneration || page !== 'chat' ||
        text !== input.value.trim() || image !== selectedPhoto) return;
    if (answer) archiveChat();
    else nextTopicPrompt = messages.length / 2 + 4;
  }
  const priorUser=messages.filter(m=>m.role==='user').at(-1);
  outgoing.confirmedPhoto=!!priorUser?.image && /(?:这是我|是我自己|我本人).{0,8}(?:血压|血糖|测|量)/.test(text);
  if (outgoing.confirmedPhoto) {outgoing.photoSource=priorUser.image;outgoing.reading=priorUser.reading;}
  const payload = modelMessages(messages, outgoing);
  const version = chatGeneration;
  chatPending = true; updateActions();
  const controller = new AbortController(); chatController = controller;
  statusLine('知伴正在回答…');
  // Keep the editable original locally until the service has accepted the turn.
  input.readOnly = true;
  const provisional = el('article','message user');
  provisional.append(el('strong','message-author','您'));
  if (image) { const pic=el('img','message-image');pic.src=image;pic.alt='您发来的照片';provisional.append(pic); }
  if (text) provisional.append(el('div','message-body',text));
  chatLog.append(provisional); scrollLate();
  try {
    const result = await api('/api/chat',{messages:payload},{signal:controller.signal});
    if (!result.text?.trim()) throw new Error('没有收到回答，请再试一次。');
    if (version !== chatGeneration) return;
    provisional.remove(); input.value=''; selectedPhoto=null; showDraft();
    if (image) {outgoing.reading=result.reading;outgoing.readingUnclear=result.readingUnclear === true;}
    // Keep the answer first and its photo confirmation beside the result, including on small screens.
    outgoing.deferReview=!!(outgoing.reading || outgoing.readingUnclear || outgoing.confirmedPhoto);
    retryDraft=null;
    journal.checkMessage(outgoing);
    messages.push(outgoing); appendMessage(outgoing);
    const reply = {id:++nextId,role:'assistant',text:result.text,reviewFor:outgoing.deferReview ? outgoing : null};
    messages.push(reply); appendMessage(reply);
    statusLine('');
    if (page === 'chat' && (outgoing.fromVoice || autoRead)) speak(reply);
    scrollLate();
  } catch (err) {
    if (version !== chatGeneration) return;
    provisional.remove();
    statusLine(err.message+' 您的问题已保留。',[...keyActions(err),['重试',()=>sendMessage({voice})]]);
    retryDraft=outgoing;
    journal.checkMessage(outgoing);
    if (outgoing.candidate) journal.addRecordAction(outgoing,status,'先记到健康本');
    showDraft();
  } finally {
    if (version === chatGeneration) { chatPending=false;chatController=null;input.readOnly=false;updateActions(); }
  }
}

function dropMicTimer() { clearTimeout(micTimer); }
function stopRecording() {
  micTurn++; dropMicTimer();
  const active = mic; mic=null;
  active?.cancel();
  if (dictation) { dictation.control.textContent='说话填写';dictation.control.disabled=false;dictation.cancel.hidden=true; }
  micReady=false;finishingMic=false;dictation=null;byId('voice-panel').hidden=true;
  updateActions();
}
async function startRecording(sink = null) {
  if (chatPending || preparingPhoto || uploadingVoice || finishingMic) return;
  if (mic || micReady) {
    if (sink?.control === dictation?.control && mic) await finishRecording();
    return;
  }
  if (!sink) go('chat');
  const capturedPage=page;
  if (!(await allowCloud()) || capturedPage!==page) return;
  reader.stop();
  pendingVoice=null; showDraft();
  dictation=sink;
  const turn=++micTurn;
  micReady=true;updateActions();
  if (sink) {sink.control.textContent='正在打开麦克风…';sink.control.disabled=true;sink.cancel.hidden=false;}
  else {
    statusLine('');byId('voice-panel').hidden=false;
    byId('voice-status').textContent='正在打开麦克风…';
  }
  try {
    const instance=await openMicrophone();
    if (turn!==micTurn) {instance.cancel();return;}
    mic=instance;micReady=false;
    if (sink) {sink.control.textContent='说好了，填入文字';sink.control.disabled=false;}
    else { byId('voice-status').textContent='正在听，请说…'; }
    updateActions();micTimer=setTimeout(finishRecording, 59500);
  } catch (err) {
    if (turn!==micTurn) return;
    stopRecording();
    if (sink) announce(err.message); else statusLine(err.message);
  }
}
async function finishRecording() {
  if (!mic || finishingMic) return;
  dropMicTimer();finishingMic=true;
  const instance=mic, sink=dictation, turn=micTurn;
  mic=null;updateActions();
  if (sink) {sink.control.disabled=true;sink.control.textContent='正在处理…';}
  try {
    const audio=await instance.finish();
    if (turn!==micTurn) return;
    pendingVoice={audio,dictation:sink};
    stopRecording();
    await sendVoice();
  } catch (err) {
    if (turn!==micTurn) return;
    stopRecording(); if (sink) announce(err.message); else statusLine(err.message);
  }
}
async function sendVoice() {
  if (!pendingVoice || uploadingVoice) return;
  const pending=pendingVoice, sink=pending.dictation, version=chatGeneration;
  if (sink) {sink.control.disabled=true;sink.control.textContent='正在转成文字…';}
  else statusLine('正在把语音转成文字…');
  uploadingVoice=true;updateActions();
  let recognized='';
  try {
    const result=await api('/api/transcribe',{audio:pending.audio});
    if (!result.text?.trim()) throw new Error('刚刚没有听清，请再说一次。');
    if (version!==chatGeneration || pending!==pendingVoice) return;
    recognized=result.text.trim();pendingVoice=null;
    if (sink && sink.target.isConnected) {sink.target.value += (sink.target.value?' ':'')+recognized;sink.target.focus();}
    else if (!sink) {input.value += (input.value?' ':'')+recognized;}
  } catch(err) {
    if (pending!==pendingVoice) return;
    if (sink) {announce(err.message+' 录音已保留，点重试。');}
    else {statusLine(err.message+' 录音已保留。',keyActions(err));}
  } finally {
    uploadingVoice=false;updateActions();showDraft();
    if (sink?.control.isConnected) {sink.control.disabled=false;sink.control.textContent=recognized?'说话填写':'重试转成文字';}
  }
  if (recognized && !sink) {
    if (page==='chat') {statusLine('');await sendMessage({voice:true});}
    else announce('语音已转成文字，回到聊天可继续发送。');
  }
}
function addDictation(form,target) {
  const cancel=button('取消录音',stopRecording);cancel.hidden=true;
  const control=button('说话填写', () => {
    if (pendingVoice?.dictation?.control === control) {void sendVoice();return;}
    void startRecording({target,control,cancel});
  });
  form.append(control,cancel);
}

function resetChat() {
  chatGeneration++;chatController?.abort();chatController=null;chatPending=false;
  stopRecording();reader.stop();messages.length=0;chatLog.replaceChildren();
  byId('previous-chats').replaceChildren();nextTopicPrompt=0;
  selectedPhoto=null;pendingVoice=null;retryDraft=null;input.value=''; input.readOnly=false;
  showDraft();statusLine('');updateActions();
}
async function newChat() {
  if (messages.length || byId('previous-chats').childElementCount || input.value || pendingVoice || selectedPhoto || chatPending) {
    const ok=await askDialog(byId('new-chat-dialog'),byId('new-chat-confirm'),byId('new-chat-cancel'));
    if (!ok) return;
  }
  resetChat();go('chat');input.focus();
}
journal=wireJournal({byId,el,button,go,announce,getPref,setPref,addDictation,
  confirmSave:body => confirmNotice('保存自己的健康记录',body,'同意保存','暂不保存')});
for (const nav of all('[data-nav]')) nav.addEventListener('click',()=>go(nav.dataset.nav));
for (const b of all('[data-prompt]')) b.addEventListener('click',() => {
  go('chat');input.value=b.dataset.prompt;void sendMessage();
});
for (const b of all('[data-action]')) {
  b.addEventListener('click',() => {
    switch (b.dataset.action) {
      case 'voice': void startRecording();break;
      case 'finish-voice': void finishRecording();break;
      case 'cancel-voice': stopRecording();statusLine('录音已取消。');break;
      case 'photo': photoPicker.click();break;
      case 'type': go('chat');input.focus();break;
      case 'new-chat': void newChat();break;
      case 'font': {
        const large=document.documentElement.dataset.font!=='large';
        setFont(large);setPref('font',large?'large':'standard');break;
      }
      case 'forget-key':
        apiKey='';byId('api-key').value='';settingsStatus.textContent=serviceState();updateSetupNotice();announce('本次密钥已清除。');break;
    }
  });
}
photoPicker.addEventListener('change',async () => {
  const file=photoPicker.files?.[0];
  photoPicker.value='';
  if (!file || preparingPhoto || chatPending) return;
  go('chat');reader.stop();preparingPhoto=true;updateActions();
  const version=chatGeneration;
  let ready=false;
  try {statusLine('正在准备照片…');const image=await preparePhoto(file);if (version!==chatGeneration) return;selectedPhoto=image;showDraft();statusLine('');ready=true;}
  catch(err) {if (version===chatGeneration) statusLine(err.message);}
  finally {preparingPhoto=false;updateActions();}
  if (ready && page==='chat') await sendMessage();
});
byId('chat-form').addEventListener('submit',event=>{event.preventDefault();void sendMessage();});
input.maxLength=3500;
input.addEventListener('keydown',event => {
  if (event.key==='Enter' && !event.shiftKey && !event.isComposing && event.keyCode!==229) {
    event.preventDefault();void sendMessage();
  }
});
byId('auto-read').checked=autoRead;
byId('auto-read').addEventListener('change',event=>{
  autoRead=event.target.checked;setPref('auto-read',autoRead?'yes':'no');
  if (!autoRead) reader.stop();
});
byId('settings-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const save=byId('save-settings');if(save.disabled)return;
  save.disabled=true;
  try {
    const key=byId('api-key').value.trim(), code=byId('family-code')?.value.trim();
    if (key && (!/^[\x21-\x7e]+$/.test(key) || key.length>512)) throw new Error('密钥里有空格或其他字符，请重新复制完整的 API Key。');
    if (code) {
      if (byId('remember-family')?.checked) {
        const updated=await api('/api/session',{accessCode:code},{auth:false});
        familyCode='';applyConfig(updated);
      } else {
        // Validate temporary family access without storing the passcode or issuing a cookie.
        const res=await fetch('/api/config',{headers:{'X-Family-Code':code},cache:'no-store',credentials:'same-origin'});
        const updated=await res.json();
        if (!res.ok || !updated.serverKeyAvailable) throw new Error('没有接通家庭服务。请核对家人给您的服务码。');
        familyCode=code;applyConfig(updated);
      }
      byId('family-code').value='';
    }
    if (key) {apiKey=key;byId('api-key').value='';}
    settingsStatus.textContent=serviceState();updateSetupNotice();announce('设置已保存。');
    if ((key || code) && previousPage==='chat') {
      go('chat');
      const retriable=pendingVoice ? sendVoice : () => sendMessage();
      if (pendingVoice || selectedPhoto || input.value.trim()) statusLine('已保存服务设置，可以继续刚才的问题。',[['继续',retriable]]);
    }
  } catch(err){settingsStatus.textContent=err.message;}
  finally {save.disabled=false;}
});
byId('forget-family')?.addEventListener('click',async ()=>{
  try {
    const updated=await api('/api/session',undefined,{method:'DELETE',auth:false});
    familyCode='';byId('family-code').value='';applyConfig(updated);announce('这台设备已退出家庭服务。');
  } catch(err){settingsStatus.textContent=err.message;}
});
window.addEventListener('popstate',()=>go(location.hash.slice(1)||'home',{saveHistory:false}));
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){if(mic||micReady)stopRecording();reader.stop();}
});
window.addEventListener('pagehide',()=>{stopRecording();reader.stop();});
byId('manual-health-note').maxLength=500;
byId('today-date').textContent=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(new Date());
setFont(getPref('font')==='large');
go(location.hash.slice(1)||'home',{focus:false,saveHistory:false});
void loadConfig();
