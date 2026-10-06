# v0.2.0：Host 重新接入与已有实例连续性验收

依据 PRD v0.11 与 `fractalmind-app-prototype-v2`，补齐[已有实例显式重新关联](v020-agent-rebind.md)中的真实成员更换场景。本轮扩展验收辅助程序及脚本；生产 App、Go 运行时与合约沿用现有实现。完整 v0.2.0 尚未完成。

## 实际链路

1. App 在真实 localnet 创建限时单次邀请，Go Host 兑换并保存原摘要。真实 Coordinator 双向认证，同一个实际 tmux pane 经过原生进程扫描和 Host 签名后，由 App 仅观察导入。
2. App 撤销成员资格。原 worker 心跳及 Coordinator 路由被当前链指针校验拒绝；连接断开。保留 worker、Host 签名／加密钥和 tmux 进程，等待显式新邀请。
3. App 明确创建重新接入的邀请。Go CLI 管线先查询已知原摘要，再归档旧技术 journal，确认组织与费用后签署新交易。新响应故意丢失，重建 runner 只查询新原摘要；两次接入合计两次广播。
4. 同一个运行中的 worker 重读当前链指针，重新认证并发送新扫描。新成员 ID 与旧成员不同，Host 地址、密钥与原生实例 ID 保持一致。Node 脚本独立读取磁盘旧归档／新 pending，核对各自的原摘要。
5. 旧心跳签名在时间上仍然有效，但因成员替换被 App 拒绝；撤销前准备的设备读取挑战也被真实 HTTP 服务拒绝。新的签名读取返回当前成员及同一个真实内核实例，不能由旧挑战或历史快照恢复信任。
6. 普通导入遇到旧成员登记返回冲突。App 审阅原记录版本后显式重新关联，保留记录 ID、实例 ID 和工作区指纹，更新成员并推进版本。运行时保持 `tmux-observe`、`control_confirmed=false`，没有授予执行权限或自动继续 OKR。

邀请码只通过辅助进程 stdin 输入，等待公开就绪标记后发送；没有放入 argv、日志或报告。业务关系只写 Sui，扫描与挑战留在内存，磁盘只保存技术摘要 journal。

## 证据

- [重新接入实际链报告](evidence/v020-host-rejoin-localnet.json)：**19 项检查、15 笔确认交易**，包括同一 worker／Host 钥／tmux 实例、新资格认证、旧挑战和仍未过期的旧签名拒绝、摘要归档及显式重新关联。最终登记版本为 2。
- [关闭重新接入场景的原流程回归](evidence/v020-host-rejoin-regression-localnet.json)：**16 项检查、12 笔确认交易**。验证辅助程序的新扫描及可选阶段没有破坏原接入、导入、撤销和原摘要恢复流程。
- [类型与 Go race 验证](evidence/v020-host-rejoin-validation.json)：App 链脚本类型检查、Go 六包 race 通过，记录来源及辅助二进制摘要。本轮没有修改生产 UI，不增加浏览器展示或安装验收的结论。

报告使用独立组织、Host 和测试设备；并非重发早期未知摘要。之前保留的[未知交易记录](evidence/v020-agent-rebind-prior-unknown.json)继续保持未知，后续通过的夹具不能推断它已失败或完成。

## 重现

保留运行中的 localnet／faucet，提供包含 `rebind_agent_at_version` 的隔离部署。先在 `runtime/fractalmind-envd` 构建辅助二进制：

```sh
go test -c -o /tmp/fm-envd-host-rejoin-tests ./cmd/envd
go test -race ./cmd/envd ./internal/hostjoin ./internal/ws ./internal/coordinator ./internal/nodecommand ./internal/agent
```

随后在 `apps/fractalmind-app` 执行；每个独立夹具使用新的报告路径：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-host-rejoin-tests \
FM_ENVD_CHAIN_CONNECTION=1 FM_ENVD_AGENT_DISCOVERY=1 \
FM_ENVD_AGENT_IMPORT=1 FM_ENVD_HOST_REJOIN=1 \
node --import tsx scripts/host-admission-localnet.ts DEPLOYMENT.json NEW_REPORT.json
```

回归将 `FM_ENVD_HOST_REJOIN` 改为 `0`，使用另一个新报告路径。结果未知时保留原摘要，不能通过重复启动同一业务尝试规避恢复要求。

## 尚未验收

真实 Sui、socket、HTTP、签名与 tmux／内核实例均参与了本次验证；设备和 Host 钥仍由测试辅助程序注入，App 使用内存技术 journal。Go 的磁盘恢复为同进程重建 runner，不能证明正式 NativeStore、进程重启或安装后的完整 UI。

云 TLS Host、五平台安装验收、身份全旅程、可控适配器安全交接、旧执行停止／检查点、ACTIVE OKR 授权、直接对话／介入与持续自主验证闭环仍需完成。现有原生 App 的系统密钥库授权仍待用户处理，未通过重启或替代存储绕过。完整目标范围保持不变。
