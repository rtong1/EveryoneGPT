import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { notificationManager } from '@kit.NotificationKit';

// ArkWeb API 12's async proxy methods do not return results to JavaScript.
// This adapter pairs each request with its eventual system result.
export const WEB_REMINDER_ADAPTER: string = `
(() => {
  if (!window.ZhibanReminderPort || window.ZhibanReminders) return;
  let sequence = 0;
  const waiting = new Map();
  const call = (operation, due = 0) => new Promise(resolve => {
    const id = ++sequence;
    const timeout = setTimeout(() => { waiting.delete(id); resolve('unavailable'); }, 90000);
    waiting.set(id, value => { clearTimeout(timeout); waiting.delete(id); resolve(value); });
    try { window.ZhibanReminderPort.request(id, operation, Number(due)); }
    catch { waiting.get(id)('unavailable'); }
  });
  window.zhibanReminderResult = (id, state) => waiting.get(id)?.(state);
  window.ZhibanReminders = Object.freeze({
    status: () => call('status'),
    enable: due => call('enable', due),
    sync: due => call('sync', due),
    disable: () => call('disable')
  });
  window.dispatchEvent(new Event('zhiban-reminders-ready'));
})();`;

export class ReminderPort {
  private tail: Promise<void> = Promise.resolve();

  private context: common.UIAbilityContext;
  private store: preferences.Preferences;
  private allowed: () => boolean;
  private reply: (id: number, state: string) => void;

  constructor(context: common.UIAbilityContext, store: preferences.Preferences,
    allowed: () => boolean, reply: (id: number, state: string) => void) {
    this.context = context;
    this.store = store;
    this.allowed = allowed;
    this.reply = reply;
  }

  request(id: number, operation: string, due: number): void {
    if (!Number.isSafeInteger(id) || id < 1 || !this.allowed()) return;
    this.tail = this.tail.then(async () => {
      let state: string = 'unavailable';
      try {
        if (this.allowed()) state = await this.perform(operation, due);
      } catch {
        state = 'error';
      }
      if (this.allowed()) this.reply(id, state);
    }).catch(() => {});
  }

  // Called by the native settings screen before switching to another family's server.
  async disconnect(): Promise<void> {
    await this.tail;
    if (this.store.getSync('remindersEnabled', false) === true) await this.clear();
  }

  private async perform(operation: string, due: number): Promise<string> {
    const enabled = this.store.getSync('remindersEnabled', false) === true;
    if (operation === 'disable') {
      if (enabled) await this.clear();
      return 'disabled';
    }
    if (operation === 'status') {
      if (!enabled) return 'disabled';
      return await notificationManager.isNotificationEnabled() ? 'enabled' : 'error';
    }
    if (operation !== 'enable' && operation !== 'sync') return 'error';
    if (!Number.isSafeInteger(due) || due < 0 || due > Date.now() + 366 * 86400000) return 'error';
    if (operation === 'sync' && !enabled) return 'disabled';
    if (operation === 'enable') {
      if (!await notificationManager.isNotificationEnabled()) {
        await notificationManager.requestEnableNotification(this.context);
      }
      if (!await notificationManager.isNotificationEnabled()) return 'error';
      if (!this.allowed() || due === 0) return 'error';
    }
    if (due > 0 && !await notificationManager.isNotificationEnabled()) return 'error';
    await this.reconcile(due);
    if (!enabled) {
      this.store.putSync('remindersEnabled', true);
      await this.store.flush();
    }
    return 'enabled';
  }

  private async clear(): Promise<void> {
    await reminderAgentManager.cancelAllReminders();
    this.store.putSync('due', 0);
    this.store.putSync('remindersEnabled', false);
    await this.store.flush();
  }

  private async reconcile(due: number): Promise<void> {
    const previous = this.store.getSync('due', 0) as number;
    const existing = await reminderAgentManager.getAllValidReminders();
    if (due === previous && (existing.length === 1 || (existing.length === 0 && due <= Date.now()))) return;
    if (due === 0) {
      if (existing.length > 0) await reminderAgentManager.cancelAllReminders();
    } else {
      // Publish first so a rejected replacement leaves the previous reminder intact.
      const date = new Date(Math.max(due, Date.now() + 60000));
      const request: reminderAgentManager.ReminderRequestCalendar = {
        reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
        dateTime: {
          year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
          hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds()
        },
        title: '知伴', content: '您约好的回访时间到了，点这里看看。',
        notificationId: 7362,
        ringDuration: 0,
        wantAgent: { pkgName: this.context.applicationInfo.name, abilityName: 'EntryAbility' },
        slotType: notificationManager.SlotType.CONTENT_INFORMATION
      };
      await reminderAgentManager.publishReminder(request);
      for (const reminder of existing) await reminderAgentManager.cancelReminder(reminder.reminderId);
    }
    this.store.putSync('due', due);
    await this.store.flush();
  }
}
