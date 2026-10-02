# v0.2.0 App 人工 KR 验证与最终验收

依据 PRD v0.11、原型 v2、#27/#28/#34/#37/#38；完整 v0.2.0 仍未完成。

## 交互与职责

工作台和 OKR 详情提供「验证与验收」。当前设备须有组织的 read 和 approve 权限；人工验证不要求设备有 operate 权限。

1. 原请求优先查询。没有已提交的原请求时，读取当前规格、批准约定、原成功 Run、Host 原测量和加密证据。展示成功标准、KR 验证规则、约定文件内容、约定与 Host 回报的 SHA-256；原 Run、证据记录和创建交易放在详情中。
2. 用户独立检查证据，勾选确认并填写理由，再准备费用报价。未确认、空理由、超出 4096 UTF-8 字节或伪造视图不能准备验证交易。
3. 明确确认费用和原生签名后，单独验证当前 KR。记录包含审核人／Grant、当前规格／约定、原 Run／结果及不可变创建摘要、测量／采样时间和理由；链上只推进 KR 游标，界面不投递下一条命令。
4. 全部 KR 已验证后，另行读取所有原证据与历史验证理由。用户确认整体成功标准、填写最终理由，分别报价、确认费用和签名，才将 OKR 标为 ACHIEVED。

`OkrHumanReview` 没有 Host 派发或 runner 接口。读取和报价不验证、不验收。已知原交易先查询；unknown 不隐式重提。报价只接受本控制器的原对象，同一报价并发提交合并。费用／加密／原生签名期间重新核对授权、OKR 版本／约定／游标、记录目录、政策及预算；范围关闭或状态改变拒绝广播。

测量须通过当前 Sui Clock 的新鲜度和目标阈值。所有控制执行须已结清；当前链上审批政策须与 OKR 一致。解密的历史 Host 接受签名及提案哈希与当前政策对应，但不续期 Host 审阅或赋予执行权限。当前 Human 有权读历史证据即可；人工验证不要求历史 Host 仍在线或仍获准加入。

## 历史记录与隐私

多 KR 共用逻辑验证记录的版本链。`PrivateRecords.read(pointer, true)` 从当前目录头沿不可变 previous 链找到精确旧版本，逐项验证组织、类别、逻辑 ID、连续修订和源；缺口、循环、范围替换以及解密期间授权／当前头变化均拒绝释放正文。默认读取仍只接受当前头。

私有证据、理由和报价只在内存；关闭、隐藏或卸载清除可见内容和可操作状态，使待返回的原生操作范围失效。IndexedDB 保存交易技术日志；一次性可丢弃的本地定位只含设备配置、Grant、OKR 版本／约定／游标和操作类别。没有业务正文缓存或密钥导出。

## 实际证据

- [原生 OS＋localnet＋生产 envd](evidence/v020-native-human-review-localnet.json)：**11 项检查、17 笔 App 原生确认交易／费用**。实际 Host 接入、签名发现／导入、物理审阅／审批、两个顺序 KR 的明确投递、两次独立验证及另一次最终验收通过。继续命令投递 **2 次**、工具预算 **6 已支出／0 预留**，两个 KR 均验证、游标 **2**，OKR **ACHIEVED（3）**。最终验收实际解密验证记录的不同历史版本。Host 撤销后路由／心跳拒绝、授权 Human 历史结果读取通过；harness 正常退出，测试 OS 凭据已清理。
- [专项与回归](evidence/v020-native-human-review-unit.json)：App **146/146**、生产构建和联测脚本严格类型通过。新增覆盖独立确认／理由、原视图／原报价、原未知请求优先、并发提交、证据／加密／报价／签名状态变化、窗口关闭、阈值／新鲜度以及历史链完整性／撤销检查。SDK 代码本增量未修改，前一提交回归 **128/128**。
- [真实浏览器](evidence/v020-native-human-review-browser.json)：工作台／OKR 详情入口、中文白天／英文黑夜弹窗和网页原生操作保护。未注入原生 mock，不能作为安装后正向 Human 操作证据。

测试中两个验证决定和最终成功标准确认由脚本显式提供，不是安装后人操作 UI。Human 密钥使用实际 OS 密钥库，原生传输是隔离子进程；Host 密钥为测试内存提供者，Coordinator 在 loopback，journal 为内存。没有验证实体云主机、原生窗口来源或全量缓存清空／重启；17 笔 App 费用不包含 Host 独立加入、结果和测量交易。

### 前序尝试

[前序报告](evidence/v020-native-human-review-prior.json)保留原请求，不重放、不覆盖。

- r1 在受限环境无法建立原生调用，停止在身份创建前；没有记录链上交易。不作为 OS 密钥库／清理成功证据。
- r2 完整两个 KR 与最终验收通过。随后补当前政策／原 Host 签名／提案一致性核验，用全新隔离夹具 r3 验证当前版本；r2 的原回执和对象保留原状。

## 复现

使用已有隔离 localnet 和对应部署 JSON，先构建 native `device-test-helper` 及实际 Go CLI 助手；输出必须是新路径。macOS 需要允许临时测试进程访问系统密钥库。

```sh
cd runtime/fractalmind-envd
go test -c -o /tmp/fm-envd-native-app-execution-tests ./cmd/envd
cd ../../apps/fractalmind-app
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-native-app-execution-tests \
  node --import tsx scripts/native-app-execution-localnet.ts \
  /tmp/isolated-deployment.json /tmp/new-human-sequence-report.json --human-sequence
```

省略 `--human-sequence` 保留原单 KR、等待 Human 验证的专项。未知原请求应先检查报告和原摘要。

## 剩余验收

安装后人工证据读取／确认／费用／IPC／IndexedDB 正向旅程；无需逐条人工发送的受约束自主运行、对话／暂停／调整／恢复；最小技能投影；过期／失败新尝试；完整清缓存和重启恢复；真实云 Host、桌面和手机核心旅程及迁移升级。此增量不关闭 #34 或完整目标。
