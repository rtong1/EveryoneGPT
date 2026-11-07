// Local hints keep topic decisions private and avoid an extra model call per turn.
const topics = [
  /血压|血糖|身体|头晕|胸痛|医院|门诊|医生|症状|吃药|药物|血脂|体检|发烧|咳嗽|心率|失眠/,
  /微信|手机|电脑|相册|字体|字号|输入法|应用|浏览器|设置|联网|路由器|无线网|屏幕/,
  /做菜|炒菜|烧菜|做饭|菜谱|蒸|炖|煮|腌|鸡蛋|排骨|番茄|红烧|食谱/,
  /火车|高铁|车票|飞机|机票|出游|景点|旅游|行程|航班|酒店|地铁|公交/,
  /养花|浇水|施肥|花盆|盆栽|花草|兰花|绿萝|月季|种花|修剪/,
  /社保|医保|养老金|退休金|公积金|参保|报销/,
  /存款|银行|利息|理财|基金|股票|汇款|转账|诈骗/,
  /朝代|历史|诗人|诗词|唐诗|宋词|皇帝|古诗/,
  /天气|下雨|气温|寒潮|台风|天气预报/,
  /洗衣机|冰箱|空调|电视|热水器|电饭锅|电饭煲|微波炉/
];
const topicChange = /换个?话题|换一?个问题|另(?:外)?一件事|说点别的|再问个别的/;
const followUp = /^(?:那(?:么|个|要|还|我|如|是|该|为|怎|能|需|可)|这(?:个|样|张|种|些|是我)|刚才|之前|接着|所以|然后|还有呢|为什么[呢呀吗？?。]*$|怎么办[呢呀吗？?。]*$|多久[呢呀吗？?。]*$|明白了|谢谢|对[，,。]|是的|还是|第二步|下一步|能再|再说|没听懂|我说的是)/;
const highStakes = /血压|血糖|心率|胸(?:痛|闷|口疼)|呼吸困难|喘不上气|头晕|头疼|头痛|出血|发烧|发热|疼痛|过敏|药|剂量|就医|急诊|诊断|检查单|体检|化验|不舒服|[肚腹腰腿胃背]疼|诈骗|被骗|转账|汇款|合同|诉讼|投资风险/;
const complexQuestion = /分析|比较|对比|权衡|利弊|详细规划|制定.{0,6}计划|分.{0,3}步骤.{0,8}排查|同时考虑|哪个.{0,8}(?:更好|划算|合适)/;
const urgent = /胸(?:痛|口疼).{0,8}(?:厉害|严重)|喘不上气|呼吸困难|昏倒|叫不醒|突然.{0,4}(?:偏瘫|说不出话)/;
const simpleQuestion = /你好|您好|谢谢|早上好|晚安|几点|怎么读|什么意思|怎么写|怎么念|翻译|怎么(?:打开|关闭|调大|放大|调小|设置|截图|保存)|怎么做|煮多久|在哪(?:里|儿)/;

export function chooseEffort(messages) {
  const current = messages.at(-1);
  const text = (current.text || '').trim();
  if (current.image || highStakes.test(text) || urgent.test(text) || complexQuestion.test(text) || text.length > 400) return 'high';
  if (/^(?:谢谢[您你]?|好的|明白了|你好|您好)[呀啊啦了。！!]*$/.test(text)) return 'low';
  if (!topicChange.test(text) && (followUp.test(text) || text.length <= 10)) {
    const recent = messages.slice(0, -1).slice(-4);
    if (recent.some(m => highStakes.test(m.text) || complexQuestion.test(m.text))) {
      const standalone = topics.some(pattern => pattern.test(text));
      if (!standalone || followUp.test(text)) return 'high';
    }
  }
  return text.length <= 80 && simpleQuestion.test(text) ? 'low' : 'medium';
}

function textUnits(text = '') {
  // Approximate input size without a tokenizer. Count Han characters individually.
  const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
  return nonAscii + Math.ceil((text.length - nonAscii) / 4);
}
const messageUnits = m => textUnits(m.text) + (m.image ? 900 : 0);

// For subjects outside the common categories, look for an explicit named subject in the
// new question and an established subject in both of the preceding exchanges.
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', {granularity:'word'}) : null;
const filler = /^(?:什么|哪些|如何|怎么|怎样|为什么|多少|可以|可不可以|能不能|应该|时候|需要|知道|想要|一下|一个|一些|问题|请问|帮忙|帮我|我们|自己|如果|这个|那个|事情|告诉|请教)$/;
function subjectWords(text) {
  if (!segmenter) return new Set();
  return new Set([...segmenter.segment(text)].filter(part => part.isWordLike && part.segment.length > 1 &&
    !filler.test(part.segment)).map(part => part.segment.toLowerCase()));
}

function differentNamedSubject(text, recent) {
  if (recent.length < 4) return false;
  const subject = text.match(/^(?:请问|我想问问|我想知道)?([\p{L}\d·]{2,16}?)(?:是(?:什么|谁|哪)|的.{0,5}(?:怎么|是|有|叫)|应该怎么|怎么|如何|为什么)/u);
  if (!subject) return false;
  const words = subjectWords(subject[1]);
  const previous = recent.slice(-4).map(m => m.text || '');
  const last = subjectWords(previous.slice(-2).join(' '));
  const before = subjectWords(previous.slice(0, 2).join(' '));
  return words.size > 0 && [...last].some(word => before.has(word)) &&
    [...words].every(word => !previous.some(line => line.toLowerCase().includes(word)));
}

export function shouldSuggestNewChat(history, current, nextEligibleTurn = 0) {
  const text = (current.text || '').trim();
  const turns = history.length / 2; // Completed user/assistant pairs only.
  if (!text || urgent.test(text) || turns < nextEligibleTurn || !turns) return false;
  const recent = history.slice(-10);
  if (turns < 4 && recent.reduce((sum, m) => sum + messageUnits(m), 0) < 2400) return false;
  if (topicChange.test(text)) return true;
  if (followUp.test(text)) return false;
  const prior = recent.slice(-4).map(m => m.text || '').join(' ');
  const currentTopics = topics.filter(pattern => pattern.test(text));
  if (currentTopics.some(pattern => pattern.test(prior))) return false;
  if (currentTopics.length && topics.some(pattern => pattern.test(prior))) return true;
  return differentNamedSubject(text, recent);
}

export function modelMessages(history, current) {
  const result = [];
  let photos = 0, units = 0;
  function project(m) {
    const text = m.text || '';
    const out = {role: m.role, text: text.length > 8000 ? text.slice(0, 3999) + '…' + text.slice(-4000) : text};
    if (m.image) {
      if (photos < 2) { photos++; out.image = m.image; }
      else if (!out.text) out.text = '（此前发过一张照片）';
    }
    return out;
  }
  const question = project(current);
  result.push(question);
  units += messageUnits(question);
  for (let i = history.length - 2; i >= 0 && result.length < 11; i -= 2) {
    const user = project(history[i]), assistant = project(history[i + 1]);
    const cost = messageUnits(user) + messageUnits(assistant);
    if (units + cost > 6000) {
      // Keep the immediately preceding exchange, including its photo, for short follow-ups.
      if (result.length === 1) {
        const remaining = 6000 - units - messageUnits(user);
        if (remaining > 64) {
          const tail = assistant.text.slice(-Math.max(1, remaining - 1));
          result.unshift(user, {...assistant, text: tail.length < assistant.text.length ? '…' + tail : tail});
        }
      }
      break;
    }
    result.unshift(user, assistant);
    units += cost;
  }
  return result;
}
