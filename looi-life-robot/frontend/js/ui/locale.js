// Text translations never modify protocol values, input values, logs or AI replies.
const entries = `
LOOI Life Robot|LOOI 桌面伙伴
code|源代码
LOOI Runtime|LOOI 伙伴
LOOI Setup|欢迎使用 LOOI
Install the ESP32 firmware, connect the body by Bluetooth, then start LOOI.|连接附近的机器人身体，或直接启动语音和视觉体验。固件刷写请使用电脑。
Upload Firmware|刷写固件
Firmware upload requires Chrome or Edge with Web Serial.|固件刷写需要电脑上的 Chrome 或 Edge。
Firmware upload requires HTTPS or localhost.|固件刷写需要 HTTPS 或本机访问。
Connect using Bluetooth|连接蓝牙身体
Connect Bluetooth|连接蓝牙
Connect|连接
Start LOOI|启动 LOOI
Stop LOOI|停止 LOOI
Download App|安装 App
Idle|待机
idle|待机
LOOI Eyes|实时画面
camera off|摄像头已关闭
Local Brain camera actions are blocked until allowed.|点击下方“开启摄像头”分享画面。
LOOI Settings|LOOI 设置
Diagnostics|设置与状态
Close|关闭
Quick Actions|常用操作
Stop|停止
Phone-Bodied Life Robot|你的桌面伙伴
Local robot runtime for voice, vision, camera, personality, and ESP32 body control.|通过语音、摄像头和蓝牙身体与你互动。
Status|状态
Body|机器人身体
Brain|AI 服务
Camera|摄像头
Move|运动
Log|运行记录
ESP32 connection|蓝牙连接
disconnected|未连接
connecting|连接中
connected|已连接
mood|心情
neutral|平静
energy|精力
boredom|无聊程度
fear|警惕程度
curiosity|好奇心
current behavior|当前行为
soft_idle|轻松待机
attention target|关注对象
none|无
obstacle|障碍物
false|否
true|是
listening|聆听中
speaking|说话中
Life Engine|自主行为
Local instincts only: mood, attention, drives, face, and safe body language. No cloud or external AI calls are active.|管理心情、注意力、表情和身体动作；AI 对话由你选择的服务提供。
Pause Life Engine|暂停自主行为
Resume Life Engine|恢复自主行为
Personality|性格
Personality changes local body behavior and gives the Local Brain context.|调整 LOOI 的行为风格和互动偏好。
Robot name|伙伴名称
Identity|角色描述
Pronouns|称呼
Curiosity|好奇心
Gentleness|温柔程度
Playfulness|活泼程度
Shyness|害羞程度
Affection|亲近程度
Independence|独立程度
Talkativeness|健谈程度
Caution|谨慎程度
Movement softness|动作柔和度
Reaction speed|反应速度
Idle activity|待机活跃度
Emotional expressiveness|情感表现
Hesitation|犹豫程度
Personal space respect|保持距离
Save Personality|保存性格
Reset Personality|重置性格
Export Personality|导出性格
Import Personality|导入性格
No personality export yet.|尚未导出性格配置。
Life Events|互动事件
disabled|未启用
enabled|已启用
Last life event|最近互动
Enable Life Events|开启互动事件
Disable Life Events|关闭互动事件
Camera / Eyes|摄像头与视觉
The camera runs locally in the browser and feeds Agent vision.|开启摄像头后，可向已连接的 AI 分享实时画面。
Camera support|摄像头支持
checking|检查中
Camera running|摄像头状态
stopped|已停止
running|运行中
starting|启动中
supported|可用
unsupported|不支持
Facing mode|镜头方向
unknown|未知
Vision support|视觉支持
Last camera error|相机提示
Camera access may require HTTPS or localhost.|摄像头需要安全连接和访问权限。
Camera access may require user permission.|请允许摄像头访问权限。
Camera access usually requires HTTPS or localhost.|请使用 HTTPS 访问摄像头。
Camera access requires your browser permission. The Local Brain cannot request camera actions unless explicitly allowed.|摄像头由你控制；可随时在主界面关闭。
Camera Devices|镜头选择
Choose the exact phone camera used for Agent vision. Default uses camera 1 when available.|默认使用前置摄像头；也可以切换到后置镜头。
Refresh|刷新
Front camera|前置镜头
Default camera 1 / front|默认前置镜头
Agent Vision|AI 视觉
Agent keeps receiving camera frames for visual conversation.|实时语音连接后，AI 可理解你分享的摄像头画面。
Agent video interval|画面发送间隔
Agent vision state|画面共享状态
off|关闭
on|开启
Last Agent frame|最近共享画面
Live video widget size|画面预览大小
Start Front Camera|开启摄像头
Switch Camera|切换镜头
Stop Camera|关闭摄像头
Capture Snapshot|拍摄一帧
Object Vision / Follow|目标识别与跟随
Roboflow WebRTC runs only for focused object follow. It streams the camera through the server proxy and never exposes the API key in the browser.|目标跟随通过服务器处理画面，密钥保存在服务器。
Start Detector|开始识别
Stop Detector|停止识别
Roboflow workflow|识别工作流
Roboflow GPU|识别算力
Small GPU · lower cost|小型算力 · 费用较低
Medium GPU · balanced|中型算力 · 均衡
Large GPU · faster|大型算力 · 更快
Max results|最大识别数量
Category allowlist|允许识别的类别
Follow tuning preset|跟随参数预设
Detector|识别器
Model|模型
Workflow|工作流
Quality|质量
GPU plan|算力方案
Filters|筛选条件
Last run age|上次运行
Metadata objects|识别对象数量
Detector error|识别提示
Detected objects|已识别对象
No detections yet.|尚无识别结果。
Visible labels sent to Agent|已分享给 AI 的对象
Follow Target|跟随目标
Stop Following|停止跟随
Active target|当前目标
Follow scenario|跟随状态
Controller|控制器
Current errorX|水平偏差
Steering|转向
User visible|看到用户
User position|用户位置
User distance|用户距离
Face count|人脸数量
Last observation|最近画面观察
Agent / Local Brain|语音与 AI 状态
Agent handles voice. Movement still goes through the local safe tool path.|AI 负责对话和视觉，身体动作由本地运行程序管理。
Brain state|AI 状态
Adapter|连接方式
mock + rule fallback|离线演示与规则
Server status|服务状态
Provider|服务提供商
mock|模拟演示
rule|离线规则
Latency|响应时间
Last thought|最近响应
Agent|实时 AI
Agent mic|麦克风
Agent audio|语音播放
Agent output|播放详情
Agent frame|画面详情
Agent latency|实时响应时间
Last heard|最近听到
Last said|最近回复
Last tool|最近动作
Stop always works. Movement actions still go through ToolExecutor, Life Engine, SafetyGate, CommandQueue, and ESP32.|停止按钮随时可用，可立即停止当前体验和动作。
Local Motion Armed|允许身体运动
Sleep after silence (s)|安静后进入待机（秒）
Think Now|立即响应
Refresh Server Status|刷新服务状态
Recent Thoughts|最近响应
Local Event Bus|互动记录
Clear Local Events|清空互动记录
Idle Scenarios|待机动作
Local micro-movements when LOOI is live and no scenario is running.|体验运行时，LOOI 会做一些轻微的待机动作。
First min (s)|首次动作最短间隔（秒）
First max (s)|首次动作最长间隔（秒）
Silent min (s)|安静时最短间隔（秒）
Silent max (s)|安静时最长间隔（秒）
Agent min (s)|对话时最短间隔（秒）
Agent max (s)|对话时最长间隔（秒）
Balance start %|初始平衡概率（%）
Balance + %|平衡概率增量（%）
Mix chance %|混合动作概率（%）
Agent ctx min (s)|分享动作最短间隔（秒）
Agent ctx max (s)|分享动作最长间隔（秒）
Test Animations|测试表情
Robot Body|机器人身体
Safety: lift the wheels before the first movement test.|首次测试动作时，请将车轮架空。
Connect a nearby|连接附近的
LOOI Body|LOOI 身体
with the browser Bluetooth picker.|请在蓝牙选择窗口中完成连接。
Disconnect|断开连接
Ping|检查连接
Emergency Stop|紧急停止
Manual Movement Test|手动动作测试
Speed|速度
Duration|持续时间
Forward|前进
Backward|后退
Rotate Left|向左转
Rotate Right|向右转
Scenario Tests|互动场景测试
These trigger local Life Engine reactions only. External cloud is not involved.|测试本地表情和身体反应，不会请求云端模型。
Scenario: Come Here|场景：过来
Scenario: Give Me Space|场景：离远一点
Scenario: Look Around|场景：环顾四周
Scenario: Stop / Freeze|场景：停止
Scenario: Ignored / Bored|场景：无聊
Scenario: Low Energy|场景：疲倦
Scenario: Obstacle|场景：遇到障碍
Scenario: Clear Obstacle|场景：障碍消失
Face & Demo|表情演示
Send|发送
Test Happy|开心表情
Test Curious|好奇表情
Open settings|打开设置
Close settings|关闭设置
Settings and diagnostics|设置与状态
Settings sections|设置分类
LOOI setup actions|启动操作
Production controls|运行控制
LOOI quick actions|常用操作
Open LOOI source code on GitHub|查看 LOOI 源代码
LOOI idle|LOOI 待机
thinking|思考中
hearing|听到声音
playing|播放中
streaming|采集中
not configured|尚未配置
available|可用
unavailable|不可用
Agent starting|AI 启动中
Agent voice|实时语音
fallback active|使用离线规则
server adapter|服务已连接
fallback ready|离线规则已就绪
active|已启用
mic starting|麦克风启动中
mic inactive|麦克风未开启
mic standby|麦克风待命
FaceDetector supported|支持本地人脸检测
FaceDetector unavailable|未提供本地人脸检测；AI 视觉仍可使用
Starting LOOI|正在启动 LOOI
Opening LOOI face|正在准备表情
Connecting body|正在检查蓝牙身体
Starting camera|正在开启摄像头
Starting local brain|正在启动互动
Connecting Agent|正在连接实时 AI
Bluetooth body is not connected. Start LOOI anyway?|尚未连接蓝牙身体，是否直接启动？
No recent thoughts yet.|暂无响应记录。
No local events yet.|暂无互动记录。

Device management|设备管理
Language|语言
Connect to the ESP hotspot or the same LAN. Wi-Fi control uses the local bridge.|连接 ESP 热点或同一局域网。Wi-Fi 控制通过本机桥接服务。
Device IP|设备 IP
Device password|设备管理密码
Connect Wi-Fi|连接 Wi-Fi
Discover devices|发现设备
Refresh device|读取设备状态
Wi-Fi setup|设备配网
Wi-Fi name|Wi-Fi 名称
Wi-Fi password|Wi-Fi 密码
Scan Wi-Fi|扫描 Wi-Fi
Save and connect|保存并连接
Forget network|忘记网络
Motor calibration|电机方向校准
Lift the wheels first. Tests last at most 300 ms. Saving stops the motors.|先架空车轮。每次测试最多 300 毫秒，保存设置会先停车。
Invert left motor|左轮反向
Invert right motor|右轮反向
Swap motor sides|交换左右轮
Save direction|保存方向
Reset direction|恢复默认方向
Reverse forward/back|前后反了
Reverse steering|左右转向反了
Left motor +|左轮正转
Left motor −|左轮反转
Right motor +|右轮正转
Right motor −|右轮反转
Stop now|立即停止
Firmware update|固件升级
Upload uses Wi-Fi. Keep power connected and verify the version after reconnecting.|上传使用 Wi-Fi。保持供电，升级后重连核对版本。
Upload local firmware|上传本地固件
Application firmware|应用固件
Preview firmware updates|预览版更新
Preview channel releases may not have completed hardware testing. Turn off to use stable releases.|预览通道的版本可能尚未完成硬件验证。关闭后使用稳定版本。
Check for updates|检查在线版本
Install online release|安装在线版本
Exit update mode|退出升级模式
Wi-Fi connected|Wi-Fi 已连接
No devices found. Enter the device IP manually.|未发现设备，请手动输入 IP。
Connecting. Refresh device status shortly to see the IP.|正在连接，稍后读取设备状态查看 IP。
Network forgotten|已忘记网络
Direction saved|方向已保存
Test sent: 300 ms|已发送点动：300 毫秒
Stopped|已停止
Connect over Wi-Fi before uploading firmware|请先通过 Wi-Fi 连接再上传固件
Choose an application .bin|请选择应用 .bin 文件
Uploading firmware. Keep power connected.|正在上传固件，请保持供电。
Downloading and installing firmware. Keep power connected.|正在下载并安装固件，请保持供电。
Update accepted. Reconnect and verify the version.|升级已接受，请重连核对版本。
Update mode exited|已退出升级模式

Firmware downloads|固件下载
No object metadata yet.|暂无目标信息。
DELETE|删除
SAVE|保存
Local instincts only: mood, attention, drives, face, and safe body language. No cloud or external AI calls are active.|仅运行本地情绪、注意力、表情和安全的底盘动作，尚未连接外部 AI。
Camera access requires your browser permission. The Local Brain cannot request camera actions unless explicitly allowed.|使用摄像头需要浏览器授权；未经允许，本地 AI 不会发起相机操作。
Choose the exact phone camera used for Agent vision. Default uses camera 1 when available.|选择向 AI 分享画面的摄像头；默认优先选择可用的第一个镜头。
Roboflow WebRTC runs only for focused object follow. It streams the camera through the server proxy and never exposes the API key in the browser.|Roboflow WebRTC 仅用于目标跟随，视频通过服务端代理传输，密钥不会出现在浏览器中。
Roboflow follow disabled|目标跟随未启用
Roboflow follow is disabled.|目标跟随当前未启用。
Stop always works. Movement actions still go through ToolExecutor, Life Engine, SafetyGate, CommandQueue, and ESP32.|随时可以停止；所有运动仍经过动作队列与设备安全限制。
No local thoughts yet|暂无本地响应
Type a message or press Think Now.|输入消息，或点击立即思考。
No personality export yet.|尚未导出性格设置。
Soft Left Forward Twist (extended)|轻柔左前摆动（加长）
Soft Right Forward Twist (extended)|轻柔右前摆动（加长）
Soft Left Forward Twist|轻柔左前摆动
Soft Right Forward Twist|轻柔右前摆动
Tiny Left Forward Pivot|轻微左转
Tiny Right Forward Pivot|轻微右转
Tiny Forward Pulse|短暂前进
Tiny Backward Pulse|短暂后退
Tiny Forward Back|轻微前后摆动
Tiny Forward Back Slow|缓慢前后摆动
Multi Forward Back|连续前后摆动
Left|左
Right|右

Wi-Fi / Device management|Wi-Fi / 设备管理

Select an application .bin (maximum 3 MB)|请选择不超过 3 MB 的应用 .bin 文件
Robot is not connected|设备未连接
Device ACK timed out|设备响应超时
Another controller is active; explicitly take control|其他客户端正在控制，请显式接管
Control ownership lost|控制权已失效
Controls locked during update|升级期间运动已锁定
Device rejected command|设备拒绝操作
Firmware checksum mismatch|固件校验失败
Update failed|升级失败

Control center|控制中心
Control center sections|控制中心分类
Devices|设备
Companion|陪伴
AI & vision|AI 与视觉

Take control|接管控制
Control acquired|已接管控制
Current firmware requires manually leaving the hotspot after this update.|当前设备固件不支持自动关闭，本次升级后请手动断开热点。
After updating, leave the ESP hotspot and restore mobile data or internet Wi-Fi before starting AI companionship.|升级后请及时断开 ESP 热点，恢复流量或可上网的 Wi-Fi，再启动 AI 陪伴。
Close ESP hotspot after update|升级后关闭 ESP 热点
Requires device firmware support. Your phone decides whether internet reconnects automatically. Hold BOOT for 3 seconds to reopen the hotspot.|需要设备固件支持；手机是否自动恢复互联网由系统决定。长按 BOOT 3 秒可重新开启热点。
Update accepted. Leave the ESP hotspot and restore internet before AI companionship; reconnect to verify the version.|升级成功，请断开 ESP 热点并恢复互联网，再使用 AI 陪伴；重连设备核对版本。
1. While online, download and verify firmware. 2. Join the ESP hotspot. 3. Connect the device and upload the saved firmware. Keep power connected.|1. 有网时下载并校验固件。2. 连接 ESP 热点。3. 连接设备，上传已保存固件。升级期间保持供电。
For the initial hotspot-only firmware, download the .bin first, then use the device panel at http://192.168.4.1 to upload it.|初版仅热点 OTA 固件：先下载 .bin，再连接热点，通过 http://192.168.4.1 的设备面板上传。
Download firmware first|先下载固件
Upload saved firmware|上传已保存固件
Downloading and verifying firmware. Stay on an internet connection.|正在下载并校验固件，请保持互联网连接。
Firmware saved. You can now join the ESP hotspot and upload without internet.|固件已保存，可以连接 ESP 热点，无需互联网即可上传。
Uploading saved firmware. No internet connection is needed.|正在上传已保存固件，此步骤不需要互联网。
Download firmware before joining the ESP hotspot|请先在联网时下载固件，再连接 ESP 热点
Firmware size or image is invalid|固件大小或格式无效
LOOI Apps|LOOI 客户端
Choose your LOOI app|选择你的 LOOI 客户端
Bring LOOI to your phone. Choose your platform to get started.|在手机上使用 LOOI，选择你的平台开始安装。
Download the APK, then open it on your Android phone to install.|下载 APK 文件，在安卓手机上打开安装。
Android 7.0 or later|Android 7.0 及以上
Download Android APK|下载 Android 安装包
Open the iOS repository for source code and build instructions. Build and install with Xcode using your own Apple signing account.|前往 iOS 仓库获取源码和构建说明，使用 Xcode 和自己的 Apple 签名账号编译安装。
iOS 15 or later · Xcode required|iOS 15 及以上 · 需要 Xcode
Open iOS repository|打开 iOS 仓库
Back to LOOI|返回 LOOI
Android 0.2.1 · Experimental preview|Android 0.2.1 · 实验预览版
Choose a platform|选择平台
Debug robot|调试机器人
Motor tests|马达测试
Management settings|管理设置
Enter update mode|进入升级模式
Update via hotspot|改用热点升级
Download firmware|下载固件
Connect hotspot|连接热点
Install OTA update|安装 OTA 更新
Upload bin package|上传 bin 更新包
Choose local .bin|选择本地 .bin
Verify installed version|核对升级版本
Manual IP override (optional)|手动指定 IP（可选）
Robot name (Chinese supported)|机器人名字（支持中文）
Change robot name|修改机器人名字
New admin password|新管理密码
Change admin password|修改管理密码
Re-enter admin password|重新输入管理密码
Lift the wheels. Tests last at most 300 ms.|先架空车轮，点动最多 300 毫秒。
Update firmware to change the name and password.|升级固件后可修改名称和密码。
Done|完成
Save|保存
Later|稍后
Debug sections|调试分区
Connect LAN robot|连接局域网机器人
Connect robot|连接机器人
`.trim().split('\n').map(line=>line.split('|'));
const zh=new Map(entries),en=new Map(entries.map(([a,b])=>[b,a]));
let selected=localStorage.getItem('looi.ui.language')||(navigator.language.startsWith('zh')?'zh-CN':'en');
export function language(){return selected;}
export function translate(text){const original=String(text),clean=original.replace(/\s+/g,' ').trim();const target=selected==='zh-CN'?(zh.get(clean)||(clean.startsWith('Ready offline: ')?'已下载，可离线上传：'+clean.slice(15):clean)):clean;return clean?original.replace(clean,target):original;}
const textSources=new WeakMap(),textRendered=new WeakMap(),attributeSources=new WeakMap();
function localize(node){
 if(node.nodeType===Node.TEXT_NODE){
  if(node.parentElement?.closest('script,style,textarea,pre,code,.log-text,#geminiLiveInputTranscript,#geminiLiveOutputTranscript'))return;
  const input=node.data;
  const source=textRendered.get(node)===input?textSources.get(node):input;
  textSources.set(node,source);const output=translate(source);textRendered.set(node,output);
  if(output!==input)node.data=output;return;
 }
 if(node.nodeType!==Node.ELEMENT_NODE&&node.nodeType!==Node.DOCUMENT_NODE)return;
 if(node.nodeType===Node.ELEMENT_NODE){const values=attributeSources.get(node)||{};
  for(const key of ['title','aria-label','placeholder','alt'])if(node.hasAttribute(key)){const input=node.getAttribute(key),previous=values[key],source=previous?.last===input?previous.source:input,output=translate(source);values[key]={source,last:output};if(output!==input)node.setAttribute(key,output);}
  attributeSources.set(node,values);
 }
 node.childNodes.forEach(localize);
}
export function setLanguage(value){selected=value==='zh-CN'?'zh-CN':'en';localStorage.setItem('looi.ui.language',selected);document.documentElement.lang=selected;localize(document);for(const element of document.querySelectorAll('#deviceLanguage,#languageSwitch select'))element.value=selected;}
export function initializeLanguage(){
 const bar=document.createElement('label');bar.id='languageSwitch';bar.style.cssText='position:fixed;top:12px;right:16px;z-index:10000;background:#122c28;color:white;padding:8px;border-radius:10px';
 bar.textContent='语言 / Language ';const select=document.createElement('select');select.setAttribute('aria-label','Language');for(const [value,label]of [['zh-CN','简体中文'],['en','English']])select.add(new Option(label,value));select.value=selected;select.onchange=()=>setLanguage(select.value);bar.append(select);document.body.append(bar);
 setLanguage(selected);const observer=new MutationObserver(records=>{for(const record of records){if(record.type==='childList')record.addedNodes.forEach(localize);else localize(record.target);}});observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder','alt']});
}
