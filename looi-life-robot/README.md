# LOOI DF26 Web / 网页端

完整中英双语说明与各端仓库链接见 [仓库首页 / Repository guide](../README.md)。

Web **1.3.0**：四页面、场景与 Life Engine、离线唤醒及响应式适配见 [功能和部署说明](docs/web-1.3.0/README.md)、[手机验收表](docs/web-1.3.0/PHONE-ACCEPTANCE.md)。模型和运行库随后端部署，浏览器按需下载并本地推理。

## 简体中文

使用 Node.js 22 或更新版本，在 `backend` 目录执行 `npm ci` 和 `npm start`，打开 `http://localhost:3000`。首次页面即可进入设备管理，无需先打开摄像头或 AI。

- 四个页面为机器人、人格、视觉、设置，中央播放开始陪伴；语言在设置页。陪伴控制层显示时，停止按钮位于右上角。
- BLE 连接需要支持 Web Bluetooth 的浏览器。Wi-Fi 连接使用本机桥接，输入 ESP 的局域网 IP 和设备管理密码即可。
- 配网、电机校准、短时点动、停止、本地文件和在线 OTA 均在设备管理中；所有方向设置保存在 ESP。
- 初始固件与 USB 安装说明已迁移到 [Firmware 仓库](https://github.com/xlle-er/LOOI-DF26-Firmware)。本分支不再包含旧 ESP32 固件及刷写清单。
- 默认同源后端，不连接原部署的远程服务。按需在 `backend/.env` 设置 AI 服务，参考 `.env.example`；不要提交密钥。
- 浏览器语音、视频、动画和动作安全队列沿用原程序。诊断页提供状态及日志，摄像头与麦克风须由用户授权。

测试：

```sh
node --test tests/*.test.js
cd backend
npm run smoke:esp32
npm run smoke:calibration
npm run smoke:tools
```

## English

Use Node.js 22 or newer. Run `npm ci` and `npm start` inside `backend`, then open `http://localhost:3000`. Device management is accessible from the initial page without starting camera or AI.

Web 1.3.0 provides Robot, Personality, Vision and Settings pages, with a central companionship action. Language is in Settings. The upper-right stop button appears with the companion control layer. BLE requires a browser with Web Bluetooth support. Wi-Fi uses the localhost bridge and a private IPv4 device address. Configure networks, calibrate motor direction, run bounded tests, stop motion and install local or online firmware from Device management. Persistent settings live on the ESP.

Firmware and USB installation instructions now live in the [Firmware repository](https://github.com/xlle-er/LOOI-DF26-Firmware). This branch removes legacy ESP32 firmware images and flashing manifests. The runtime uses its local backend by default; configure AI providers in an untracked `backend/.env` using `.env.example`. Do not commit credentials.

Voice, camera, animation and the motion safety queue preserve the existing runtime. Hardware operations require explicit user actions; camera and microphone require browser permission. See the commands above for focused protocol and regression tests.
