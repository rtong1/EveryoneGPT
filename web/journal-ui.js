import {createHealthJournal, detectHealthCandidate, imageHealthCandidate, makeReminderCalendar} from './health.js';

export function wireJournal({byId, el, button, go, announce, getPref, setPref, confirmSave, addDictation}) {
  const journal = createHealthJournal();
  const consent = byId('health-consent');
  const days = byId('health-days');
  const manual = byId('manual-health-note');
  let automatic = getPref('journal-auto') === 'yes';
  consent.checked = automatic;
  const preferredDays = getPref('interval-days') || '3';
  if ([...days.options].some(option => option.value === preferredDays)) days.value = preferredDays;
  const interval = () => Number(days.value);
  const checkedConfirm = async message => await confirmSave(message);
  const date = value => new Date(value).toLocaleDateString('zh-CN', {month:'long',day:'numeric'});
  function save(note, title, intervalDays = interval()) {
    const record = journal.save({note, title, consent:true, intervalDays});
    refresh(); syncNative(); return record;
  }
  consent.addEventListener('change', async () => {
    if (consent.checked && !(await checkedConfirm('开启后，您在聊天中明确说到自己的身体不适或测量结果时，会自动记在这台设备上。其他使用这台设备的人也可能看到。'))) {
      consent.checked = false; return;
    }
    automatic = consent.checked;
    setPref('journal-auto', automatic ? 'yes':'no');
    announce(automatic ? '已开启自动记录。' : '已关闭自动记录。已有记录可以在健康本里删除。');
  });
  days.addEventListener('change', () => setPref('interval-days', days.value));

  function checkMessage(message) {
    if (message.role !== 'user' || !message.text) return;
    const candidate = detectHealthCandidate(message.text);
    if (!candidate) return;
    message.candidate = candidate;
    if (automatic && !message.fromVoice && !message.image && !message.recordId) {
      try { message.recordId = save(candidate.note, candidate.title).id; }
      catch (err) { announce(err.message); }
    }
  }

  function photoRecord(message, container) {
    const candidate = imageHealthCandidate(message.reading);
    if (!candidate && !message.readingUnclear && !message.confirmedPhoto) return false;
    const form = el('form','candidate-editor');
    const label = el('label','record-title',candidate ? '请对照照片，核对读数' : '请看一下照片上的读数');
    const note = el('textarea');
    note.rows=2; note.maxLength=500; note.required=true;
    note.value=candidate?.note || '';
    note.placeholder='可以填入读数，也可以点“说话填写”';
    label.append(note); form.append(label);
    if (message.photoSource || message.image) {
      const thumb=el('img','message-image'); thumb.src=message.photoSource || message.image; thumb.alt='请核对这张照片';
      form.prepend(thumb);
    }
    form.append(el('p','record-meta','这张照片是您自己测的吗？确认后保存在本机健康本。'));
    const saveButton=el('button','inline-action','是我测的，保存这条'); saveButton.type='submit';
    const dismiss=button('暂不记录',()=>{form.remove();});
    form.append(saveButton,dismiss);
    addDictation(form,note);
    form.addEventListener('submit',event=>{
      event.preventDefault();
      if (!note.value.trim()) {note.focus();return;}
      try {
        message.recordId=save(note.value.trim(), candidate?.title || '身体情况').id;
        form.replaceWith(button('已记到健康本',()=>go('health')));
        announce('已记到您的健康本。');
      } catch(err) {announce(err.message);}
    });
    container.append(form); return true;
  }

  function addRecordAction(message, container, label='把这条记到健康本') {
    if (message.recordId && journal.list().some(record => record.id === message.recordId)) {
      container.append(button('已记到健康本', () => go('health'))); return;
    }
    if (photoRecord(message, container)) return;
    if (message.candidate) {
      const add = button(label, () => {
        if (container.querySelector('.candidate-editor')) return;
        const form = el('form', 'candidate-editor');
        const label = el('label','', '核对要记下的内容');
        const note = el('textarea');
        note.value = message.candidate.note;
        note.maxLength = 500;
        label.append(note);
        const submit = el('button','inline-action','确认并保存');
        submit.type = 'submit';
        form.append(label, submit, button('取消', () => {form.remove(); add.hidden = false;}));
        form.addEventListener('submit', async event => {
          event.preventDefault();
          if (!note.value.trim()) { note.focus(); return; }
          if (!(await checkedConfirm('请确认这是您本人的身体情况。保存后，下次打开这台设备还可以看到。'))) return;
          try {
            message.recordId = save(note.value.trim(), message.candidate.title).id;
            form.remove(); add.textContent = '已记到健康本'; add.hidden = false;
            add.replaceWith(button('已记到健康本', () => go('health')));
            announce('已记到您的健康本。');
          } catch (err) { announce(err.message); }
        });
        add.hidden = true; container.append(form); note.focus();
      });
      container.append(add);
    }
  }
  addDictation(byId('manual-health-form'), manual);
  byId('manual-health-form').addEventListener('submit', async event => {
    event.preventDefault();
    const note = manual.value.trim();
    if (!note) { manual.focus(); return; }
    if (!(await checkedConfirm('请确认这是您本人的身体情况，并同意将这条记录保存在这台设备上。'))) return;
    try {
      save(note, detectHealthCandidate(note)?.title || '身体情况');
      manual.value = ''; announce('已记到您的健康本。');
    } catch (err) { announce(err.message); }
  });

  function followup(record, parent) {
    if (parent.querySelector('form')) return;
    const form = el('form','followup-form');
    const question = record.title === '血压' ? '今天量的血压是多少？' : record.title === '血糖' ? '今天量的血糖是多少？是饭前还是饭后量的？' : record.title === '身体感受' ? '今天还有上次说的不舒服吗？' : '今天感觉怎么样？有新的测量结果也可以记下来。';
    const label = el('label','',question);
    const note = el('textarea'); note.rows = 2; note.maxLength=500; note.required=true;
    label.append(note);
    const submit = el('button','inline-action','保存本次回访');
    submit.type='submit';
    form.append(label, submit, button('取消', () => form.remove()));
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!note.value.trim()) { note.focus(); return; }
      try { journal.complete(record.id, note.value.trim()); refresh(); syncNative(); announce('回访已保存。'); }
      catch (err) { announce(err.message); }
    });
    addDictation(form, note); parent.append(form); note.focus();
  }

  function calendar(record) {
    try {
      const blob = new Blob([makeReminderCalendar(record)], {type:'text/calendar;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      const a = el('a');
      a.href = url; a.download = '健康回访.ics'; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      announce('请在系统日历里确认添加。以后想更改这个日历提醒，可以在日历里操作。');
    } catch (err) { announce(err.message); }
  }

  function mutate(method, id, message) {
    try { journal[method](id); refresh(); syncNative(); announce(message); }
    catch (err) { announce(err.message); }
  }

  function refresh() {
    const records = journal.list(), due = journal.due();
    const list = byId('health-records'), reminders = byId('upcoming-followups');
    const home = byId('health-due-home');
    home.replaceChildren();
    if (due.length) home.append(button('有健康回访，点这里看看', () => go('health')));
    home.hidden = !due.length;
    reminders.replaceChildren();
    const scheduled = [...records].filter(row => row.nextAt).sort((a,b) => Date.parse(a.nextAt)-Date.parse(b.nextAt));
    if (!scheduled.length) reminders.append(el('p','empty-state','保存身体情况时，可以选下一次提醒的时间。'));
    for (const record of scheduled) {
      const row = el('div','followup');
      const ready = due.some(item => item.id === record.id);
      row.append(el('strong','record-title', record.title), el('p','record-meta', ready ? '今天可以回访' : date(record.nextAt)+'回访'));
      const previous = record.followups?.at(-1);
      const previousNote = previous?.note || record.note;
      row.append(el('p','record-note', date(previous?.at || record.createdAt) + '记下：' + (previousNote.length > 72 ? previousNote.slice(0,72)+'…' : previousNote)));
      const actions = el('div','record-actions');
      actions.append(button('记下近况', () => followup(record,row)));
      if (ready) actions.append(button('明天再问', () => mutate('postpone',record.id,'回访已推迟到明天。')));
      actions.append(button('停止回访', () => mutate('stop',record.id,'已停止这条回访。')));
      if (!window.ZhibanReminders) actions.append(button('加到系统日历', () => calendar(record)));
      row.append(actions); reminders.append(row);
    }
    list.replaceChildren();
    if (!records.length) list.append(el('p','empty-state','健康本还是空的。您可以在上面记下今天的身体情况。'));
    for (const record of records) {
      const row = el('article','record health-record');
      row.append(el('small','record-meta',date(record.createdAt)), el('h3','record-title', record.title),
        el('p','record-note',record.note));
      for (const reply of record.followups || []) {
        row.append(el('p','record-meta', date(reply.at)+'回访 · '+reply.note));
      }
      const actions = el('div','record-actions');
      actions.append(button('删除这条', () => {
        if (actions.querySelector('[data-deleting]')) return;
        const yes = button('确认删除', () => mutate('remove',record.id,'这条记录已删除。'));
        yes.dataset.deleting = '1';
        actions.append(yes,button('保留',refresh)); yes.focus();
      }));
      row.append(actions); list.append(row);
    }
    const nativeRegion = byId('native-reminder-region');
    if (nativeRegion) nativeRegion.hidden = !window.ZhibanReminders || (!scheduled.length && !byId('native-reminders')?.checked);
  }

  let nativeChain = Promise.resolve();
  function nativeWork(task) {
    const bridge = window.ZhibanReminders;
    if (!bridge) return Promise.resolve();
    nativeChain = nativeChain.catch(() => {}).then(() => task(bridge));
    return nativeChain;
  }
  function nextEpoch() {
    const times = journal.list().filter(r => r.nextAt).map(r => Date.parse(r.nextAt));
    return times.length ? Math.min(...times) : 0;
  }
  function syncNative() {
    void nativeWork(async bridge => {
      const result = await bridge.sync(nextEpoch());
      if (result === 'error') announce('手机提醒暂时没有设置成功。打开健康本仍可以看到回访。');
    }).catch(() => {});
  }
  async function refreshNative() {
    refresh();
    try {
      await nativeWork(async bridge => {
        const check = byId('native-reminders');
        if (check) {
          check.checked = (await bridge.status()) === 'enabled';
          byId('native-reminder-region').hidden = !nextEpoch() && !check.checked;
        }
        await bridge.sync(nextEpoch());
      });
    } catch { /* In-app follow-ups stay available. */ }
  }
  byId('native-reminders')?.addEventListener('change', async event => {
    const check = event.target;
    const enabled = check.checked; check.disabled = true;
    try {
      await nativeWork(async bridge => {
        const result = await (enabled ? bridge.enable(nextEpoch()) : bridge.disable());
        check.checked = result === 'enabled';
        announce(result === 'enabled' ? '手机回访提醒已开启。' : result === 'disabled' ? '手机回访提醒已关闭。' : '手机暂时无法发送通知。打开健康本仍会提示回访。');
      });
    } catch { check.checked = false; announce('手机提醒暂时用不了，打开健康本可以看到回访。'); }
    finally { check.disabled = false; }
  });
  window.addEventListener('zhiban-reminders-ready',refreshNative);
  function refreshBackground() {
    if (!document.hidden && !byId('upcoming-followups').querySelector('form')) refreshNative();
  }
  window.addEventListener('storage',refreshBackground);
  document.addEventListener('visibilitychange',refreshBackground);
  const timer = setInterval(() => { if (!document.hidden && journal.due().length && !byId('upcoming-followups').querySelector('form') && !byId('health-records').querySelector('[data-deleting]')) refresh(); }, 60_000);
  window.addEventListener('pagehide', () => clearInterval(timer), {once:true});
  refreshNative();
  return {checkMessage, addRecordAction, refresh:refreshNative};
}
