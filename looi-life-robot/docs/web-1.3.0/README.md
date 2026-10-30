# Web 1.3.0 本地验收版

本次只更新 Web DF26。用户已授权在最终自动核验通过后直接推送 DF26。推送与部署状态以交付目录发布记录为准；真实手机项目独立记录，不创建额外 Release。

## 已实现

| 部分 | 入口与行为 |
|---|---|
| 响应式界面 | 机器人、人格、视觉、设置；手机底栏、中屏和桌面侧栏、短横屏紧凑侧栏；中央播放为操作 |
| 陪伴 | 隐藏配置页面；原始眼睛；点按唤出控制层；右上角停止仅随控制层显示；输入聚焦期间保留控件 |
| 机器人 | 保留 BLE/LAN、别名与设备管理、方向校准、配网和 OTA；遥控弹层支持按住、摇杆及失焦停止 |
| 人格 | 身份、八项人格、行为和语言风格；保存、重置；严格人格 JSON 和跨端通用陪伴 JSON；失败不覆盖 |
| 通用配置 | schemaVersion=1，profile/behavior/idle/wake，与两移动端默认配置往返一致；安全边界强制开启 |
| Web 备份 | 与通用配置区分；包括高级本地参数，排除服务密钥、设备凭据及设备标识；导入前完整校验 |
| 行为 | 唯一自动入口；6 表情、11 身体场景；权重、冷却、状态和倍率；身体待机默认关闭 |
| Web 高级参数 | 保留旧调参和单次测试；可选高级间隔覆盖通用间隔；平衡/反向混合参数影响下一场景配对，仍受冷却及运动许可限制 |
| Life Engine | 保留原实现，改为单调时间差；后台暂停、不补算衰减；每次新陪伴重置；不以检测框推断距离/障碍/身份 |
| 主动 AI | 思考/表达独立且默认关闭；默认 2 次/分钟、串行；表达至少 60 秒；仅允许白名单场景建议，过期结果丢弃 |
| 本地检测 | MediaPipe Tasks Vision 0.10.32，EfficientDet-Lite0 int8；Worker、单任务、最高 10 Hz，默认关闭 |
| 实验跟随 | 明确选目标和参考面积；14% 横向阈值，面积比 0.8/0.95 滞回，150 ms 脉冲，300 ms 过期取消；不自动倒车、换目标或恢复 |
| 离线唤醒 | sherpa-onnx 2.0.0 单线程 SIMD WASM；中英预设；共享 AudioWorklet 16 kHz 采集；默认关闭，仅 Gemini Live |
| 唤醒交接 | 等待无 Live/音视频上行；约 1 秒预录、连接缓冲最多 8 秒；Live 确认准备后一次顺序交接；溢出整段清空并提示重说 |
| 错误恢复 | 组件失败保留陪伴，显示原因和重试；后台/中断立即停止媒体，恢复需明确操作 |
| 模型与运行库 | **随后端部署**；按需下载、SHA-256 校验、Cache API 缓存、取消、释放和清理；推理仍在浏览器 |
| PWA | 新资源完整校验后等待用户；确认后先停止再更新；缓存界面和已下载本地能力可离线，云端 AI 不可离线 |
| 诊断 | 500 事件、100 决策、最多每秒更新；场景、唤醒、缓冲、跟随、运动来源及播放队列；脱敏导出 |

## 本地启动

需要 Node.js 22 或以上。在 `looi-life-robot/`：

```sh
npm ci
npm --prefix backend ci
npm test
npm run check
npm run build
PORT=3163 npm start
```

桌面预览：`http://localhost:3163`。本次生成的截图、预览副本、自动结果和校验位于项目根 `output/web/1.3.0/`。

手机麦克风、相机与 Web Bluetooth 需要受信任 HTTPS 等浏览器条件。普通局域网 HTTP 不能代替 HTTPS 验收；当前没有创建公网预览或生产部署。

## 资源构建与部署

- 前端：`frontend/`，继续由 Netlify 静态托管；保留既有眼睛与模块结构。
- 后端：原 Node 服务及 `backend/local-resources/`，模型/运行库/许可一起部署。
- 下载清单：`GET /api/local-models/manifest.json`；资源：`GET /api/local-models/models/...`、`vendor/...`、`licenses/...`。
- 前端通过现有 `runtime-config.js` 的后端地址取资源；下载接口公开且支持 CORS，无需向浏览器交付 AI 密钥。
- 普通陪伴不预取模型。没有缓存的模型无法在离线时首次启用；已有完整缓存可在后端暂不可达时加载。
- `npm run resources` 使用已纳入仓库的资源并重建检测 Worker/哈希清单；相邻 Android 仓库存在时可同步同一份模型。没有相邻仓库也可复用当前资源。
- `bash scripts/build-wake-wasm.sh` 重新编译引擎：sherpa 源码归档校验固定，Emscripten 4.0.23 固定；在项目临时目录安装工具链，剥除本机源目录路径；不修改全局 shell 配置。
- 资源 SHA-256、引擎版本、模型组合及许可见后端资源清单。WASM 不依赖跨源隔离，不创建第二套录音器。

用户已授权自动核验通过后直接推送 DF26。生产上线仍应先部署兼容旧页面的后端及模型，核对资源下载/CORS/Live 中继，再上线前端；保留上一版前后端和资源清单用于整体回滚。推送源码本身不代表后端资源已部署。

## 自动结果与实际能力边界

自动测试的数字和浏览器版本以交付目录的 JSON 报告为准。真实模型测试采用固定合成中英文音频及 Google 示例猫狗图片；没有录制用户环境音。浏览器自动化、假机器人及假 PCM 测试不能代替真机听辨、真实车轮观察和温升验收。

当前本地后端未配置真实 Gemini/第三方 AI 密钥。云端端到端对话和真实网络环境恢复需在配置服务后的 HTTPS 验收环境验证；本次自动化不会冒充这一部分已通过。

## 参考与许可

- MediaPipe 官方 Web Object Detector：<https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js>
- sherpa 2.0.0 官方 WASM 构建：<https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.0/build-wasm-simd-kws.sh>
- 中英模型卡：<https://modelscope.cn/models/pkufool/icefall-kws-zipformer-zh-en-3M-2025-12-20>
- 固定视觉图片：<https://storage.googleapis.com/mediapipe-tasks/object_detector/cat_and_dog.jpg>
- Web Bluetooth 能力边界：<https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API>

引擎、模型和 MediaPipe 使用各自 Apache-2.0 条款，ONNX Runtime 使用 MIT；具体第三方许可和声明随 `backend/local-resources/licenses/` 提供。原始眼睛、动作与其他既有代码保留原许可。
