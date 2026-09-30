/* FractalMind App prototype v2 — demo fixtures.
 *
 * Sample content is bilingual ({ zh, en }) so it follows the interface
 * language; anything a reviewer types stays in its original language.
 * Times are relative to the seed time. Every value here is demo data.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.FM = root.FM || {}).fixtures = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const L = (zh, en) => ({ zh, en });
  const P = 'org-personal';
  const LABS = 'org-labs';

  /** Clearly marked demo recovery code for the sample identity (J9 review). */
  const DEMO_RECOVERY_BODY = 'DEM0ADA000RECVRY2026';

  function demoRecoveryCode(model) {
    return model.makeRecoveryCode(() => Uint8Array.from(DEMO_RECOVERY_BODY, ch => model.B32.indexOf(ch)), 'T');
  }

  const chainId = (model, seed) => '0x' + (model.digest(seed) + model.digest(seed + ':b') + model.digest(seed + ':c') + model.digest(seed + ':d'));

  function emptyOrgData() {
    return {
      workspaces: [], okrs: [], hosts: [], agents: [], instances: [], runs: [], tasks: [], approvals: [],
      evidence: [], memories: [], results: [], conversations: {}, invites: [], bindings: [], activity: [],
      decisions: [], receipts: [], seenHeartbeats: [], focusOkrId: null,
    };
  }

  const nav = () => ({ scenario: null, waiting: null, observation: 'ok', paused: false, pausedReason: null, blocked: null });

  function trend(now, points) {
    const n = points.length;
    return points.map((v, i) => ({ at: now - (n - 1 - i) * 2 * DAY, value: v }));
  }

  /* ------------------------------------------------------------ Personal */

  function personalData(now, model) {
    const d = emptyOrgData();
    d.focusOkrId = 'okr-alpha';

    d.bindings = [
      { id: 'bind-home', endpoint: 'coordinator.home.arpa:7443', label: L('家庭局域网', 'Home LAN'), state: 'confirmed', online: true, confirmedAt: now - 38 * DAY },
      { id: 'bind-cloud', endpoint: 'coord-fra.example.net:7443', label: L('云端 · 法兰克福', 'Cloud · Frankfurt'), state: 'confirmed', online: true, confirmedAt: now - 13 * DAY },
    ];

    d.workspaces = [
      { id: 'ws-app', name: 'fractalmind-app', path: '~/code/fractalmind-app', hostIds: ['host-mini', 'host-mbp'], access: 'read_write', importedAt: now - 30 * DAY, files: ['AGENTS.md', 'OKR.md', 'HEARTBEAT.md', 'memory/'] },
      { id: 'ws-mobile', name: 'fractalmind-mobile', path: '/srv/work/fractalmind-mobile', hostIds: ['host-build', 'host-gpu'], access: 'read_write', importedAt: now - 12 * DAY, files: ['AGENTS.md', 'OKR.md'] },
      { id: 'ws-memory', name: 'memory-index', path: '/srv/memory-index', hostIds: ['host-nas'], access: 'read_write', importedAt: now - 20 * DAY, files: ['AGENTS.md', 'memory/'] },
    ];

    const member = (via, since) => ({ state: 'active', via, since });
    const grant = (days, desktop) => ({ actions: ['execute'], desktop: !!desktop, expiresAt: now + days * DAY });
    d.hosts = [
      { id: 'host-mini', name: 'Mac mini M4', kind: 'local', location: L('家中书房', 'Home office'), os: 'macOS 15.6', arch: 'arm64', status: 'online', accepting: true, desktop: 'supported', lastHeartbeatAt: now - 20e3, cpu: 38, mem: 61, sampledAt: now - 20e3, bindingId: 'bind-home', membership: member('invite', now - 36 * DAY), grant: grant(6, true) },
      { id: 'host-mbp', name: 'MacBook Pro 14', kind: 'local', location: L('随身', 'With me'), os: 'macOS 15.6', arch: 'arm64', status: 'online', accepting: true, desktop: 'supported', lastHeartbeatAt: now - 8e3, cpu: 22, mem: 54, sampledAt: now - 8e3, bindingId: 'bind-home', isThisDevice: true, membership: member('bootstrap', now - 40 * DAY), grant: grant(6, true) },
      { id: 'host-nas', name: 'Home NAS', kind: 'local', location: L('家中机柜', 'Home rack'), os: 'Ubuntu 24.04', arch: 'x86_64', status: 'offline', accepting: true, desktop: 'headless', lastHeartbeatAt: now - 47 * MIN, cpu: 71, mem: 83, sampledAt: now - 47 * MIN, bindingId: 'bind-home', membership: member('invite', now - 20 * DAY), grant: grant(3, false) },
      { id: 'host-pi', name: 'Raspberry Pi 5', kind: 'local', location: L('客厅', 'Living room'), os: 'Ubuntu 24.04', arch: 'arm64', status: 'online', accepting: false, maintenance: true, desktop: 'headless', lastHeartbeatAt: now - 31e3, cpu: 6, mem: 18, sampledAt: now - 31e3, bindingId: 'bind-home', membership: member('review', now - 26 * DAY), grant: grant(2, false) },
      { id: 'host-build', name: 'Build Server', kind: 'cloud', location: L('法兰克福', 'Frankfurt'), os: 'Ubuntu 22.04', arch: 'x86_64', status: 'online', accepting: true, desktop: 'headless', lastHeartbeatAt: now - 12e3, cpu: 64, mem: 47, sampledAt: now - 12e3, bindingId: 'bind-cloud', membership: member('invite', now - 12 * DAY), grant: grant(4, false) },
      { id: 'host-gpu', name: 'GPU Worker', kind: 'cloud', location: L('新加坡', 'Singapore'), os: 'Ubuntu 22.04', arch: 'x86_64', status: 'online', accepting: true, desktop: 'headless', lastHeartbeatAt: now - 41e3, cpu: 9, mem: 23, sampledAt: now - 41e3, bindingId: 'bind-cloud', membership: member('invite', now - 9 * DAY), grant: grant(5, false) },
    ];

    d.agents = [
      { id: 'agent-builder', name: 'Builder', role: L('构建、打包与发布', 'Build, package and release'), runtime: 'Claude Code', model: 'Claude Sonnet 5.5', capabilities: [L('文件读写', 'Files'), L('命令执行', 'Commands'), L('本地虚拟机', 'Local VMs')] },
      { id: 'agent-reviewer', name: 'Reviewer', role: L('独立验证', 'Independent verification'), runtime: 'Claude Code', model: 'Claude Opus 5.5', verifier: true, capabilities: [L('只读检查', 'Read-only checks'), L('签名与哈希校验', 'Signature and hash checks')] },
      { id: 'agent-tester', name: 'Tester', role: L('真机与网络测试', 'Device and network testing'), runtime: 'Codex CLI', model: L('账号默认模型', 'Account default model'), capabilities: [L('真机池', 'Device farm'), L('网络限速', 'Network shaping')] },
      { id: 'agent-researcher', name: 'Researcher', role: L('调研、方案与记忆整理', 'Research, options and memory'), runtime: 'Claude Code', model: 'Claude Haiku 4.5', capabilities: [L('文件读写', 'Files'), L('检索', 'Retrieval')] },
    ];

    d.instances = [
      { id: 'inst-builder-1', name: 'builder-1', agentId: 'agent-builder', hostId: 'host-mini', runtime: 'Claude Code 2.4', adapter: 'native', status: 'running', workspace: '~/code/fractalmind-app', sessionKey: 'fm:builder-1', okrIds: ['okr-alpha'] },
      { id: 'inst-reviewer-1', name: 'reviewer-1', agentId: 'agent-reviewer', hostId: 'host-mini', runtime: 'Claude Code 2.4', adapter: 'native', status: 'idle', workspace: '~/code/fractalmind-app', sessionKey: 'fm:reviewer-1', okrIds: [] },
      { id: 'inst-researcher-1', name: 'researcher-1', agentId: 'agent-researcher', hostId: 'host-mbp', runtime: 'Claude Code 2.4', adapter: 'native', status: 'idle', workspace: '~/code/fractalmind-app', sessionKey: 'fm:researcher-1', okrIds: [] },
      { id: 'inst-researcher-2', name: 'researcher-2', agentId: 'agent-researcher', hostId: 'host-nas', runtime: 'Claude Code 2.4', adapter: 'native', status: 'running', workspace: '/srv/memory-index', sessionKey: 'fm:researcher-2', okrIds: ['okr-memory'] },
      { id: 'inst-tester-1', name: 'tester-1', agentId: 'agent-tester', hostId: 'host-build', runtime: 'Codex CLI 0.9', adapter: 'native', status: 'running', workspace: '/srv/work/fractalmind-mobile', sessionKey: 'tmux:tester-1', imported: 'managed', okrIds: ['okr-mobile'] },
      { id: 'inst-builder-2', name: 'builder-2', agentId: 'agent-builder', hostId: 'host-build', runtime: 'Claude Code 2.4', adapter: 'native', status: 'idle', workspace: '/srv/work/fractalmind-mobile', sessionKey: 'fm:builder-2', okrIds: [] },
      { id: 'inst-tester-2', name: 'tester-2', agentId: 'agent-tester', hostId: 'host-gpu', runtime: 'Codex CLI 0.9', adapter: 'native', status: 'idle', workspace: '/srv/work/fractalmind-mobile', sessionKey: 'fm:tester-2', okrIds: [] },
    ];

    const alpha = {
      id: 'okr-alpha', priority: 'P0', ownerAgentId: 'agent-builder', lifecycle: 'ACTIVE',
      title: L('发布可在三大桌面系统安装运行的桌面 Alpha', 'Ship a desktop Alpha that installs and runs on all three desktop OSes'),
      createdAt: now - 16 * DAY, activatedAt: now - 14 * DAY, window: { start: now - 14 * DAY, end: now + 15 * DAY },
      workspaceId: 'ws-app', hostId: 'host-mini', instanceId: 'inst-builder-1', version: 12,
      criteria: [
        { id: 'sc1', text: L('macOS、Windows、Ubuntu 干净环境安装成功率 ≥ 95%', '≥ 95% clean-install success on macOS, Windows and Ubuntu'), krIds: ['kr1', 'kr2'] },
        { id: 'sc2', text: L('冷启动到工作台 p95 ≤ 300 ms', 'Cold start to workbench p95 ≤ 300 ms'), krIds: ['kr3'] },
        { id: 'sc3', text: L('发布记录附三平台安装证据，并经你验收', 'Release notes carry install evidence for all three platforms, accepted by you'), krIds: ['kr1', 'kr2', 'kr3'] },
      ],
      krs: [
        {
          id: 'kr1', weight: 30, status: 'IN_PROGRESS', deps: [], verifyBy: 'user', verifier: 'agent-reviewer', ruleVersion: 'v2',
          title: L('三平台签名安装包通过签名与哈希校验', 'Signed installers for all three platforms pass signature and hash checks'),
          metric: { baseline: 0, current: 3, target: 3, unit: L('个平台', 'platforms'), direction: 'up', sampledAt: now - 3 * HOUR, source: L('签名校验报告 #3', 'Signature check report #3') },
          deliverable: L('.dmg / .msi / .deb 安装包与签名报告', '.dmg / .msi / .deb installers and a signature report'),
          method: L('Reviewer 校验签名与哈希，由你验收', 'Reviewer checks signatures and hashes; you accept'),
          verification: { state: 'passed', by: 'agent-reviewer', ruleVersion: 'v2', at: now - 2 * HOUR },
          acceptance: { state: 'pending', at: now - 2 * HOUR }, plan: null,
        },
        {
          id: 'kr2', weight: 40, status: 'IN_PROGRESS', deps: [], verifyBy: 'preauthorized', verifier: 'agent-reviewer', ruleVersion: 'v2',
          title: L('干净环境安装冒烟成功率', 'Clean-environment install smoke success rate'),
          metric: { baseline: 40, current: 82, target: 95, unit: '%', direction: 'up', sampledAt: now - 2 * MIN, window: L('最近 30 次虚拟机安装', 'last 30 VM installs') },
          deliverable: L('三平台安装冒烟日志与失败分类', 'Install smoke logs and failure triage for all three platforms'),
          method: L('Reviewer（预授权）按 30 次样本窗复核日志', 'Reviewer (pre-authorized) re-checks logs over a 30-run window'),
          verification: { state: 'none' }, acceptance: { state: 'none' }, route: 'A', stepIndex: 0,
          plan: { A: { steps: [{ value: 86, cost: 40 }, { value: 91, cost: 40 }, { value: 95, cost: 40 }] } },
        },
        {
          id: 'kr3', weight: 30, status: 'PENDING', deps: ['kr1', 'kr2'], verifyBy: 'user', verifier: 'agent-reviewer', ruleVersion: 'v1',
          title: L('冷启动到工作台 p95', 'Cold start to workbench p95'),
          metric: { baseline: 900, current: 900, target: 300, unit: 'ms', direction: 'down', sampledAt: now - 14 * DAY, window: L('50 次冷启动', '50 cold starts') },
          deliverable: L('三平台冷启动基准报告', 'Cold-start benchmark report for three platforms'),
          method: L('Reviewer 复核基准数据，由你验收', 'Reviewer re-checks benchmark data; you accept'),
          verification: { state: 'none' }, acceptance: { state: 'none' }, route: 'A', stepIndex: 0,
          plan: {
            A: {
              label: L('外部性能测试服务', 'External performance service'),
              gate: {
                action: L('调用外部性能测试服务（需上传构建）', 'Call an external performance testing service (uploads a build)'),
                reasons: ['third_party_upload', 'paid_service'], budgetImpact: 400,
                alternative: L('本地基准：在 Mac mini 上运行 50 次冷启动（约慢 2 小时）', 'Local benchmark: 50 cold starts on the Mac mini (about 2 hours slower)'),
              },
              steps: [{ value: 520, cost: 400 }, { value: 340, cost: 30 }, { value: 290, cost: 30 }],
            },
            B: { label: L('本地基准测试', 'Local benchmark'), steps: [{ value: 610, cost: 20 }, { value: 380, cost: 20 }, { value: 295, cost: 20 }] },
          },
        },
      ],
      constraints: {
        workspaceId: 'ws-app', hostId: 'host-mini', version: 3, confirmedAt: now - 6 * DAY, deadline: now + 15 * DAY,
        budget: { limit: 3000, spent: 1240, reserved: 160, currency: 'USD' },
        autonomous: [L('读写工作区文件', 'Read and write workspace files'), L('运行构建、测试与本地虚拟机', 'Run builds, tests and local VMs'), L('在工作区内创建分支与提交', 'Create branches and commits in the workspace')],
        escalation: [L('调用付费外部服务或上传代码到第三方', 'Paid external services or uploading code to third parties'), L('修改签名证书或发布渠道', 'Changing signing certificates or release channels'), L('预算预留超过剩余额度', 'Reservations beyond the remaining budget')],
        verification: L('Reviewer 预授权验证 KR2；KR1、KR3 与最终结果由你验收', 'Reviewer is pre-authorized for KR2; you accept KR1, KR3 and the final result'),
      },
      nav: nav(),
      trend: trend(now, [0.18, 0.24, 0.31, 0.38, 0.45, 0.52, 0.57, 0.61]),
    };

    const mobile = {
      id: 'okr-mobile', priority: 'P1', ownerAgentId: 'agent-tester', lifecycle: 'ACTIVE',
      title: L('让手机可靠接手桌面任务', 'Make phone handoff of desktop tasks reliable'),
      createdAt: now - 12 * DAY, activatedAt: now - 11 * DAY, window: { start: now - 11 * DAY, end: now + 30 * DAY },
      workspaceId: 'ws-mobile', hostId: 'host-build', instanceId: 'inst-tester-1', version: 8,
      criteria: [
        { id: 'sc1', text: L('蜂窝网络下审批往返成功率 ≥ 99%', '≥ 99% approval round-trip success on cellular'), krIds: ['kr1'] },
        { id: 'sc2', text: L('推送到状态刷新 p95 ≤ 5 秒', 'Push-to-refresh p95 ≤ 5 s'), krIds: ['kr2'] },
      ],
      krs: [
        {
          id: 'kr1', weight: 50, status: 'IN_PROGRESS', deps: [], verifyBy: 'user', verifier: 'agent-reviewer', ruleVersion: 'v1',
          title: L('蜂窝网络审批往返成功率', 'Approval round-trip success on cellular'),
          metric: { baseline: 60, current: 72, target: 99, unit: '%', direction: 'up', sampledAt: now - 18 * MIN, window: L('最近 200 次往返', 'last 200 round-trips') },
          deliverable: L('iOS / Android 真机往返记录', 'iOS / Android device round-trip records'),
          method: L('Reviewer 复核真机记录，由你验收', 'Reviewer re-checks device records; you accept'),
          verification: { state: 'none' }, acceptance: { state: 'none' }, route: 'A', stepIndex: 0,
          plan: {
            A: {
              label: L('TestFlight 真机测试', 'TestFlight device testing'),
              gate: {
                action: L('上传 iOS 测试构建到 TestFlight', 'Upload an iOS test build to TestFlight'),
                reasons: ['third_party_upload'], budgetImpact: 0,
                alternative: L('改用本地模拟器与网络限速（无法覆盖真实蜂窝网络）', 'Use a local simulator with network shaping (cannot cover real cellular networks)'),
              },
              steps: [{ value: 85, cost: 60 }, { value: 94, cost: 60 }, { value: 99, cost: 60 }],
            },
            B: { label: L('本地模拟器 + 网络限速', 'Local simulator + network shaping'), steps: [{ value: 80, cost: 30 }, { value: 90, cost: 30 }, { value: 99, cost: 30 }] },
          },
        },
        {
          id: 'kr2', weight: 50, status: 'IN_PROGRESS', deps: [], verifyBy: 'preauthorized', verifier: 'agent-reviewer', ruleVersion: 'v1',
          title: L('推送到状态刷新 p95', 'Push-to-refresh p95'),
          metric: { baseline: 12, current: 9.2, target: 5, unit: 's', direction: 'down', sampledAt: now - 40 * MIN, window: L('最近 100 次推送', 'last 100 pushes') },
          deliverable: L('推送唤醒与刷新耗时报告', 'Push wake-up and refresh timing report'),
          method: L('Reviewer（预授权）按样本窗复核', 'Reviewer (pre-authorized) re-checks the sample window'),
          verification: { state: 'none' }, acceptance: { state: 'none' }, route: 'A', stepIndex: 0,
          plan: { A: { steps: [{ value: 7.4, cost: 40 }, { value: 6.1, cost: 40 }, { value: 4.8, cost: 40 }] } },
        },
      ],
      constraints: {
        workspaceId: 'ws-mobile', hostId: 'host-build', version: 2, confirmedAt: now - 9 * DAY, deadline: now + 30 * DAY,
        budget: { limit: 2000, spent: 680, reserved: 0, currency: 'USD' },
        autonomous: [L('运行移动端构建与测试', 'Run mobile builds and tests'), L('使用本组织的 Android 真机池', "Use this organization's Android device farm")],
        escalation: [L('上传代码或构建到第三方', 'Uploading code or builds to third parties'), L('预算预留超过剩余额度', 'Reservations beyond the remaining budget')],
        verification: L('Reviewer 预授权验证 KR2；KR1 与最终结果由你验收', 'Reviewer is pre-authorized for KR2; you accept KR1 and the final result'),
      },
      nav: nav(),
      trend: trend(now, [0.1, 0.14, 0.2, 0.24, 0.29, 0.33, 0.35]),
    };

    const memory = {
      id: 'okr-memory', priority: 'P2', ownerAgentId: 'agent-researcher', lifecycle: 'ACTIVE',
      title: L('让组织记忆检索更快、来源可追溯', 'Make organization memory retrieval faster and traceable'),
      createdAt: now - 21 * DAY, activatedAt: now - 20 * DAY, window: { start: now - 20 * DAY, end: now + 45 * DAY },
      workspaceId: 'ws-memory', hostId: 'host-nas', instanceId: 'inst-researcher-2', version: 5,
      criteria: [
        { id: 'sc1', text: L('记忆检索 p95 ≤ 200 ms', 'Memory retrieval p95 ≤ 200 ms'), krIds: ['kr1'] },
        { id: 'sc2', text: L('≥ 95% 的检索结果附来源引用', '≥ 95% of results cite their source'), krIds: ['kr2'] },
      ],
      krs: [
        {
          id: 'kr1', weight: 60, status: 'IN_PROGRESS', deps: [], verifyBy: 'preauthorized', verifier: 'agent-reviewer', ruleVersion: 'v1',
          title: L('记忆检索 p95', 'Memory retrieval p95'),
          metric: { baseline: 800, current: 560, target: 200, unit: 'ms', direction: 'down', sampledAt: now - 3 * DAY, staleAfter: 2 * DAY, window: L('1,000 次检索', '1,000 queries') },
          deliverable: L('检索延迟基准', 'Retrieval latency benchmark'), method: L('Reviewer（预授权）复核基准', 'Reviewer (pre-authorized) re-checks the benchmark'),
          verification: { state: 'none' }, acceptance: { state: 'none' }, route: 'A', stepIndex: 0,
          plan: { A: { steps: [{ value: 420, cost: 30 }, { value: 300, cost: 30 }, { value: 200, cost: 30 }] } },
        },
        {
          id: 'kr2', weight: 40, status: 'IN_PROGRESS', deps: [], verifyBy: 'preauthorized', verifier: 'agent-reviewer', ruleVersion: 'v1',
          title: L('检索结果的来源引用率', 'Share of results with source citations'),
          metric: { baseline: 50, current: null, target: 95, unit: '%', direction: 'up', sampledAt: null, window: L('500 条检索结果', '500 results') },
          deliverable: L('引用抽样报告', 'Citation sampling report'), method: L('Reviewer（预授权）抽样复核', 'Reviewer (pre-authorized) sample review'),
          verification: { state: 'none' }, acceptance: { state: 'none' }, route: 'A', stepIndex: 0,
          plan: { A: { steps: [{ value: 70, cost: 30 }, { value: 85, cost: 30 }, { value: 95, cost: 30 }] } },
        },
      ],
      constraints: {
        workspaceId: 'ws-memory', hostId: 'host-nas', version: 1, confirmedAt: now - 20 * DAY, deadline: now + 45 * DAY,
        budget: { limit: 1500, spent: 310, reserved: 0, currency: 'USD' },
        autonomous: [L('读写记忆索引工作区', 'Read and write the memory index workspace'), L('运行检索基准', 'Run retrieval benchmarks')],
        escalation: [L('删除或改写已上链的记忆', 'Deleting or rewriting on-chain memories'), L('预算预留超过剩余额度', 'Reservations beyond the remaining budget')],
        verification: L('Reviewer 预授权验证两个 KR；最终结果由你验收', 'Reviewer is pre-authorized for both KRs; you accept the final result'),
      },
      nav: nav(),
      trend: trend(now, [0.05, 0.12, 0.18, 0.22, 0.24]),
    };

    const explorer = {
      id: 'okr-explorer', priority: 'P2', ownerAgentId: 'agent-builder', lifecycle: 'CANDIDATE', candidateReason: 'active_limit',
      title: L('在 Explorer 中展示组织公开信息与来源', 'Show public organization info and sources in Explorer'),
      createdAt: now - 4 * DAY, window: { start: null, end: now + 40 * DAY },
      workspaceId: 'ws-app', hostId: 'host-mini', instanceId: 'inst-builder-1', version: 2,
      criteria: [{ id: 'sc1', text: L('公开组织页 100% 展示使命、规则、来源与更新时间', 'Public organization pages show mission, rules, source and freshness for 100% of fields'), krIds: ['kr1'] }],
      krs: [{
        id: 'kr1', weight: 100, status: 'PENDING', deps: [], verifyBy: 'user', verifier: 'agent-reviewer', ruleVersion: 'v1',
        title: L('公开字段覆盖率', 'Public field coverage'),
        metric: { baseline: 40, current: 40, target: 100, unit: '%', direction: 'up', sampledAt: now - 4 * DAY },
        deliverable: L('Explorer 组织详情页', 'Explorer organization detail page'), method: L('Reviewer 复核，由你验收', 'Reviewer re-checks; you accept'),
        verification: { state: 'none' }, acceptance: { state: 'none' }, route: 'A', stepIndex: 0,
        plan: { A: { steps: [{ value: 70, cost: 50 }, { value: 90, cost: 50 }, { value: 100, cost: 50 }] } },
      }],
      constraints: {
        workspaceId: 'ws-app', hostId: 'host-mini', version: 1, confirmedAt: null, deadline: now + 40 * DAY,
        budget: { limit: 1200, spent: 0, reserved: 0, currency: 'USD' },
        autonomous: [L('读写工作区文件', 'Read and write workspace files'), L('运行构建与测试', 'Run builds and tests')],
        escalation: [L('调用付费外部服务', 'Paid external services')],
        verification: L('Reviewer 复核，由你验收', 'Reviewer re-checks; you accept'),
      },
      nav: nav(), trend: [],
    };

    const first = {
      id: 'okr-first', priority: 'P0', ownerAgentId: 'agent-builder', lifecycle: 'ACHIEVED', achievedAt: now - 17 * DAY,
      title: L('建立个人组织并完成首个经过验证的成果', 'Set up the personal organization and deliver the first verified result'),
      createdAt: now - 40 * DAY, activatedAt: now - 39 * DAY, window: { start: now - 39 * DAY, end: now - 15 * DAY },
      workspaceId: 'ws-app', hostId: 'host-mbp', instanceId: 'inst-researcher-1', version: 9,
      criteria: [{ id: 'sc1', text: L('组织与首台主机链上确认，且 1 份成果报告通过验收', 'Organization and first host confirmed on chain, with 1 accepted result report'), krIds: ['kr1', 'kr2'] }],
      krs: [
        { id: 'kr1', weight: 50, status: 'COMPLETE', deps: [], verifyBy: 'user', binary: { verified: true }, title: L('个人组织与首台主机链上确认', 'Personal organization and first host confirmed on chain'), verification: { state: 'passed', by: 'agent-reviewer', ruleVersion: 'v1', at: now - 38 * DAY }, acceptance: { state: 'accepted', at: now - 38 * DAY }, method: L('链上对象确认', 'On-chain object confirmation') },
        { id: 'kr2', weight: 50, status: 'COMPLETE', deps: ['kr1'], verifyBy: 'user', binary: { verified: true }, title: L('首个成果报告通过验收', 'First result report accepted'), verification: { state: 'passed', by: 'agent-reviewer', ruleVersion: 'v1', at: now - 18 * DAY }, acceptance: { state: 'accepted', at: now - 17 * DAY }, method: L('你检查报告与证据', 'You review the report and evidence') },
      ],
      constraints: {
        workspaceId: 'ws-app', hostId: 'host-mbp', version: 2, confirmedAt: now - 39 * DAY, deadline: now - 15 * DAY,
        budget: { limit: 800, spent: 420, reserved: 0, currency: 'USD' },
        autonomous: [L('读写工作区文件', 'Read and write workspace files')], escalation: [L('公开发布', 'Publishing publicly')],
        verification: L('由你验收', 'You accept'),
      },
      nav: nav(), trend: trend(now - 17 * DAY, [0.2, 0.5, 0.5, 1]),
    };

    d.okrs = [alpha, mobile, memory, explorer, first];

    d.tasks = [
      { id: 'task-a1', okrId: 'okr-alpha', krId: 'kr1', title: L('构建三平台安装包', 'Build installers for three platforms'), state: 'Verified', createdAt: now - 13 * DAY },
      { id: 'task-a2', okrId: 'okr-alpha', krId: 'kr1', title: L('签名与公证', 'Sign and notarize'), state: 'Verified', createdAt: now - 9 * DAY },
      { id: 'task-a3', okrId: 'okr-alpha', krId: 'kr2', title: L('三平台安装冒烟 30 次', '30 install smoke runs across platforms'), state: 'Assigned', createdAt: now - 3 * DAY },
      { id: 'task-a4', okrId: 'okr-alpha', krId: 'kr2', title: L('修复 Ubuntu 依赖缺失', 'Fix the missing Ubuntu dependency'), state: 'Submitted', createdAt: now - 4 * DAY },
      { id: 'task-a5', okrId: 'okr-alpha', krId: 'kr3', title: L('冷启动基准测试', 'Cold-start benchmark'), state: 'Created', createdAt: now - 6 * DAY },
      { id: 'task-m1', okrId: 'okr-mobile', krId: 'kr1', title: L('蜂窝网络审批往返测试', 'Cellular approval round-trip tests'), state: 'Assigned', createdAt: now - 5 * DAY },
      { id: 'task-m2', okrId: 'okr-mobile', krId: 'kr2', title: L('推送唤醒与刷新优化', 'Push wake-up and refresh tuning'), state: 'Assigned', createdAt: now - 5 * DAY },
      { id: 'task-r1', okrId: 'okr-memory', krId: 'kr1', title: L('重建记忆向量索引', 'Rebuild the memory vector index'), state: 'Assigned', createdAt: now - 6 * DAY },
    ];

    d.runs = [
      { id: 'R-0142', okrId: 'okr-alpha', krId: 'kr2', taskId: 'task-a3', hostId: 'host-mini', instanceId: 'inst-builder-1', state: 'running', attempt: 1, startedAt: now - 38 * MIN, title: L('Windows 11 干净环境安装冒烟（第 24/30 次）', 'Windows 11 clean-install smoke (run 24/30)'), sideEffects: [L('在工作区写入 4 个日志文件', 'Wrote 4 log files in the workspace')] },
      { id: 'R-0140', okrId: 'okr-mobile', krId: 'kr1', taskId: 'task-m1', hostId: 'host-build', instanceId: 'inst-tester-1', state: 'awaiting_approval', attempt: 1, startedAt: now - 26 * MIN, title: L('在蜂窝网络下验证 iOS 审批往返', 'Verify iOS approval round-trips on cellular'), sideEffects: [] },
      { id: 'R-0137', okrId: 'okr-mobile', krId: 'kr2', taskId: 'task-m2', hostId: 'host-build', instanceId: 'inst-tester-1', state: 'needs_confirmation', attempt: 1, startedAt: now - 5 * HOUR, title: L('向本组织 Android 真机池提交测试任务', "Submit a test job to this organization's Android device farm"), note: L('执行进程在提交后崩溃，无法确认真机池是否已接收该任务。', 'The runner crashed after submitting; it cannot confirm whether the device farm received the job.'), check: L('真机池控制台显示任务 #5521 已于 14:02 排队（演示）', 'The device farm console shows job #5521 queued at 14:02 (demo)'), sideEffects: [L('可能已向真机池提交 1 个任务（外部，消耗配额）', 'May have submitted 1 job to the device farm (external, uses quota)')] },
      { id: 'R-0135', okrId: 'okr-memory', krId: 'kr1', taskId: 'task-r1', hostId: 'host-nas', instanceId: 'inst-researcher-2', state: 'running', attempt: 1, startedAt: now - 2 * HOUR, title: L('重建记忆向量索引', 'Rebuild the memory vector index'), sideEffects: [] },
      { id: 'R-0131', okrId: 'okr-alpha', krId: 'kr1', taskId: 'task-a1', hostId: 'host-mini', instanceId: 'inst-builder-1', state: 'succeeded', attempt: 2, parentRunId: 'R-0127', startedAt: now - 8 * DAY, endedAt: now - 8 * DAY + 2 * HOUR, title: L('构建三平台安装包（重试）', 'Build installers for three platforms (retry)'), sideEffects: [L('生成 3 个安装包', 'Produced 3 installers')] },
      { id: 'R-0127', okrId: 'okr-alpha', krId: 'kr1', taskId: 'task-a1', hostId: 'host-mini', instanceId: 'inst-builder-1', state: 'failed', attempt: 1, startedAt: now - 9 * DAY, endedAt: now - 9 * DAY + HOUR, title: L('构建三平台安装包', 'Build installers for three platforms'), error: L('Ubuntu 构建缺少 libwebkit2gtk-4.1', 'Ubuntu build is missing libwebkit2gtk-4.1'), sideEffects: [L('生成 2 个安装包（保留，未回滚）', 'Produced 2 installers (kept, not rolled back)')] },
    ];

    d.approvals = [
      { id: 'apv-testflight', kind: 'boundary', okrId: 'okr-mobile', krId: 'kr1', runId: 'R-0140', route: 'A', state: 'pending', createdAt: now - 25 * MIN, expiresAt: now + 20 * HOUR, boundVersion: 2, action: mobile.krs[0].plan.A.gate.action, reasons: ['third_party_upload'], budgetImpact: 0, alternative: mobile.krs[0].plan.A.gate.alternative },
      { id: 'apv-kr1-accept', kind: 'acceptance', okrId: 'okr-alpha', krId: 'kr1', state: 'pending', createdAt: now - 2 * HOUR, expiresAt: now + 3 * DAY, boundVersion: 3 },
      { id: 'apv-h1', kind: 'boundary', okrId: 'okr-first', krId: 'kr2', route: 'A', state: 'approved', createdAt: now - 19 * DAY - HOUR, decidedAt: now - 19 * DAY, expiresAt: now - 18 * DAY, boundVersion: 2, action: L('在组织公开页发布首个成果摘要', "Publish the first result summary on the organization's public page"), reasons: ['public_release'], budgetImpact: 0, execution: { runId: 'R-0098', at: now - 19 * DAY + 20 * MIN, result: 'executed' } },
      { id: 'apv-h2', kind: 'boundary', okrId: 'okr-alpha', krId: 'kr2', route: 'X', state: 'rejected', createdAt: now - 9 * DAY - HOUR, decidedAt: now - 9 * DAY, expiresAt: now - 8 * DAY, boundVersion: 2, action: L('删除旧的发布分支', 'Delete old release branches'), reasons: ['destructive'], budgetImpact: 0 },
      { id: 'apv-h3', kind: 'boundary', okrId: 'okr-alpha', krId: 'kr1', route: 'X', state: 'expired', createdAt: now - 8 * DAY, expiresAt: now - 7 * DAY, boundVersion: 2, action: L('在公共 CI 上运行签名流程', 'Run signing on public CI'), reasons: ['third_party_upload'], budgetImpact: 0 },
      { id: 'apv-h4', kind: 'boundary', okrId: 'okr-alpha', krId: 'kr2', route: 'X', state: 'invalidated', createdAt: now - 7 * DAY, invalidatedAt: now - 6 * DAY, expiresAt: now - 6 * DAY, boundVersion: 2, action: L('本次预留超过剩余预算（$6）', 'This reservation exceeds the remaining budget ($6)'), reasons: ['budget'], budgetImpact: 600 },
    ];

    d.evidence = [
      { id: 'ev-a5', okrId: 'okr-alpha', krId: 'kr2', runId: 'R-0142', kind: 'measurement', trust: 'measured', value: 82, unit: '%', at: now - 2 * MIN, hostId: 'host-mini', demo: true },
      { id: 'ev-a6', okrId: 'okr-alpha', krId: 'kr2', runId: 'R-0142', kind: 'log', trust: 'measured', title: L('安装冒烟日志 · 第 1–24 次', 'Install smoke logs · runs 1–24'), at: now - 4 * MIN, hostId: 'host-mini', demo: true },
      { id: 'ev-a7', okrId: 'okr-alpha', krId: 'kr2', runId: 'R-0142', kind: 'diff', trust: 'claimed', title: L('Ubuntu 依赖修复（Agent 声明已修复）', 'Ubuntu dependency fix (claimed by the Agent)'), at: now - 50 * MIN, hostId: 'host-mini', demo: true },
      { id: 'ev-a4', okrId: 'okr-alpha', krId: 'kr1', runId: 'R-0131', kind: 'verification', trust: 'verified', result: 'pass', verifier: 'agent-reviewer', ruleVersion: 'v2', at: now - 2 * HOUR, hostId: 'host-mini', demo: true },
      { id: 'ev-a1', okrId: 'okr-alpha', krId: 'kr1', runId: 'R-0131', kind: 'report', trust: 'verified', title: L('签名校验报告 #3', 'Signature check report #3'), verifier: 'agent-reviewer', ruleVersion: 'v2', result: 'pass', at: now - 3 * HOUR, hostId: 'host-mini', demo: true },
      { id: 'ev-a2', okrId: 'okr-alpha', krId: 'kr1', runId: 'R-0131', kind: 'artifact', trust: 'verified', title: L('三平台安装包哈希清单', 'Installer hash manifest'), verifier: 'agent-reviewer', ruleVersion: 'v2', result: 'pass', at: now - 3 * HOUR, hostId: 'host-mini', demo: true },
      { id: 'ev-a3', okrId: 'okr-alpha', krId: 'kr1', runId: 'R-0131', kind: 'artifact', trust: 'verified', title: L('macOS 公证回执', 'macOS notarization receipt'), verifier: 'agent-reviewer', ruleVersion: 'v2', result: 'pass', at: now - 4 * HOUR, hostId: 'host-mini', demo: true },
      { id: 'ev-m1', okrId: 'okr-mobile', krId: 'kr1', runId: 'R-0140', kind: 'measurement', trust: 'measured', value: 72, unit: '%', at: now - 18 * MIN, hostId: 'host-build', demo: true },
      { id: 'ev-m2', okrId: 'okr-mobile', krId: 'kr2', runId: 'R-0137', kind: 'measurement', trust: 'measured', value: 9.2, unit: 's', at: now - 40 * MIN, hostId: 'host-build', demo: true },
      { id: 'ev-r1', okrId: 'okr-memory', krId: 'kr1', runId: 'R-0135', kind: 'measurement', trust: 'measured', value: 560, unit: 'ms', at: now - 3 * DAY, hostId: 'host-nas', demo: true },
      { id: 'ev-f1', okrId: 'okr-first', krId: 'kr2', runId: 'R-0098', kind: 'report', trust: 'accepted', title: L('首个成果报告', 'First result report'), verifier: 'agent-reviewer', ruleVersion: 'v1', result: 'pass', at: now - 18 * DAY, hostId: 'host-mbp', demo: true },
      { id: 'ev-f2', okrId: 'okr-first', krId: 'kr1', kind: 'verification', trust: 'accepted', result: 'pass', verifier: 'agent-reviewer', ruleVersion: 'v1', at: now - 38 * DAY, hostId: 'host-mbp', demo: true },
    ];

    d.results = [{ id: 'res-1', okrId: 'okr-first', at: now - 17 * DAY, evidenceIds: ['ev-f1', 'ev-f2'] }];

    d.memories = [
      { id: 'mem-1', kind: 'experience', title: L('Windows 干净虚拟机需先关闭 SmartScreen 缓存', 'Disable the SmartScreen cache on clean Windows VMs'), body: L('否则首次安装会被误判为失败；冒烟脚本已在启动前清理缓存。', 'Otherwise first installs are misreported as failures; the smoke script now clears it first.'), source: { okrId: 'okr-alpha', krId: 'kr2', runId: 'R-0127' }, version: 2, updatedAt: now - 4 * DAY, state: 'active', encrypted: true },
      { id: 'mem-2', kind: 'decision', title: L('签名证书变更属于升级条件', 'Signing certificate changes require escalation'), body: L('签名流程只在组织自有主机上运行；公共 CI 的签名请求已过期，未执行。', 'Signing runs only on organization hosts; the public CI signing request expired without running.'), source: { okrId: 'okr-alpha', approvalId: 'apv-h3' }, version: 1, updatedAt: now - 7 * DAY, state: 'active', encrypted: true },
      { id: 'mem-3', kind: 'experience', title: L('Ubuntu 22.04 需声明 libwebkit2gtk-4.1 依赖', 'Declare libwebkit2gtk-4.1 on Ubuntu 22.04'), body: L('R-0127 因缺少该依赖失败；R-0131 重试成功，未重复已生成的安装包。', 'R-0127 failed without it; the R-0131 retry succeeded without redoing the installers already produced.'), source: { okrId: 'okr-alpha', krId: 'kr1', runId: 'R-0127' }, version: 1, updatedAt: now - 8 * DAY, state: 'active', encrypted: true },
      { id: 'mem-4', kind: 'result', title: first.title, body: L('个人组织、首台主机与首个成果报告均已验收。', 'Personal organization, first host and first result report all accepted.'), source: { okrId: 'okr-first' }, version: 1, updatedAt: now - 17 * DAY, state: 'active', encrypted: true },
      { id: 'mem-5', kind: 'experience', title: L('tmux 观察适配器不能暂停执行', 'The tmux observe adapter cannot pause execution'), body: L('仅观察导入的会话不能纳入 OKR 约束。', 'Observe-only sessions cannot take OKR constraints.'), source: { okrId: 'okr-first' }, version: 1, updatedAt: now - 30 * DAY, state: 'archived', encrypted: true },
    ];

    d.invites = [
      { id: 'inv-a', state: 'consumed', ttl: '1h', createdAt: now - 12 * DAY - 30 * MIN, expiresAt: now - 12 * DAY + 30 * MIN, consumedAt: now - 12 * DAY, consumedBy: 'host-build', grantDays: 7, desktop: false, workspaceIds: ['ws-mobile'], bindingId: 'bind-cloud', codeDigest: model.digest('fixture-invite-a'), maxUses: 1 },
      { id: 'inv-b', state: 'active', ttl: '15m', createdAt: now - 3 * DAY, expiresAt: now - 3 * DAY + 15 * MIN, grantDays: 7, desktop: false, workspaceIds: ['ws-app'], bindingId: 'bind-home', codeDigest: model.digest('fixture-invite-b'), maxUses: 1 },
      { id: 'inv-c', state: 'revoked', ttl: '24h', createdAt: now - 5 * DAY, expiresAt: now - 4 * DAY, revokedAt: now - 5 * DAY + 10 * MIN, grantDays: 7, desktop: true, workspaceIds: ['ws-app'], bindingId: 'bind-home', codeDigest: model.digest('fixture-invite-c'), maxUses: 1 },
    ];

    d.decisions = [
      { id: 'dec-1', kind: 'agreement', okrId: 'okr-alpha', version: 3, at: now - 6 * DAY },
      { id: 'dec-2', kind: 'invite_consumed', hostId: 'host-build', at: now - 12 * DAY },
      { id: 'dec-3', kind: 'device_revoked', device: 'iPad Air', at: now - 20 * DAY },
      { id: 'dec-4', kind: 'approval', approvalId: 'apv-h1', at: now - 19 * DAY },
      { id: 'dec-5', kind: 'org_created', at: now - 40 * DAY },
    ];

    d.activity = [
      { id: 'act-1', at: now - 2 * MIN, okrId: 'okr-alpha', krId: 'kr2', runId: 'R-0142', kind: 'measure', value: 82, cost: 40, route: 'A' },
      { id: 'act-2', at: now - 18 * MIN, okrId: 'okr-mobile', krId: 'kr1', runId: 'R-0140', kind: 'measure', value: 72, cost: 60, route: 'A' },
      { id: 'act-3', at: now - 25 * MIN, okrId: 'okr-mobile', krId: 'kr1', runId: 'R-0140', kind: 'gate', approvalId: 'apv-testflight' },
      { id: 'act-4', at: now - 47 * MIN, okrId: 'okr-memory', kind: 'connection_lost', hostId: 'host-nas' },
      { id: 'act-5', at: now - 50 * MIN, okrId: 'okr-alpha', krId: 'kr2', runId: 'R-0142', kind: 'claim', evidenceId: 'ev-a7' },
      { id: 'act-6', at: now - 2 * HOUR, okrId: 'okr-alpha', krId: 'kr1', kind: 'verify_pass', needsAcceptance: true, approvalId: 'apv-kr1-accept' },
      { id: 'act-7', at: now - 3 * HOUR, okrId: 'okr-alpha', krId: 'kr1', runId: 'R-0131', kind: 'measure', value: 3, cost: 0, route: 'A' },
      { id: 'act-8', at: now - 5 * HOUR, okrId: 'okr-mobile', krId: 'kr2', runId: 'R-0137', kind: 'needs_confirmation' },
      { id: 'act-9', at: now - 6 * DAY, okrId: 'okr-alpha', kind: 'agreement', version: 3 },
    ];
    return d;
  }

  /* ---------------------------------------------------------------- Labs */

  function labsData(now) {
    const d = emptyOrgData();
    d.focusOkrId = 'okr-labs';
    d.bindings = [{ id: 'bind-labs', endpoint: 'coord.labs.example.org:7443', label: L('Labs 协调器', 'Labs coordinator'), state: 'confirmed', online: true, confirmedAt: now - 60 * DAY }];
    d.workspaces = [{ id: 'ws-protocol', name: 'fractalmind-protocol', path: '/srv/work/fractalmind-protocol', hostIds: ['host-labs-ci', 'host-labs-gpu'], access: 'read_write', importedAt: now - 50 * DAY, files: ['AGENTS.md', 'OKR.md'] }];
    const member = { state: 'active', via: 'invite', since: now - 50 * DAY };
    d.hosts = [
      { id: 'host-labs-ci', name: 'Labs CI Runner', kind: 'cloud', location: L('俄勒冈', 'Oregon'), os: 'Ubuntu 24.04', arch: 'x86_64', status: 'online', accepting: true, desktop: 'headless', lastHeartbeatAt: now - 15e3, cpu: 52, mem: 44, sampledAt: now - 15e3, bindingId: 'bind-labs', membership: member, grant: { actions: ['execute'], desktop: false, expiresAt: now + 5 * DAY } },
      { id: 'host-labs-gpu', name: 'Labs GPU Node', kind: 'cloud', location: L('东京', 'Tokyo'), os: 'Ubuntu 22.04', arch: 'x86_64', status: 'online', accepting: true, desktop: 'headless', lastHeartbeatAt: now - 26e3, cpu: 17, mem: 30, sampledAt: now - 26e3, bindingId: 'bind-labs', membership: member, grant: { actions: ['execute'], desktop: false, expiresAt: now + 5 * DAY } },
    ];
    d.agents = [
      { id: 'agent-lead', name: 'Protocol Lead', role: L('协议负责人（Lead）', 'Protocol lead'), runtime: 'Claude Code', model: 'Claude Opus 5.5', capabilities: [L('任务拆分', 'Task breakdown'), L('Move 构建', 'Move builds')] },
      { id: 'agent-auditor', name: 'Auditor', role: L('独立审查', 'Independent review'), runtime: 'Claude Code', model: 'Claude Opus 5.5', verifier: true, capabilities: [L('只读审查', 'Read-only review')] },
    ];
    d.instances = [
      { id: 'inst-lead-1', name: 'lead-1', agentId: 'agent-lead', hostId: 'host-labs-ci', runtime: 'Claude Code 2.4', adapter: 'native', status: 'running', workspace: '/srv/work/fractalmind-protocol', sessionKey: 'fm:lead-1', okrIds: ['okr-labs'] },
      { id: 'inst-auditor-1', name: 'auditor-1', agentId: 'agent-auditor', hostId: 'host-labs-gpu', runtime: 'Claude Code 2.4', adapter: 'native', status: 'idle', workspace: '/srv/work/fractalmind-protocol', sessionKey: 'fm:auditor-1', okrIds: [] },
    ];
    d.okrs = [{
      id: 'okr-labs', priority: 'P0', ownerAgentId: 'agent-lead', lifecycle: 'ACTIVE',
      title: L('发布协议测试网 v0.3 并完成独立审查', 'Release protocol testnet v0.3 with an independent review'),
      createdAt: now - 30 * DAY, activatedAt: now - 28 * DAY, window: { start: now - 28 * DAY, end: now + 20 * DAY },
      workspaceId: 'ws-protocol', hostId: 'host-labs-ci', instanceId: 'inst-lead-1', version: 14,
      criteria: [
        { id: 'sc1', text: L('合约测试覆盖率 ≥ 90%', 'Contract test coverage ≥ 90%'), krIds: ['kr1'] },
        { id: 'sc2', text: L('独立审查的 6 个高危问题全部关闭', 'All 6 high-severity review findings closed'), krIds: ['kr2'] },
      ],
      krs: [
        { id: 'kr1', weight: 50, status: 'IN_PROGRESS', deps: [], verifyBy: 'preauthorized', title: L('合约测试覆盖率', 'Contract test coverage'), metric: { baseline: 55, current: 76, target: 90, unit: '%', direction: 'up', sampledAt: now - 30 * MIN }, method: L('Auditor（预授权）复核覆盖率报告', 'Auditor (pre-authorized) re-checks coverage'), verification: { state: 'none' }, acceptance: { state: 'none' }, route: 'A', stepIndex: 0, plan: { A: { steps: [{ value: 82, cost: 50 }, { value: 87, cost: 50 }, { value: 90, cost: 50 }] } } },
        { id: 'kr2', weight: 50, status: 'IN_PROGRESS', deps: [], verifyBy: 'user', title: L('已关闭的高危审查问题', 'High-severity findings closed'), metric: { baseline: 0, current: 2, target: 6, unit: L('个', 'findings'), direction: 'up', sampledAt: now - 3 * HOUR }, method: L('Auditor 复核，组织管理员验收', 'Auditor re-checks; an organization admin accepts'), verification: { state: 'none' }, acceptance: { state: 'none' }, route: 'A', stepIndex: 0, plan: { A: { steps: [{ value: 4, cost: 80 }, { value: 6, cost: 80 }] } } },
      ],
      constraints: {
        workspaceId: 'ws-protocol', hostId: 'host-labs-ci', version: 4, confirmedAt: now - 10 * DAY, deadline: now + 20 * DAY,
        budget: { limit: 6000, spent: 2890, reserved: 200, currency: 'USD' },
        autonomous: [L('运行 Move 构建与测试', 'Run Move builds and tests'), L('在本地网络部署合约', 'Deploy contracts to a local network')],
        escalation: [L('向测试网或主网部署合约', 'Deploying contracts to testnet or mainnet')],
        verification: L('Auditor 预授权验证 KR1；KR2 与最终结果由组织管理员验收', 'Auditor is pre-authorized for KR1; an organization admin accepts KR2 and the final result'),
      },
      nav: nav(), trend: trend(now, [0.2, 0.28, 0.35, 0.41, 0.47]),
    }];
    d.runs = [{ id: 'R-0301', okrId: 'okr-labs', krId: 'kr1', taskId: 'task-l1', hostId: 'host-labs-ci', instanceId: 'inst-lead-1', state: 'running', attempt: 1, startedAt: now - 30 * MIN, title: L('补齐 remote_authority 的撤销测试', 'Add revocation tests for remote_authority'), sideEffects: [] }];
    d.tasks = [{ id: 'task-l1', okrId: 'okr-labs', krId: 'kr1', title: L('补齐撤销路径测试', 'Cover revocation paths with tests'), state: 'Assigned', createdAt: now - 3 * DAY }];
    d.approvals = [{ id: 'apv-labs-1', kind: 'boundary', okrId: 'okr-labs', krId: 'kr1', route: 'X', state: 'pending', createdAt: now - HOUR, expiresAt: now + 22 * HOUR, boundVersion: 4, action: L('向测试网部署 v0.3 合约', 'Deploy v0.3 contracts to testnet'), reasons: ['deployment'], budgetImpact: 150, alternative: L('先在本地网络完成迁移测试', 'Finish migration tests on a local network first') }];
    d.evidence = [{ id: 'ev-l1', okrId: 'okr-labs', krId: 'kr1', runId: 'R-0301', kind: 'measurement', trust: 'measured', value: 76, unit: '%', at: now - 30 * MIN, hostId: 'host-labs-ci', demo: true }];
    d.memories = [{ id: 'mem-l1', kind: 'experience', title: L('Move 升级前先在本地网络跑完整迁移测试', 'Run the full migration test on a local network before Move upgrades'), body: L('v0.2 升级时曾遗漏动态字段迁移。', 'The v0.2 upgrade missed a dynamic-field migration.'), source: { okrId: 'okr-labs' }, version: 1, updatedAt: now - 15 * DAY, state: 'active', encrypted: true }];
    d.activity = [
      { id: 'act-l1', at: now - 30 * MIN, okrId: 'okr-labs', krId: 'kr1', runId: 'R-0301', kind: 'measure', value: 76, cost: 50, route: 'A' },
      { id: 'act-l2', at: now - HOUR, okrId: 'okr-labs', krId: 'kr1', kind: 'gate', approvalId: 'apv-labs-1' },
    ];
    d.decisions = [{ id: 'dec-l1', kind: 'joined', at: now - 12 * DAY }];
    return d;
  }

  /* ------------------------------------------------------------- Profiles */

  function createDemoProfile(now, model) {
    const recovery = model.parseRecoveryCode(demoRecoveryCode(model), 'T');
    return {
      schema: 2, id: 'demo-ada', kind: 'demo', createdAt: now, seq: 400, runSeq: 150,
      human: { id: 'HMN-7Q2K-4F9D', name: 'Ada', createdAt: now - 40 * DAY },
      recovery: { state: 'saved', digest: recovery.digest, network: 'T', version: 1, savedAt: now - 40 * DAY, history: [] },
      wallet: {
        address: '0x00000000000000000000000000000000000000000000000000000000000de770',
        balance: 42000000, source: 'self', sponsor: null,
        records: [
          { txId: '9mXq…demo', kind: 'okr.update', amount: 736000, payer: 'self', state: 'confirmed', at: now - 6 * DAY },
          { txId: '4Hc2…demo', kind: 'okr.activate', amount: 1104000, payer: 'self', state: 'confirmed', at: now - 14 * DAY },
          { txId: '7Rb8…demo', kind: 'invite.create', amount: 600000, payer: 'self', state: 'failed', error: 'simulated_failure', at: now - 13 * DAY },
          { txId: 'Kp3s…demo', kind: 'approval.decide', amount: 368000, payer: 'self', state: 'confirmed', at: now - 19 * DAY },
          { txId: '2Wfa…demo', kind: 'identity.create', amount: 2760000, payer: 'self', state: 'confirmed', at: now - 40 * DAY },
        ],
      },
      devices: [
        { id: 'dev-mbp', name: 'MacBook Pro 14', platform: 'macos', role: 'manage', addedAt: now - 40 * DAY, unlock: 'touch_id', grant: { state: 'active', expiresAt: null, scopes: [{ orgId: P, actions: ['read', 'operate', 'approve', 'manage_hosts'] }, { orgId: LABS, actions: ['read', 'operate'] }] }, dataSync: 'synced', shareData: true },
        { id: 'dev-iphone', name: 'iPhone 16', platform: 'ios', role: 'access', addedAt: now - 2 * DAY, unlock: 'face_id', grant: { state: 'active', expiresAt: now + 5 * DAY, scopes: [{ orgId: P, actions: ['read', 'operate', 'approve'] }] }, dataSync: 'synced', shareData: true },
        { id: 'dev-pixel', name: 'Pixel 9', platform: 'android', role: 'access', addedAt: now - HOUR, unlock: 'fingerprint', grant: { state: 'active', expiresAt: now + 7 * DAY - HOUR, scopes: [{ orgId: P, actions: ['read'] }] }, dataSync: 'pending', shareData: true },
        { id: 'dev-ipad', name: 'iPad Air', platform: 'ios', role: 'access', addedAt: now - 60 * DAY, revokedAt: now - 20 * DAY, grant: { state: 'revoked', expiresAt: now - 20 * DAY, scopes: [{ orgId: P, actions: ['read'] }] }, dataSync: 'synced', shareData: true },
      ],
      pairings: [],
      currentDeviceId: 'dev-mbp',
      locked: false,
      orgs: [
        { id: P, chainId: chainId(model, 'org-personal'), name: L('Ada 的个人组织', "Ada's organization"), kind: 'personal', role: 'admin', network: 'testnet', status: 'confirmed', createdAt: now - 40 * DAY },
        { id: LABS, chainId: chainId(model, 'org-labs'), name: 'FractalMind Labs', kind: 'team', role: 'member', network: 'testnet', status: 'confirmed', createdAt: now - 90 * DAY, joinedAt: now - 12 * DAY },
      ],
      currentOrgId: P,
      epoch: 0,
      data: { [P]: personalData(now, model), [LABS]: labsData(now) },
      txs: [],
      onboarding: null,
    };
  }

  /** J1: a new identity starts from an empty organization with nothing inherited. */
  function createEmptyProfile(input, now, model) {
    const id = `id-${model.digest(`${input.name}:${now}`).slice(0, 10)}`;
    const orgId = `org-${model.digest(`${id}:org`).slice(0, 8)}`;
    const data = emptyOrgData();
    return {
      schema: 2, id, kind: 'new', createdAt: now, seq: 10, runSeq: 0,
      human: { id: `HMN-${model.digest(id).slice(0, 4).toUpperCase()}-${model.digest(id + 'h').slice(0, 4).toUpperCase()}`, name: input.name, createdAt: now },
      recovery: { state: 'unset', digest: null, history: [] },
      wallet: input.wallet,
      devices: [{
        id: 'dev-first', name: input.deviceName, platform: input.platform, role: 'manage', addedAt: now, unlock: input.unlock,
        grant: { state: 'active', expiresAt: null, scopes: [{ orgId, actions: ['read', 'operate', 'approve', 'manage_hosts'] }] },
        dataSync: 'synced', shareData: true,
      }],
      pairings: [],
      currentDeviceId: 'dev-first',
      locked: false,
      orgs: [{ id: orgId, chainId: chainId(model, orgId), name: input.orgName, kind: 'personal', role: 'admin', network: 'testnet', status: 'confirmed', createdAt: now }],
      currentOrgId: orgId,
      epoch: 0,
      data: { [orgId]: data },
      txs: [],
      onboarding: { workspace: false, host: false, model: false, okr: false },
    };
  }

  /** Public organizations for the open network view (demo directory, not live chain data). */
  function networkDirectory(now, model) {
    return [
      { id: 'net-labs', orgId: LABS, chainId: chainId(model, 'org-labs'), name: 'FractalMind Labs', mission: L('通过分形、自相似的 Agent 组织，向 ASI 发展', 'Advance toward ASI through fractal, self-similar agent organizations'), rules: L('人员加入需管理员邀请（P3 开放）；主机通过一次性邀请码接入', 'People join by admin invitation (P3); hosts join with one-time invitations'), members: 5, agents: 9, hosts: 4, updatedAt: now - 12 * MIN, relation: 'member' },
      { id: 'net-translate', chainId: chainId(model, 'net-translate'), name: L('开放翻译协作社', 'Open Translation Circle'), mission: L('让开源文档以多种语言同步更新', 'Keep open-source documentation current in many languages'), rules: L('提交一个经验收的翻译成果后，可申请贡献者资格', 'Contributors qualify after one accepted translation'), members: 14, agents: 23, hosts: 11, updatedAt: now - 3 * HOUR, relation: 'none' },
      { id: 'net-folding', chainId: chainId(model, 'net-folding'), name: L('开放蛋白质折叠实验室', 'Open Folding Lab'), mission: L('用开放算力复现并改进蛋白质结构预测', 'Reproduce and improve protein structure prediction with open compute'), rules: L('GPU 主机需使用该组织签发的一次性主机邀请', "GPU hosts join with the organization's one-time host invitations"), members: 22, agents: 41, hosts: 37, updatedAt: now - 26 * HOUR, relation: 'none' },
      { id: 'net-tooling', chainId: chainId(model, 'net-tooling'), name: L('Sui 生态工具公会', 'Sui Tooling Guild'), mission: L('维护开放的 Sui 开发工具与示例', 'Maintain open Sui developer tools and examples'), rules: L('OKR 与验收记录公开；外部贡献走提案流程（P3 开放）', 'OKRs and acceptance records are public; outside contributions use proposals (P3)'), members: 9, agents: 12, hosts: 6, updatedAt: now - 2 * DAY, relation: 'none' },
    ];
  }

  /** Sessions an authorized host would report when scanned (J11 demo observations). */
  function observedSessions(now) {
    return {
      'host-mini': [
        { key: 'tmux:claude-refactor', name: 'claude-refactor', runtime: 'Claude Code 2.4', adapter: 'native', workspace: '~/code/fractalmind-app', identity: 'verified', agentId: 'agent-builder', startedAt: now - 3 * HOUR, task: L('重构设置页的表单校验', 'Refactoring settings form validation') },
        { key: 'tmux:codex-docs', name: 'codex-docs', runtime: 'Codex CLI 0.9', adapter: 'tmux-observe', workspace: '~/code/fractalmind-docs', identity: 'verified', startedAt: now - 50 * MIN, task: L('更新文档站链接', 'Updating docs site links') },
      ],
      'host-mbp': [
        { key: 'tmux:claude-refactor', name: 'claude-refactor', runtime: 'Claude Code 2.4', adapter: 'native', workspace: '~/code/fractalmind-app', identity: 'unverified', startedAt: now - 20 * MIN, task: L('未知（身份未核实）', 'Unknown (identity not verified)') },
      ],
      'host-build': [
        { key: 'tmux:tester-1', name: 'tester-1', runtime: 'Codex CLI 0.9', adapter: 'native', workspace: '/srv/work/fractalmind-mobile', identity: 'verified', agentId: 'agent-tester', startedAt: now - 5 * DAY, task: L('OKR：让手机可靠接手桌面任务', 'OKR: Make phone handoff reliable') },
      ],
      'host-gpu': [],
      'host-pi': [],
      'host-labs-ci': [],
      'host-labs-gpu': [],
    };
  }

  return { L, P, LABS, DEMO_RECOVERY_BODY, demoRecoveryCode, emptyOrgData, createDemoProfile, createEmptyProfile, networkDirectory, observedSessions };
});
