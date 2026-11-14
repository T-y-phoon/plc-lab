# 启保停与过载：网页虚拟被控对象（首个联调试点）

## 已提供什么

- web/：可下载到实体S7-1200/1500内置Web服务器的轻量页面。
- plc/：通信DB、断线看门狗、学生FB模板、分开的教师参考FB和OB1调用片段。
- 公开网页只提供界面验证；不会连接普通PLCSIM V18，也不会把网页演示标成PLC联调。
- 此包未在TIA V18中编译或在实体CPU上验收。先由教师在独立教学工程中完成下列配置和验收，再发给学生。

## 一、运行关系

网页按钮/热继电器 → DB_StartPlant → 学生PLC程序 → DB_StartPlant.MotorCommand → 网页电机。

网页不执行自保持，不替PLC屏蔽错误输出。若停止按下后学生程序仍给MotorCommand=1，电机仍显示运行并提示检查程序。

全部通信变量在专用DB中，不向物理输入区或真实接触器Q输出写值。第一轮联调只连接虚拟对象。

| 变量 | 类型 | 写入方 | 语义 |
|---|---|---|---|
| Start | BOOL | 网页 | 启动按住1，松开0 |
| StopOK | BOOL | 网页 | 停止未按下1，按下0 |
| OverloadOK | BOOL | 网页 | 正常1，过载0 |
| FrameId | UINT | 网页 | 输入帧编号，自动维护 |
| MotorCommand | BOOL | 学生PLC程序 | 唯一电机命令 |
| Ack | UINT | PLC周期末辅助FC | 当前输入已经过PLC扫描 |
| LinkOK | BOOL | PLC辅助FB | 实体AWP为2秒；课后桥设6秒 |

短按的按下帧和释放帧排队发送，按下帧得到PLC确认后才发送释放帧。CPU STOP、缺少周期末确认或写权限不足均不显示为正常在线。浏览器断线时动画显示反馈未知；PLC侧参考程序利用LinkOK撤销运行。自行编写的程序也须使用LinkOK；网页无法保证错误程序已停机。

## 二、教师一次配置：实体PLC，无需通信桥

适用前提：CPU/固件在TIA V18中提供“Web服务器→用户自定义网页”及WWW指令。先核对具体CPU型号和固件；不是所有产品代际都提供相同Web功能。

1. 建立独立教学工程或复制原工程，在对应CPU的“外部源文件”添加01_DB_StartPlant.scl、02_Link.scl、03_Student.scl并生成块。教师试通时再单独导入04_Reference.scl。对目标CPU编译并处理报错。文件为源码，不是已经编译的.ap18工程。
2. 按plc/OB1调用片段.txt加入WWW、通信FB、学生FB和周期末确认FC。教师验证时把学生实例替换为参考实例；同一时间只能有一个控制块写MotorCommand。
3. CPU属性启用Web服务器，使用HTTPS；创建教学账号并只授予所需的变量读写权限。不要把CPU暴露到公网，不需要启用PUT/GET。
4. 在“用户自定义网页”中选择web文件夹，应用名称填写start-stop，默认页index.html；动态内容扩展名包含.htm（io.htm是动态变量交换页）。点击生成Web块，核对实际Web控制DB号，再接到WWW的CTRL_DB。不要覆盖已有DB编号。
5. 编译、下载硬件及程序，CPU置RUN。浏览器访问CPU标准Web页，信任教师确认的证书并登录。打开“用户自定义网页”中的start-stop入口，通常为https://CPU地址/awp/start-stop/index.html。
6. 页面必须从CPU打开，而不是从GitHub Pages或file://打开。点击“连接当前PLC”；通信先发送一次停止状态，再允许操作。若仍显示未知，检查CPU RUN、WWW调用、FC_StartPlantAck顺序、Web账号写权限、变量Web可访问性及io.htm动态扩展名。

不要另开两个浏览器页面同时控制同一DB；第一轮每个CPU同时只进行一个学生实验。若采用多学生共用CPU，需另行设计每人独立DB/程序实例，此试点不包含多租户调度。

## 三、学生课堂操作

教师提供已配置的CPU网页地址与教学账号。学生只需浏览器与TIA。

1. 在FB_StudentStartStop中完成启动沿、自保持、停止/过载优先与断线停机；下载学生程序。
2. 在CPU网页登录，进入被控对象，点击连接。
3. 按下/松开启动，检查保持。按下停止，再松开，检查不会自动重启。
4. 重新启动后模拟过载；恢复正常仍不得自动重启。
5. 持续按住启动时触发停止或过载，解除后检查必须松开并重按才能重启。
6. 点击“停止请求并断开”。页面报告PLC确认后断开；若仍返回MotorCommand=1，需修正PLC程序。

记录每一步的输入、预期MotorCommand、实际MotorCommand；用TIA监控定位自己的程序错误，不以动画转动一次作为验收。

## 四、课后普通PLCSIM V18 + WinCC Advanced V18

使用包内wincc-advanced文件夹：Windows自带PowerShell本地小桥 + WinCC RT Advanced仿真 + 普通PLCSIM。学生操作端仍为浏览器，但需要双击启动本地桥，不能称为纯浏览器直连。

教师先按wincc-advanced/课后配置.md配置10个外部HMI变量与Lab_Tick值更改事件，制作课堂模板。小桥不安装软件、不读写物理I/Q，协议与实体PLC页面一致；当前开发环境没有Windows/TIA，首次Windows联调仍待完成。

## 五、验证状态与官方依据

已自动验证：输入只写白名单、PLC确认后再消费反馈、帧编号回绕、权限错误、前端不执行控制逻辑、错误PLC输出不被前端掩盖、断线显示未知、鼠标/键盘按下与释放。测试使用协议替身，不是TIA或PLC验收；Windows桥也未在开发机执行。

尚需教师验证：具体CPU/固件Web功能、SCL导入编译、Web用户权限、AWP实际替换、CPU RUN/STOP、正常启停与过载、快速短按、浏览器关闭后2秒停机。未完成这些验收前不声称可直接批量用于课堂。

官方文档：
- S7-PLCSIM产品通信差异：https://docs.tia.siemens.cloud/r/simatic_s7_1500_et_200mp_manual_collection_enus_21/comprehensive-information/cpu-function-manuals/s7-plcsim-advanced/product-overview/s7-plcsim-products
- S7-1200用户自定义网页与WWW：https://support.industry.siemens.com/cs/attachments/58862931/58862931_S7-1200_Webserver_DOKU_v10_en.pdf
- AWP变量写入：https://docs.tia.siemens.cloud/r/en-us/v21/configuring-automation-systems/configuring-the-web-server-s7-300-s7-400-s7-1500/creating-and-loading-user-pages-s7-300-s7-400-s7-1500/awp-commands-for-controlling-web-pages-s7-300-s7-400-s7-1500/writing-tags-s7-300-s7-400-s7-1500
- Unified与PLCSIM配置（2023年文档）：https://cache.industry.siemens.com/dl/files/884/109818884/att_1137501/v1/GettingStartedWCCUenUS_en-US.pdf
