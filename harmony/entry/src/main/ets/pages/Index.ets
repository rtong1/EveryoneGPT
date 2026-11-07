import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { webview } from '@kit.ArkWeb';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { bridgePermission, httpsOrigin } from './Origin';
import { ReminderPort, WEB_REMINDER_ADAPTER } from '../reminders/Reminders';

@Entry
@Component
struct Index {
  @State private origin: string = '';
  @State private draft: string = '';
  @State private settings: boolean = true;
  @State private failed: boolean = false;
  @State private note: string = '';
  @State private saving: boolean = false;
  private controller: webview.WebviewController = new webview.WebviewController();
  private store: preferences.Preferences | null = null;
  private reminders: ReminderPort | null = null;
  private attached: boolean = false;

  aboutToAppear(): void {
    const context = getContext(this) as common.UIAbilityContext;
    try {
      this.store = preferences.getPreferencesSync(context, { name: 'zhiban_settings' });
      this.origin = httpsOrigin(this.store.getSync('origin', '') as string, true);
      this.draft = this.origin;
      this.settings = this.origin === '';
      this.reminders = new ReminderPort(context, this.store, () => this.trustedPage(),
        (requestId: number, state: string) => {
          // Both interpolated values are restricted by ReminderPort.
          this.controller.runJavaScript('window.zhibanReminderResult?.(' + requestId +
            ',' + JSON.stringify(state) + ');').catch(() => {});
        });
    } catch {
      this.note = '暂时无法读取设置，请重新打开知伴。';
    }
  }

  private trustedPage(): boolean {
    if (!this.attached || this.settings || this.failed || this.origin === '') return false;
    try {
      return httpsOrigin(this.controller.getUrl()) === this.origin;
    } catch {
      return false;
    }
  }

  private registerBridge(): void {
    this.attached = true;
    if (this.reminders === null) return;
    try {
      this.controller.registerJavaScriptProxy(this.reminders, 'ZhibanReminderPort', ['request'], [],
        bridgePermission(this.origin));
    } catch {
      // Devices without the bridge still offer reminders inside the journal.
    }
  }

  private detach(): void {
    if (this.attached) {
      this.attached = false;
      try {
        this.controller.deleteJavaScriptRegister('ZhibanReminderPort');
      } catch {}
    }
  }

  private editAddress(): void {
    this.detach();
    this.draft = this.origin;
    this.note = '';
    this.settings = true;
    this.failed = false;
  }

  private async connect(): Promise<void> {
    const input = this.draft.trim();
    if (input === '' || this.saving) return;
    const origin = httpsOrigin(input.indexOf('://') < 0 ? 'https://' + input : input, true);
    if (origin === '') {
      this.note = '请填写 HTTPS 网站首页地址，例如 https://ai.example.cn。';
      return;
    }
    this.saving = true;
    try {
      if (this.store === null) throw new Error('storage');
      if (this.origin !== '' && origin !== this.origin && this.reminders !== null) {
        await this.reminders.disconnect();
      }
      this.store.putSync('origin', origin);
      await this.store.flush();
      this.origin = origin;
      this.draft = origin;
      this.note = '';
      this.failed = false;
      this.settings = false;
    } catch {
      this.note = '地址暂时无法保存，请稍后重试。';
    } finally {
      this.saving = false;
    }
  }

  private async selectPhoto(result: FileSelectorResult): Promise<void> {
    const origin = this.origin;
    let files: string[] = [];
    try {
      if (this.trustedPage()) {
        const options = new photoAccessHelper.PhotoSelectOptions();
        options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
        options.maxSelectNumber = 1;
        options.isPhotoTakingSupported = true;
        const selection = await new photoAccessHelper.PhotoViewPicker().select(options);
        if (origin === this.origin && this.trustedPage()) files = selection.photoUris.slice(0, 1);
      }
    } catch {
      // Cancelled by the person, or picker unavailable. Release the pending input.
    }
    result.handleFileList(files);
  }

