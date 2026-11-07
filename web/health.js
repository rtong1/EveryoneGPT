// Detection only returns an editable note. Saving requires permission to use the local journal.
const alternatives = groups => `(?:${groups.join('|')})`;

const subject = '(?:我(?:本人|自己)?|本人)(?:的)?';
const timeWords = alternatives([
  '今天|今日|昨天|昨晚|今早',
  '今晚|今儿|早晨|早上|清晨|晚上',
  '中午|下午|上午|昨|今|这几天|这两天|这段时间',
  '这周|近日|最近|近来|现在|目前|刚才|刚刚|刚',
  '经常|常常|连续|有时候|偶尔|每天|昨夜|半夜|这会儿',
  '这次|一早|起床后|一站起来|走路时?|干活时?|起身时?|从',
  '饭前|饭后|餐前|餐后|睡前|空腹|早饭后|早饭前|起床',
  '时候|的时候|这几日',
  '[零一二两三四五六七八九十\\d]+(?:天|小时|分钟)(?:前|后|来|了)?',
]);
const modifiers = alternatives([
  '自己|有点儿|有点|有一些|有些|有一阵',
  '一直|突然|总是|总|就是|都|还|又|也|就',
  '老是|老|觉得|感觉|感到',
  '已经|开始|出现了|出现|有|伴有|反复',
  '特别|非常|比较|挺|很|的|在|时',
  '稍微|轻微|严重|身体|身上',
]);
const measureVerb = '(?:测量|测|量|查|检测|复测|自测|重测)(?:了(?:一[次下])?|了一下|到的?|出(?:来)?(?:的|了)?|过|得|的)?';
const personPattern = new RegExp(subject, 'gu');
const contextWord = new RegExp(`^(?:${timeWords}|${modifiers}|${measureVerb}|是(?=高压|低压|血压|血糖|体温)|[\\s,，])`, 'u');
const reader = `(?:${timeWords}|${measureVerb}|读数(?:为|是)?|显示(?:为|是)?|测出来(?:为|是)?|量出来(?:为|是)?|测得|测出|量到|测到|测了|升至|降至|升到|降到|达到|到了|是|为|有|到|大约|大概|约|才|只有|结果|刚好|在|高压|收缩压|[\\s,:，：=])`;
const number = '(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百]+(?:点[零〇一二两三四五六七八九]+)?)';
const readingWord = new RegExp(`^${reader}`, 'u');
const amount = new RegExp(`^${number}`, 'u');
const readings = [
  ['血压', '(?:血压(?:值)?|收缩压|舒张压|高压|低压)'],
  ['血糖', '(?:血糖(?:值)?)'],
  ['体温', '(?:体温|烧到了?)'],
  ['心率', '(?:心率|心跳|脉搏)'],
  ['血氧', '(?:血氧(?:饱和度)?)'],
  ['体重', '(?:体重)'],
].map(([title, label]) => ({ title, pattern: new RegExp(`^${label}`, 'u') }));
const symptom = alternatives([
  '不舒服|不适|不得劲|难受|头(?:晕|昏|痛|疼|胀)',
  '眩晕|胸(?:闷|疼|痛|口(?:闷|疼|痛))|心(?:慌|悸)|心跳(?:得)?(?:很|太)?快',
  '发(?:烧|热|冷)|咳(?:嗽|痰)|流鼻涕',
  '嗓子(?:疼|痛)|咽(?:痛|疼)|喘(?:不过气|不上气|得厉害)',
  '呼吸困难|气(?:短|促)|气不够用',
  '恶心|呕吐|想吐|肚子(?:疼|痛|胀)|腹(?:痛|胀|泻)',
  '拉肚子|便秘|胃(?:痛|疼|胀)|反酸|烧心',
  '(?:肩膀|后背|膝盖|关节|牙齿|小腿|大腿|脖子|胳膊|腰|腿|背|脚|牙|手腕|眼睛|耳朵)(?:有点|有些|很|一直)?(?:酸痛|酸疼|疼|痛|肿|麻)',
  '手麻|脚麻|眼花|耳鸣|乏力|没(?:力气|精神|劲)',
  '睡不着|失眠|尿(?:痛|不尽|频|急)|小便(?:痛|疼|困难)|出冷汗',
  '(?:血压|血糖)(?:有点|有些|偏|很|太)?[高低]',
]);
const localPain = '(?:[左右](?:边|侧)?)?(?:肚子|腹部|手(?:手指|指头|指|腕)?|脚(?:趾|腕)?|腿|耳朵|肩膀|膝盖)(?:有点|有些|有一点|经常|一直|总是|特别|很)?(?:酸疼|酸痛|疼|痛|胀|麻|肿)';
const symptomPattern = new RegExp(`^(?:${symptom}|${localPain})`, 'u');
const family = /爸爸|妈妈|爷爷|奶奶|姥爷|姥姥|外公|外婆|父亲|母亲|父母|儿子|女儿|孩子|小孩|老伴|爱人|丈夫|妻子|老公|老婆|朋友|同事|邻居|病人|患者|家人|(?:我|咱)(?:爸|妈|爹|娘|哥|姐|弟|妹|孙)|[他她](?:的|也|说|刚|今天|最近|测|量|有)/u;
const hypothetical = /如果|假如|假定|假设|倘若|万一|要是|要[是算]我|比如|譬如|例如|举[个一]?例|打个比方|设想|假使|模拟|可能会|会不会|要出现|会出现|尚未|还没测|没有测|没量过|没量血压|尚未测/u;
const impersonal = /朋友说|有人说|网上(?:说|写)|看到.{0,8}(?:说|写)|引用|新闻|病例|例子|[“”「」『』"‘’]|[我本]人(?:没有|没测|没量)|不是我(?:的|本人)|帮(?:人|别人|家人|患者)[问查转]|转述|替.{0,8}问/u;
const uncertainSubject = /(?:担心|担忧|害怕|怕|怀疑|猜|想知道|想了解|谁说|没有说|没说)(?:是不是|会不会|是)?$/u;
const indirectObject = /(?:告诉(?:了)?|转告|教|提醒|问(?:了|过)?|问问|向|给|对)$/u;
const undecidedValue = /^(?:\s*(?:mmHg|mmol\/L|mg\/dL|毫米汞柱|度|左右))?\s*(?:吗|么|[还或]是|或者|对不对|了没有)/iu;
const uncertainSymptom = /^(?:吗|么|了[吗么]|了没有|没有|不(?:晕|疼|痛|烧|闷|舒服|高|低|麻|肿))/u;
const resolved = /已(?:经)?(?:好了|康复|痊愈|恢复正常)|现在(?:已经)?(?:好了|正常了|没事了|不[疼痛晕烧])|以前|小时候|曾经/u;
const generalReading = /正常范围|参考范围|标准范围|标准值|目标值|理想值|正常值|正常血压是|标准是|应该(?:是|在|到|有)|应当(?:是|在|到)|超过.{0,6}会|维持在|控制在|上限|下限/u;
const languageQuestion = /英语|英文|翻译|造句|这个词|这句话|这个句子|怎么拼/u;
const conditionalQuestion = /的话(?:要|该|怎么办|会|能|怎)|(?:的时候|时)(?:应不应该|该不该|该|应该|一般|要|能|会有什么|可以|用不用|怎么办)|(?:了|低|高|痛)会(?:有|出现|导致|怎么样)|会有(?:什么|哪些)(?:表现|症状)/u;
const trailingQuestion = /[。,，；;！？!?\n]\s*(?:如果|要是|假如|假设|会不会|这会不会|正常范围|参考范围|标准范围|请问)/u;
const privacyRequest = /(?:不要|别|无需|不用|不必|不想|不许|禁止).{0,5}(?:记|存|留档|收集)/u;

// Consume complete words once. Overlapping Chinese words must not cause backtracking
// when long dictation or pasted text contains repeated time or degree modifiers.
function afterWords(text, word) {
  let rest = text;
  for (let match; (match = word.exec(rest));) rest = rest.slice(match[0].length);
  return rest;
}

function personalReport(sentence) {
  for (const person of sentence.matchAll(personPattern)) {
    const lead = sentence.slice(0, person.index);
    if (uncertainSubject.test(lead) || (indirectObject.test(lead) && !lead.endsWith('请问'))) continue;
    const rest = afterWords(sentence.slice(person.index + person[0].length), contextWord);
    for (const {title, pattern} of readings) {
      const label = pattern.exec(rest);
      if (!label) continue;
      const value = afterWords(rest.slice(label[0].length), readingWord);
      const match = amount.exec(value);
      if (!match || /^一(?:般|向|直|旦|会|切|定|起|天|阵|时|个|种)/u.test(value)) continue;
      const afterValue = value.slice(match[0].length).replace(/^\s*[\/／比]\s*[\d零〇一二两三四五六七八九十百]+/u, '');
      if (!/^(?:天|周|次|小时|分钟|年|岁|个月|种|会儿)/u.test(afterValue) && !undecidedValue.test(afterValue)) {
        return {kind: 'measurement', title};
      }
    }
    const feeling = symptomPattern.exec(rest);
    if (feeling && !uncertainSymptom.test(rest.slice(feeling[0].length))) {
      return {kind: 'symptom', title: '身体感受'};
    }
  }
  return null;
}

export function detectHealthCandidate(text) {
  if (typeof text !== 'string' || text.length > 2000) return null;
  const normal = text.normalize('NFKC').trim();
  if (!normal || impersonal.test(normal) || privacyRequest.test(normal) || languageQuestion.test(normal)) return null;
  // Preserve a concrete reading before a separate question, such as ‘我的血压145/90，正常范围是多少？’.
  const report = normal.split(trailingQuestion)[0];
  if (hypothetical.test(report)) return null;
  for (const sentence of report.split(/[。！？!?;；\n]/u)) {
    const s = sentence.trim();
    if (!s || family.test(s) || resolved.test(s) || generalReading.test(s) || conditionalQuestion.test(s)) continue;
    const candidate = personalReport(s);
    if (candidate) return {...candidate, note: s.slice(0, 500)};
  }
  return null;
}

// OCR is a draft only. Callers must ask the user to verify both numbers and whose reading it is.
export function imageHealthCandidate(reading) {
  if (!reading || typeof reading !== 'object') return null;
  const {kind, systolic, diastolic, value, unit} = reading;
  if (kind === 'blood_pressure' && unit === 'mmHg' && Number.isInteger(systolic) && Number.isInteger(diastolic) && systolic >= diastolic && diastolic > 0 && systolic < 1000) {
    return {kind: 'measurement', title: '血压', note: `血压 ${systolic}/${diastolic} mmHg`};
  }
  if (kind === 'blood_glucose' && ['mmol/L', 'mg/dL'].includes(unit) && Number.isFinite(value) && value > 0 && value < 10000) {
    return {kind: 'measurement', title: '血糖', note: `血糖 ${value} ${unit}`};
  }
  return null;
}

const PREFIX = 'zhiban.health.v1.';
const INTERVALS = [0, 1, 3, 7];
const storageError = () => new Error('这台设备无法保存健康记录。请检查浏览器的存储权限和剩余空间。');

function localStore() {
  try { return globalThis.localStorage; } catch { return null; }
}

function nextVisit(now, days) {
  if (!days) return null;
  const next = new Date(now);
  next.setDate(next.getDate() + days);
  next.setHours(9, 0, 0, 0);
  return next.toISOString();
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createHealthJournal(storage = localStore(), clock = () => new Date()) {
  function keys() {
    if (!storage) return [];
    const all = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX)) all.push(key);
    }
    return all;
  }
  function read(key) {
    try {
      const item = JSON.parse(storage?.getItem(key) || 'null');
      if (item && key === PREFIX + item.id && typeof item.title === 'string' && typeof item.note === 'string' && Number.isFinite(Date.parse(item.createdAt))) {
        return {...item, followups: Array.isArray(item.followups) ? item.followups : []};
      }
    } catch { /* A damaged entry can still be cleared using clear(). */ }
    return null;
  }
  function list() {
    try { return keys().map(read).filter(Boolean).sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
    catch { return []; }
  }
  function write(item) {
    try {
      if (!storage) throw storageError();
      storage.setItem(PREFIX + item.id, JSON.stringify(item));
    } catch { throw storageError(); }
    return item;
  }
  function update(id, change) {
    const item = read(PREFIX + id);
    return item ? write(change(item)) : null;
  }
  return {
    list,
    due() {
      const now = Number(clock());
      return list()
        .filter(record => record.intervalDays > 0 && Date.parse(record.nextAt) <= now)
        .sort((a, b) => a.nextAt.localeCompare(b.nextAt));
    },
    save({title = '身体记录', note, consent, intervalDays = 3} = {}) {
      if (consent !== true) throw new Error('请先确认这是您本人的情况，并同意保存在这台设备。');
      if (typeof note !== 'string' || !note.trim()) throw new Error('请写下要记的读数或身体感受。');
      if (note.trim().length > 500) throw new Error('每条记录最多可以写 500 个字。');
      if (!INTERVALS.includes(intervalDays)) throw new Error('请选择回访的间隔。');
      const now = clock();
      return write({
        id: newId(),
        title: String(title).trim().slice(0, 40) || '身体记录',
        note: note.trim(),
        createdAt: new Date(now).toISOString(),
        intervalDays,
        nextAt: nextVisit(now, intervalDays),
        followups: [],
      });
    },
    postpone(id) {
      return update(id, item => ({...item, nextAt:nextVisit(clock(), item.intervalDays ? 1 : 0)}));
    },
    complete(id, reply = '') {
      if (typeof reply !== 'string' || reply.length > 500) throw new Error('每次回访最多可以写 500 个字。');
      const now = clock();
      return update(id, item => {
        const note = reply.trim();
        if (note) item.followups.push({at: new Date(now).toISOString(), note});
        item.nextAt = nextVisit(now, item.intervalDays);
        return item;
      });
    },
    stop(id) { return update(id, item => ({...item, intervalDays:0, nextAt:null})); },
    remove(id) {
      try {
        if (!storage) throw storageError();
        const key = PREFIX + id;
        const existed = storage.getItem(key) !== null;
        storage.removeItem(key);
        return existed;
      } catch { throw storageError(); }
    },
    clear() {
      try {
        if (!storage) throw storageError();
        for (const key of keys()) storage.removeItem(key);
      } catch { throw storageError(); }
    },
  };
}

// Floating local time preserves a 9am reminder if the user's time zone changes.
export function makeReminderCalendar(record) {
  if (!record || ![1,3,7].includes(record.intervalDays) || !Number.isFinite(Date.parse(record.nextAt))) throw new Error('请先开启这条记录的回访。');
  const date = new Date(record.nextAt);
  const pad = n => String(n).padStart(2,'0');
  const start = `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}T090000`;
  const uid = String(record.id).replace(/[^A-Za-z0-9-]/g,'');
  const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Zhiban//Reminder//ZH', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${uid}@zhiban.local`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, 'DURATION:PT5M',
    `RRULE:FREQ=DAILY;INTERVAL=${record.intervalDays}`, 'SUMMARY:打开知伴看看', 'CLASS:PRIVATE',
    'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:打开知伴看看', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
