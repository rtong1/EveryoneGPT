# 知伴 · 鸿蒙客户端

适用于 HarmonyOS NEXT / HarmonyOS 5 及以上的手机和平板，最低 API 12。客户端从家人配置的 HTTPS 网址加载网页，系统相册负责选照片，ArkWeb 负责麦克风采集、回答播放和本机健康记录。运行中的服务器同时提供页面和 API。

## 安装和连接

1. 先按照项目根目录的说明部署知伴，让手机浏览器能通过具有有效证书的 HTTPS 网址打开它。该地址应指向知伴网站首页，站点资源和模型代理均使用同一域名和端口。
2. 在 DevEco Studio 中打开整个 `harmony` 目录，安装和该工程匹配的 HarmonyOS SDK（工程配置为 5.0.0 / API 12），执行 Sync Project。需要使用自己的发布身份时，修改 `AppScope/app.json5` 的 `bundleName`。
3. 在 Project Structure 的 Signing Configs 为自己的设备配置调试签名。连接已开启开发者模式的鸿蒙手机，选择 `entry` 后点击 Run。制作发布包时改用开发者自己的发布签名。安装了 DevEco 命令行工具并配置好签名后，也可以在本目录运行以下命令。

   ```sh
   hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
   ```

4. 第一次打开，在“接入知伴”填写服务地址并保存。以后直接进入聊天。访问不到服务时可重试或查看地址。在首页按系统返回键也可以选择“服务地址设置”。普通 HTTP、带账号密码或带路径的地址会被拒绝。
5. 第一次点说话时同意麦克风授权。点图片入口后，可在系统选择器中选一张图片；支持相机入口的设备还可以就地拍照。聊天用的 Key 在网页设置中填写，或由自建服务管理，鸿蒙原生设置仅保存网站地址与通知状态。

## 关闭应用后的回访

手机通知由用户在健康记录中单独开启。客户端只向系统提交最早一次回访的时间；处理、推迟、删除记录和停止回访后会重新安排。提醒正文为“您约好的回访时间到了，点这里看看。”，不包含姓名、症状或测量值。相同的到期事项只通知一次。关掉系统提醒会撤销已排期的提醒。

分发带系统提醒的版本时，按华为流程在 AppGallery Connect 为本应用申请“代理提醒”，获批后生成包含此能力的 Profile 并手动签名，同时在手机上允许通知。普通调试签名下可先验证打开应用时的回访。如果发手机通知失败，界面会提示结果。华为说明新申请的权限推荐在 HarmonyOS 6.0（API 20）及以上验证，模拟器也从 API 20 开始支持这项能力。

## 上机验收

- 用手机的大陆网络打开自建站点，再用客户端只发一张图，检查图片内容和回复是否对应。
- 在系统里拒绝麦克风，再回到应用输入文字；恢复权限后，测录音、回答朗读和再次说话。
- 先问“血压一般多少”，再主动报告本人测量值；同意保存后重启，核对记录、到期事项和删除。
- 对已开通代理提醒的签名包，验证通知允许/拒绝、锁屏时到期、点通知回到应用、推迟或删除后旧通知撤销。打开未授权域名的链接或跨域跳转时，客户端应阻止导航。

## 华为资料

[构建 HAP](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V5/ide-command-line-building-app-V5/) · [上传图片](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/web-file-upload/) · [ArkWeb 麦克风授权](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V13/web-rtc-V13/) · [代理提醒申请与实现](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/agent-powered-reminder/) · [代理提醒的系统限制](https://developer.huawei.com/consumer/en/doc/harmonyos-references/errorcode-reminderagentmanager/)