  private async microphone(request: PermissionRequest): Promise<void> {
    const origin = this.origin;
    const resources = request.getAccessibleResource();
    const audio: string = ProtectedResourceType.AUDIO_CAPTURE;
    if (!this.trustedPage() || httpsOrigin(request.getOrigin()) !== origin ||
      resources.length !== 1 || resources[0] !== audio) {
      request.deny();
      return;
    }
    let granted: boolean = false;
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const result = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(
        context, ['ohos.permission.MICROPHONE']);
      granted = result.authResults[0] === 0 && this.origin === origin && this.trustedPage();
    } catch {}
    if (granted) {
      request.grant([audio]);
    } else {
      request.deny();
    }
  }

  private intercept(request: WebResourceRequest): WebResourceResponse | null {
    const uri = request.getRequestUrl();
    if (httpsOrigin(uri) === this.origin && this.origin !== '') return null;
    if (!request.isMainFrame() && (uri.startsWith('blob:' + this.origin + '/') ||
      uri.startsWith('data:image/') || uri.startsWith('data:audio/'))) return null;
    const response = new WebResourceResponse();
    response.setResponseCode(403);
    response.setReasonMessage('Forbidden');
    response.setResponseMimeType('text/plain');
    response.setResponseEncoding('utf-8');
    response.setResponseData('仅可打开已设置的知伴服务。');
    return response;
  }

  onBackPress(): boolean {
    if (this.settings && this.origin !== '') {
      this.settings = false;
      return true;
    }
    if (this.settings || this.failed) return false;
    if (this.attached && this.controller.accessBackward()) {
      this.controller.backward();
      return true;
    }
    AlertDialog.show({
      title: '离开知伴？',
      message: '下次打开可继续使用当前服务。',
      primaryButton: { value: '服务地址设置', action: () => this.editAddress() },
      secondaryButton: { value: '退出', action: () => {
        const context = getContext(this) as common.UIAbilityContext;
        context.terminateSelf();
      }},
      autoCancel: true
    });
    return true;
  }

  build() {
    Column() {
      if (this.settings) {
        Scroll() {
          Column({ space: 20 }) {
            Text(this.origin === '' ? '接入知伴' : '服务地址设置')
              .fontSize(34).fontWeight(FontWeight.Bold).fontColor('#372D31').width('100%')
            Text('请家人填入知伴服务的网址。保存一次，以后打开就能使用。')
              .fontSize(21).lineHeight(32).fontColor('#53464A').width('100%')
            Text('服务地址').fontSize(22).fontWeight(FontWeight.Medium).width('100%')
            TextInput({ text: this.draft, placeholder: 'https://ai.example.cn' })
              .height(62).fontSize(20).backgroundColor('#FFFFFF')
              .onChange((value: string) => { this.draft = value; this.note = ''; })
            if (this.note) {
              Text(this.note).fontSize(18).fontColor('#852D3D').width('100%')
            }
            Button(this.saving ? '正在保存…' : '保存并打开')
              .height(58).width('100%').backgroundColor('#813847').fontSize(22)
              .enabled(!this.saving && this.draft.trim().length > 0).onClick(() => this.connect())
            if (this.origin !== '') {
              Button('返回聊天').height(54).width('100%').backgroundColor('#EEE6E1').fontColor('#34272D')
                .fontSize(20).onClick(() => { this.settings = false; })
            }
          }.width('100%').constraintSize({ maxWidth: 580 }).padding(24)
        }.height('100%').width('100%')
      } else if (this.failed) {
        Column({ space: 18 }) {
          Text('暂时连不上知伴').fontSize(30).fontWeight(FontWeight.Bold)
          Text('请检查网络，或让家人核对服务地址。').fontSize(21)
          Button('再试一次').width('100%').height(56).fontSize(22).backgroundColor('#813847')
            .onClick(() => { this.failed = false; })
          Button('查看服务地址').width('100%').height(56).fontSize(20)
            .backgroundColor('#EEE6E1').fontColor('#34272D').onClick(() => this.editAddress())
        }.constraintSize({ maxWidth: 580 }).width('100%').padding(24)
      } else {
        Web({ src: this.origin + '/', controller: this.controller })
          .width('100%').height('100%')
          .javaScriptAccess(true).domStorageAccess(true).fileAccess(false)
          .mixedMode(MixedMode.None).multiWindowAccess(false).geolocationAccess(false)
          .mediaPlayGestureAccess(false)
          .onControllerAttached(() => this.registerBridge())
          .onLoadIntercept((event) => {
            if (!event) return true;
            return !event.data.isMainFrame() || httpsOrigin(event.data.getRequestUrl()) !== this.origin;
          })
          .onOverrideUrlLoading((request: WebResourceRequest) => {
            return !request.isMainFrame() || httpsOrigin(request.getRequestUrl()) !== this.origin;
          })
          .onInterceptRequest((event) => event ? this.intercept(event.request) : null)
          .onPageEnd((event) => {
            if (event && httpsOrigin(event.url) === this.origin && this.trustedPage()) {
              this.controller.runJavaScript(WEB_REMINDER_ADAPTER).catch(() => {});
            }
          })
          .onShowFileSelector((event) => {
            if (event) this.selectPhoto(event.result);
            return true;
          })
          .onPermissionRequest((event) => { if (event) this.microphone(event.request); })
          .onErrorReceive((event) => {
            if (event && event.request.isMainFrame() && event.error.getErrorCode() !== -3) {
              this.failed = true;
            }
          })
          .onHttpErrorReceive((event) => { if (event && event.request.isMainFrame()) this.failed = true; })
          .onDisAppear(() => this.detach())
      }
    }.width('100%').height('100%').justifyContent(FlexAlign.Center).backgroundColor('#FAF8F4')
  }
}
