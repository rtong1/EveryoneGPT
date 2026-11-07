import test from 'node:test';
import assert from 'node:assert/strict';
import { detectHealthCandidate, imageHealthCandidate, createHealthJournal, makeReminderCalendar } from '../web/health.js';

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return Array.from(this.values.keys())[index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

const ownsReading = [
  ['我今天早上刚量了血压，是１４５／９５，要紧吗？', '血压'],
  ['我的血压刚刚量了是145/90', '血压'],
  ['今早我测的高压一百四十五，低压九十二。', '血压'],
  ['我的血压是145/90，正常范围是多少？', '血压'],
  ['我的血糖是7.2 mmol/L，如果明天还是这么高怎么办？', '血糖'],
  ['我空腹血糖6.5', '血糖'],
  ['我体温38.2度，需要做什么？', '体温'],
  ['这几天我右边肚子有点疼', '身体感受'],
  ['我左手手指麻了两天', '身体感受'],
  ['昨天晚上我烧到39度', '体温'],
  ['我量出来是高压140低压88', '血压'],
  ['我刚量的血氧是96%', '血氧'],
  ['我这两天一直头晕，怎么办？', '身体感受'],
  ['我最近晚上睡不着', '身体感受'],
  ['我这两天走路老觉得胸口闷得慌，咋办？', '身体感受'],
  ['我今天不舒服，会不会是感冒？', '身体感受'],
];

test('explicit first-person readings and current symptoms produce editable candidates', () => {
  for (const [message, title] of ownsReading) {
    const candidate = detectHealthCandidate(message);
    assert.equal(candidate?.title, title, message);
    assert.ok(candidate.note.length > 0);
  }
  assert.equal(detectHealthCandidate('我的血压是145/90，正常范围是多少？').note,'我的血压是145/90');
});

test('general, hypothetical, other people, photos, linguistic questions, and declined records are excluded', () => {
  const excluded = [
    '', undefined, '图片', '这张报告说的是啥？', '130/85', '血压140/85正常吗',
    '我想问一下血压150/95正常吗', '我的血压正常范围应该是多少',
    '如果我的血糖是7.2呢？', '假设如下。我头晕，我的血压是160/100。',
    '我血压如果到了145/95算高吗？', '我没有头晕', '我不觉得头疼', '我目前没有任何不适',
    '我亲戚头晕', '我给我爸量的血压是160/95', '我妈妈说她头疼',
    '我朋友说：“我头晕，我血压是150”。', '我替家人问，血压高该怎么办？',
    '我的血糖要是8怎么办？', '比如我昨天发烧，该怎么退烧？', '我想了解头晕是怎么回事',
    '我昨晚头晕，今天已经好了。', '我刚量了血压150/95，但不用记录。',
    '我家里有高血压的人', '我的血压目标值是130/80', '我头晕用英语怎么说',
    '我血糖低了会有什么表现？', '我头疼的时候应该喝水吗？', '我血压三天没测了', '我的血压一般是多少才合适？', '我的血糖一直正常',
    '我头晕吗？', '我担心我血压高怎么办', '医生问我头晕吗，我说没有。', '医生告诉我头痛很常见', '告诉我血压150/90算高吗',
    '我血糖是7吗？', '我血压是130/80还是140/90？', '我血压偏高的话怎么办？',
  ];
  for (const message of excluded) assert.equal(detectHealthCandidate(message), null, String(message));
});

test('image readings produce a preview only when legible values and units are explicit', () => {
  const storage = new MemoryStorage();
  const journal = createHealthJournal(storage);
  const bp = imageHealthCandidate({kind:'blood_pressure', systolic:140, diastolic:88, unit:'mmHg'});
  assert.equal(bp.note, '血压 140/88 mmHg');
  assert.deepEqual(journal.list(), []);
  assert.throws(() => journal.save(bp), /同意/u);
  assert.equal(imageHealthCandidate({kind:'blood_glucose', value:102, unit:'mg/dL'}).note, '血糖 102 mg/dL');
  assert.equal(imageHealthCandidate({kind:'blood_glucose', value:5.9, unit:'mmol/L'}).note, '血糖 5.9 mmol/L');
  assert.equal(imageHealthCandidate({kind:'blood_glucose', value:102}), null);
  assert.equal(imageHealthCandidate({kind:'blood_pressure', systolic:'140?', diastolic:80, unit:'mmHg'}), null);
  assert.equal(imageHealthCandidate(null), null);
});

test('saving requires personal consent and rejects unavailable storage without reporting a saved record', () => {
  const storage = new MemoryStorage();
  const journal = createHealthJournal(storage);
  const entry = {title:'血压', note:'我的血压120/81', intervalDays:1};
  assert.throws(() => journal.save(entry), /同意/u);
  assert.equal(storage.length, 0);
  assert.throws(() => journal.save({...entry, consent:true, intervalDays:5}), /间隔/u);
  assert.throws(() => journal.save({...entry, consent:true, note:' '}), /写下/u);
  const blocked = createHealthJournal(null);
  assert.deepEqual(blocked.list(), []);
  assert.throws(() => blocked.save({...entry, consent:true}), /无法保存/u);
});

test('due reminders can be answered, postponed, stopped and deleted across a reload', () => {
  const storage = new MemoryStorage();
  let now = new Date(2026, 10, 7, 23, 15);
  const journal = createHealthJournal(storage, () => now);
  const item = journal.save({title:'体温', note:'今晚我发烧了', consent:true, intervalDays:1});
  assert.deepEqual(journal.due(), []);
  assert.equal(item.nextAt, new Date(2026, 10, 8, 9).toISOString());
  const reopened = createHealthJournal(storage, () => now);
  now = new Date(2026, 10, 8, 10);
  assert.equal(reopened.due()[0].id, item.id);
  reopened.postpone(item.id);
  assert.equal(reopened.due().length, 0);
  now = new Date(2026, 10, 10, 10);
  const answered = reopened.complete(item.id, '今天我舒服多了');
  assert.deepEqual(answered.followups, [{at:now.toISOString(), note:'今天我舒服多了'}]);
  assert.equal(answered.nextAt, new Date(2026, 10, 11, 9).toISOString());
  reopened.stop(item.id);
  now = new Date(2026, 11, 1);
  assert.deepEqual(reopened.due(), []);
  assert.equal(reopened.list()[0].nextAt, null);
  assert.ok(journal.remove(item.id));
  assert.equal(reopened.complete(item.id), null);
  assert.deepEqual(reopened.list(), []);
});

test('calendar exports use neutral text, one stable event ID and the actual recurring interval', () => {
  const storage = new MemoryStorage();
  const journal = createHealthJournal(storage, () => new Date(2026, 10, 7, 20));
  const item = journal.save({title:'我的血压', note:'高压155低压95', consent:true, intervalDays:3});
  const calendar = makeReminderCalendar(item);
  assert.match(calendar, /DTSTART:20261110T090000\r\n/u);
  assert.match(calendar, /RRULE:FREQ=DAILY;INTERVAL=3\r\n/u);
  assert.match(calendar, /BEGIN:VALARM/u);
  assert.ok(calendar.includes(`UID:${item.id}@zhiban.local`));
  assert.doesNotMatch(calendar, /血压|高压|低压|身体记录|回访结果/u);
  assert.throws(() => makeReminderCalendar(journal.stop(item.id)), /开启/u);
});

test('clearing the health journal leaves unrelated device preferences untouched', () => {
  const storage = new MemoryStorage();
  const first = createHealthJournal(storage);
  const second = createHealthJournal(storage);
  storage.setItem('fontSize', 'large');
  first.save({note:'我早上头疼', consent:true, intervalDays:0});
  second.save({note:'我血糖6.4', consent:true, intervalDays:7});
  assert.equal(first.list().length, 2);
  first.clear();
  assert.deepEqual(second.list(), []);
  assert.equal(storage.getItem('fontSize'), 'large');
});
