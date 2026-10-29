AIGCPanel 服务端 · 本地试用包
================================

这是给本地试用准备的服务端（账号、额度、支付、云端模型、管理后台），自带 Node，无需另外安装。

一、首次使用
1. 解压到任意目录（路径里最好不要有空格）。
2. Windows：双击「创建管理员.bat」，按提示输入邮箱和密码。
   macOS / Linux：在终端运行 ./create-admin.sh
3. Windows：双击「启动服务端.bat」（窗口不要关，关掉即停止服务）。
   macOS / Linux：运行 ./start.sh
4. 浏览器打开 http://127.0.0.1:3100/admin/ ，用管理员账号登录管理后台。

二、和桌面端一起用
桌面端默认连接 http://127.0.0.1:3100 ，先启动服务端，再打开桌面端，点左上角头像登录或注册。

三、本地试用的默认设置（见启动脚本里的环境变量）
- PAYMENT_MOCK=1      充值走“模拟支付”页面，点一下就到账，不会真的扣钱
- MOCK_PROVIDER=1     可以在后台添加供应商为 mock 的云端模型，不需要真实的 API Key
- REQUIRE_EMAIL_CODE=0  注册不强制邮件验证码（没有配置发信邮箱）。
                      找回密码的验证码会打印在服务端窗口里
- 数据保存在 data 目录（数据库 app.db 和生成的文件），删除 data 目录即可重置

四、在后台添加一个模型试一下
1. 管理后台 → 云端模型 → 新增模型
2. 名称填 CloudCopyDemo，供应商选 mock，功能定义填：{"textGen": {"param": []}}
   计价规则填：{"type": "per_call", "amount": 50}
3. 管理后台 → 用户 → 给自己调额（例如 +10000）
4. 桌面端 → 工具 → 营销创作 → 电商文案，选这个模型生成（mock 模型只会回显提示词）

接真实模型：供应商选 openai-chat（文本）、openai-image（文生图）、
openai-tts（语音合成，调 /audio/speech）或 openai-asr（语音识别，调 /audio/transcriptions），
供应商配置填 {"baseUrl": "https://你的接口地址/v1", "apiKey": "你的密钥", "model": "模型名"}
  baseUrl 填到 /v1 为止（填成 .../v1/chat/completions 也能自动识别）
  例：硅基流动 {"baseUrl": "https://api.siliconflow.cn/v1", "apiKey": "sk-...", "model": "Qwen/Qwen3-8B",
               "extraBody": {"enable_thinking": false}}
  extraBody 会原样带给上游，Qwen3 等思考模型建议关闭思考，否则回答慢且可能被截断
  文生图（硅基流动 Kolors）：{"baseUrl": "https://api.siliconflow.cn/v1", "apiKey": "sk-...", "model": "Kwai-Kolors/Kolors"}
  地址含 siliconflow 时自动按硅基流动的格式请求（image_size、images[]），其他厂商按 OpenAI 格式

语音合成示例（桌面端 → 数字人 → 语音音色 → 新增，模型选这个，再到「语音合成」使用）：
  功能定义：{"soundTts": {"param": [{"name": "speaker", "type": "select", "title": "音色",
            "defaultValue": "alloy", "options": [{"label": "Alloy", "value": "alloy"}, {"label": "Nova", "value": "nova"}]}]}}
  供应商配置可加 "voice"（默认音色）、"format"（mp3 或 wav）
  计价：按次 {"type": "per_call", "amount": 20}，或按字 {"type": "per_unit", "unit": "char", "amount": 1}
语音识别示例（桌面端 → 工具 → 语音识别）：
  功能定义：{"asr": {"param": []}}
  供应商配置可加 "language"（如 zh）；上游不支持分段时间轴时加 "responseFormat": "json"
  计价：按分钟 {"type": "per_unit", "unit": "minute", "amount": 10}（按上游返回的实际时长结算）
  桌面端会先把音频/视频转成 16kHz 单声道 mp3 再上传，单次最长约 40 分钟

五、端口被占用
修改启动脚本里的 PORT，同时桌面端需要连接同一个地址（当前版本固定为 3100，建议先保持 3100）。

六、版本号
- 服务端：启动窗口里打印「服务端版本：r<序号>-<提交>」，管理后台左上角标题也会显示
- 桌面端：标题栏「电商版 r<序号>-<提交>」
- 序号对应 GitHub Actions 的运行序号（Artifacts 名称末尾的 -r<序号>），两端序号一致说明来自同一次构建
- 桌面端名为「AigcPanel电商版」，数据目录与官方 AigcPanel 分开，两者可以同时安装
