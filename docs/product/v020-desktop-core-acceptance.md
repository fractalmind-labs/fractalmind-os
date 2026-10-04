# v0.2.0 桌面安装版核心流程验收

状态：**v0.2.0 收敛范围内的桌面安装版验收通过**。实际 macOS r15 App 完成 Host 历史恢复、邀请、Agent 观察导入、明确交接、受限执行、原证据解密、独立 KR 验证及最终 Human 验收；云 Host 使用正式 envd CLI 兑换邀请入组。独立公开链读和云文件核对见[完整证据](evidence/v020-desktop-core-installed.json)。范围依据 #40／#38；五平台生产发行等后续范围另列。

## 已验证结果

| 检查 | 实际结果 |
| --- | --- |
| OKR | ACHIEVED，version 8／agreement 5／spec 4，KR 1/1 已验证 |
| 原 Run | `0x41db7d62cdb0e7b8b7b63627558c156ccab6cda2ed995bfe590702e1fe07ad63`，SUCCEEDED；OKR 执行目录仅此一个 Run |
| 预算 | OKR 与 Capability 均已用 3／预留 0，两级 claim 已结算；claim 中保留的原预留 3 不是当前未结额度 |
| 工作区文件 | `docs/DESKTOP-CORE.md`，精确 80 字节，无其他文件；SHA-256 `a9708edbceee0608a3afa3dd1154667d7962e89b0f8390c64189b271ac53efab` 与批准正文及 App 解密证据一致 |
| 人工验收 | 原 KR 证据先解密并与独立文件核对，再明确确认费用／签名；最后验收将 agreement 4 推进到 5 |
| 复核方式 | 2026-10-04 02:57:54 UTC 独立 fresh gRPC 读取；没有 native 密钥访问、签名或广播 |

运行仍限于 `docs`、3 次工具调用，禁止 `shell.*`、`network.*` 和项目外写入。原自然语言禁止项被适配器正确拒绝，通过正式规格编辑改成支持的约束后才交接。第一次导入 prepare 的 read_unavailable 未提交；同 attempt 后续成功，失败记录保留。

新 Host 的正式 CLI 入组交易 `FKan8PdYTr3xbvx7YHjrJhXU3zsQdw71A9kuwnmSiFaY` 确认，实付 **11,589,372 MIST**。独立链读确认邀请码一次消费、成员有效、仅授予 observation 权限；后续执行仍经过单独交接审批。

## 当前完整交易回执

下列 7 笔在独立 CLI／SDK 只读复核中均返回成功完整回执，费用依据 effects 实际计算。

| 操作 | 原交易 | 实际 Gas（MIST） |
| --- | --- | ---: |
| 观察导入 | `FefqSSJk2rc9DxCGAwoUznJj74st8HGec46BUu4L7ZcW` | 11,883,736 |
| 规格修订 | `5coGZYHswajEmFXaoEBEUmeFo3HmCRsNTJ14HJ8cty3z` | 10,583,752 |
| 保存审阅请求 | `HSnSkWADXkAnCTYtjeZDciNFVHD7ka3YaWhF2kLN9z6z` | 59,158,868 |
| 批准约定 | `Bu8EwTTBNPHrEbz4GmR9yGN4YQSKEHt9EDZJm4FkhdRm` | 48,661,424 |
| Host 发布执行证据 | `4RTnk31bzFEAajifV4h5YDqNBNA2Zs2vYA1KTaW47hs6` | 18,943,980 |
| KR 独立验证 | `BVKB7RgLvrNYL45f5YCz4aVbXBJx2VfAYSFSp37Aqjkw` | 16,982,724 |
| 最终 Human 验收 | `6EU2mgkZUGywx1fmVYehRE1daGM581J9uHDVCkU4bES7` | 10,731,572 |

原 Run 在界面依次显示 queued、running、succeeded；等待时查询原 Run，没有新建替代 Run。界面的“无链上投递记录”对应该次经 Coordinator 的直接派发，不能解释为没有执行。云报告命令计数为 2，OKR 执行目录为 1 个 Run；两者统计范围不同。

## 构建与边界

安装 r15 二进制 SHA-256 为 `e8bee4f13a3553b64e0cf9dc6a83de97fd4fa1c4048ee921931bbe670de88683`，严格验签通过。证据保存该版本 UI、独立读取脚本、链／文件报告哈希，以及后续源码提交 `4063bb05bfd1b7b10b5a0ae7af40ad48ee39d7f1` 的 24 个变更文件 SHA-256。该源码 App 375/375、38/38 CI 通过；后续恢复结果保留修复的安装实测单独验收，不追溯算作 r15 已覆盖。

## 桌面零工具状态消息

实际安装 UI 又完成 status-only、工具预算 0 的独立消息。原 Run `0x143c8b0a0ff07ff58032476bf31b2631265db1bc69cf27f5d23da863e239c7f6` 为 SUCCEEDED；App 解密原 Host 回执，显示 `ok: true`、`duplicate: false`、实例 idle。原 delivery unknown 仍显示，后续只查询原 Run，没有重发。

03:04:58 UTC 独立 fresh 链读确认常驻权限仅 `status`，spent／reserved **0／0**、claim 已结算、Capability **0／0**，原 OKR 仍 **3／0**。云独立文件核对从状态命令在途到成功后：计数 **3→3**，仍只有原 80 字节文件，哈希与 mtime 全相同；成功后又逐字节核对批准正文一致。前置快照发生在该消息已在途时，不将它表述为派发前。

## r16 正式恢复与最终读取

r16 从源码 `4063bb05bfd1b7b10b5a0ae7af40ad48ee39d7f1` 构建并严格验签通过。正式恢复交易 `2bsi3pu18YpDuBgwqgwAcFji7AFjDdMZYDKNsfGhngtC` 在提交后及刷新后都显示 confirmed，实付 **22,067,736 MIST**；同 Human／组织保持，generation／recovery version 为 **5／5**。fresh gRPC 独立核验当前身份、唯一当前代次新设备、原交易关联及原 ACHIEVED／1/1／3／0 均通过。

后续完整回执查询精确返回 **NOT_FOUND**，因此该笔实际费用证据为原安装 UI 的确认回执；当前对象关联不能替代独立完整回执。该现场没有重现 unknown 或查询告警，375 项测试中的 5 项回归覆盖故障保留分支，不宣称现场注入了故障。

恢复后的新 profile 可解密原状态消息及 Host 回执，同原 Run／command、Succeeded、0 工具且已结算。原常驻权限如实显示 Expired，没有新增权限、消息或命令。最终工作台显示 Human accepted、KR 1/1、预算 3＋0／3；过期测量及 Host 连通性保持 unknown，不作为当前有效执行权限或实时在线的证明。

范围内安装版验收已通过；旧恢复、失败和缓存证明均保留。[PR 当前 head 的检查](https://github.com/fractalmind-labs/fractalmind-os/pull/53/checks)决定最终提交状态，记录中的 38/38 CI 仅对应注明的源码提交。
