import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseEffort, modelMessages, shouldSuggestNewChat } from '../web/conversation.js';

const user = (text, image) => ({role:'user', text, image});
const reply = text => ({role:'assistant', text});
const phone = [user('怎么打开手机相册？'), reply('在手机桌面找到相册，点一下。')];
const history = Array.from({length: 4}, () => phone).flat();
const cooking = user('鸡蛋羹怎么蒸更嫩？');

test('a topic change needs both history pressure and evidence of a different subject', () => {
  assert.equal(shouldSuggestNewChat(phone, cooking), false);
  assert.equal(shouldSuggestNewChat(history, cooking), true);
  assert.equal(shouldSuggestNewChat(history, user('相册里怎么保存照片？')), false);
  assert.equal(shouldSuggestNewChat(history, user('下一步怎么点？')), false);
  assert.equal(shouldSuggestNewChat(history, user('我现在喘不上气')), false);
  assert.equal(shouldSuggestNewChat(history, user('象棋的马怎么走？')), true);
  assert.equal(shouldSuggestNewChat(history, user('这个应该怎么用？')), false);
  assert.equal(shouldSuggestNewChat(history, user('换个话题，我想问一件事')), true);
  assert.equal(shouldSuggestNewChat(history, user('', 'photo')), false);
  assert.equal(shouldSuggestNewChat(history, cooking, 8), false);
  assert.equal(shouldSuggestNewChat([...history, ...history], cooking, 8), true);
  assert.equal(shouldSuggestNewChat([phone[0], reply('手机'.repeat(1500))], cooking), true);
});

test('short follow-ups inherit the complexity of a recent health or comparison question', () => {
  const earlier = [user('吃药的时间怎么安排？'), reply('请先看看药盒上的说明。')];
  assert.equal(chooseEffort([...earlier, user('那饭后呢？')]), 'high');
  assert.equal(chooseEffort([...earlier, user('怎么打开相册？')]), 'low');
  assert.equal(chooseEffort([...earlier, user('谢谢！')]), 'low');
  assert.equal(chooseEffort([user('帮我比较这几条行程')]), 'high');
});

test('only recent pairs and at most two photos reach the model; a fresh chat sends only its draft', () => {
  const turns = Array.from({length: 8}, (_, i) => [user('', 'photo' + i), reply('第' + i + '个回答')]).flat();
  const current = user('帮我看下这张照片', 'new-photo');
  const payload = modelMessages(turns, current);
  assert.equal(payload.length, 11);
  assert.deepEqual(payload.filter(m => m.image).map(m => m.image), ['photo7','new-photo']);
  assert.equal(payload[0].role, 'user');
  assert.ok(payload[0].text);
  assert.equal(turns[0].image, 'photo0');
  assert.deepEqual(modelMessages([], current), [{role:'user',text:current.text,image:current.image}]);
  const oversized = modelMessages([...history, user('刚才说的是面粉'), reply('面'.repeat(10000))], user('用多少？'));
  assert.equal(oversized.length, 3);
  assert.equal(oversized[0].text, '刚才说的是面粉');
  assert.ok(oversized.map(m => m.text).join('').length <= 6000);
});
