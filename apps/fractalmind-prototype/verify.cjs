// Domain regression checks for the HTML simulation; no real Sui or host connections.
// Run from any directory: node apps/fractalmind-prototype/verify.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const html = fs.readFileSync(`${__dirname}/index.html`, 'utf8');
const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1]
  .replace('applyTheme();render();translateDOM();observePresentation();', '')
  .replace(/const UI_KEY=[\s\S]*?const KEY=/,
    "const preferences={locale:'zh-CN'};function localizedText(s){return s;}const KEY=");
const storage = new Map();
const ctx = vm.createContext({
  console, assert, crypto: webcrypto, Date, Blob, URL, URLSearchParams, TextEncoder, atob, btoa,
  location: { search: '' }, setTimeout: () => 0, clearTimeout() {},
  document: { addEventListener() {} },
  localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
});
vm.runInContext(source, ctx);
vm.runInContext(`
refreshOKR=()=>{};toast=()=>{};mobileReadOnly=()=>false;go=()=>{};
const reset=()=>{state=defaults();fleet();return orgGoals()[0];};
const request=()=>makeHostRequest({name:'Review host',kind:'cloud',os:'Ubuntu · amd64',coordinator:fleet().coordinators[0].id,consent:true,desktop:true});
const confirm=(r,kind,options={})=>{assert(beginEnrollmentTx(r,kind,options));assert(settleEnrollmentTx(r,true));};
let g=reset();g.krs[1].current=73;g.communication={messages:[{text:'preserve this conversation'}]};
const preserved=JSON.stringify([g.krs,g.communication,state.tasks,state.memories]);
ensureOrganizationModel();fleet();fleet();
assert.equal(chainDemo().memberships.length,6,'fixture migration is idempotent');
assert.equal(JSON.stringify([g.krs,g.communication,state.tasks,state.memories]),preserved);
switchOrganization('DEMO-ORG-LABS');
assert.equal(orgGoals().length,0);assert.equal(orgTasks().length,0);assert.equal(orgMemories().length,0);
assert.equal(fleet().hosts.length,0);assert.equal(fleet().instances.length,0);
assert(!searchResults('73').includes('preserve this conversation'));
switchOrganization('DEMO-ORG-YUBING');assert.equal(orgGoals()[0].krs[1].current,73);
assert.equal(publicOrganizationLocator().includes('DEMO-ORG-YUBING'),true);
let r=request();assert(!r.hostId);assert.equal(chainDemo().memberships.length,6);
assert(beginEnrollmentTx(r,'request'));assert.equal(r.status,'draft');assert(!connectEnrolledHost(r));
assert(settleEnrollmentTx(r,false));assert.equal(r.status,'draft');confirm(r,'request');
currentOrg().role='member';assert(!beginEnrollmentTx(r,'approve',{fingerprint:r.device}));currentOrg().role='admin';
assert(!beginEnrollmentTx(r,'approve',{fingerprint:'wrong-device'}));
const org=r.orgId;state.orgId='DEMO-ORG-LABS';assert(!beginEnrollmentTx(r,'approve',{fingerprint:r.device}));state.orgId=org;
assert(beginEnrollmentTx(r,'approve',{fingerprint:r.device}));assert(!r.hostId,'pending tx has no membership');
assert(settleEnrollmentTx(r,true));assert(!settleEnrollmentTx(r,true),'duplicate confirmation ignored');
const h=hostById(r.hostId);assert.equal(membershipFor(h).status,'confirmed');assert(!hostAuthorized(h));
hostSetConnection(h,true);assert.equal(h.status,'pending');assert(!runHostCommand(h,'shell','','id'));
assert(!beginEnrollmentTx(r,'grant',{execute:false}));assert(beginEnrollmentTx(r,'grant',{execute:true,desktop:false}));
assert(!connectEnrolledHost(r));assert(settleEnrollmentTx(r,true));assert(!hostAuthorized(h,'desktop'));
coordinatorFor(h).connected=false;assert(!connectEnrolledHost(r));assert.equal(r.status,'authorized');
coordinatorFor(h).connected=true;chainDemo().rpc=false;assert(!connectEnrolledHost(r));assert(!hostAuthorized(h));
chainDemo().rpc=true;assert(connectEnrolledHost(r));assert(connectEnrolledHost(r));assert.equal(hostInstances(h).length,1);
assert.equal(h.status,'online');assert(runHostCommand(h,'shell','','id'));
assert(!hostDesktop(h).includes('desktop-stage'),'desktop has a separate grant');
g.hostId=h.id;g.auto=true;const before=JSON.stringify(g.krs);
assert(beginEnrollmentTx(r,'revoke'));assert(hostAuthorized(h),'pending revocation does not claim confirmation');
assert(settleEnrollmentTx(r,true));assert(!hostAuthorized(h));assert.equal(h.status,'online','connection can outlive authority');
assert(!g.auto);assert(!runHostCommand(h,'shell','','id'));assert(!heartbeat(g));assert.equal(JSON.stringify(g.krs),before);
const saved=JSON.stringify(state);state=JSON.parse(saved);fleet();assert.equal(membershipFor(hostById(h.id)).status,'revoked','reload does not regrant');
reset();r=request();r.expires=Date.now()-1;assert(!beginEnrollmentTx(r,'request'));assert.equal(r.status,'expired');
r=request();assert(beginEnrollmentTx(r,'request'));r.expires=Date.now()-1;assert(!settleEnrollmentTx(r,true));
r=request();confirm(r,'request');confirm(r,'reject');assert(!beginEnrollmentTx(r,'approve',{fingerprint:r.device}));
r=request();chainDemo().rpc=false;assert(!beginEnrollmentTx(r,'request'));chainDemo().rpc=true;
// Chain submission/approval do not require the Coordinator transport to be up.
coordinatorFor(fleet().hosts[0]).connected=false;confirm(r,'request');confirm(r,'approve',{fingerprint:r.device});
mobileReadOnly=()=>true;assert(!beginEnrollmentTx(r,'grant',{execute:true}));mobileReadOnly=()=>false;
confirm(r,'grant',{execute:true});const grant=grantFor(hostById(r.hostId));grant.expires=Date.now()-1;
assert(!connectEnrolledHost(r));
// Pre-upgrade user-added hosts must not inherit fixture authority.
reset();state.fleet.hosts.push({...state.fleet.hosts[0],id:'old-custom',device:undefined,authorityMigrated:undefined});
fleet();assert.equal(hostById('old-custom').status,'pending');assert(!membershipFor(hostById('old-custom')));
`, ctx);
console.log('PASS: migration, organization isolation, pending/failed/duplicate transactions, signer and fingerprint checks, expiry, separate grants, connectivity, revocation, reload and legacy admission');

vm.runInContext(`(async()=>{
reset();
const create=async(options={})=>{const i=await prepareHostInvite({coordinator:'home',...options});const code=inviteSecrets.get(i.id);assert(confirmHostInvite(i));return {i,code};};
const redeem=async(code,values={})=>prepareInviteRedemption(code,{name:'Invite host',consent:true,...values});
let pending=await prepareHostInvite({coordinator:'home'}),code=inviteSecrets.get(pending.id);
await assert.rejects(()=>redeem(code),/INVITE_PENDING/);
assert(confirmHostInvite(pending));let i=pending;
assert(!JSON.stringify(state).includes(code),'raw code is not persisted or exported');
assert(!JSON.stringify(state).includes(inviteParse(code).secret),'invitation private key stays out of public state');
currentOrg().role='member';await assert.rejects(()=>prepareHostInvite({coordinator:'home'}),/INVITE_PERMISSION/);
// Possession can enroll a device without a fresh administrator approval.
let tx=await redeem(code);assert.equal(tx.status,'pending');assert.equal(i.status,'active');
const count=chainDemo().memberships.length;
let r=await confirmInviteRedemption(tx);assert.equal(chainDemo().memberships.length,count+1);
assert.equal(i.status,'consumed');assert.equal(r.status,'authorized');assert(hostAuthorized(hostById(r.hostId)));
assert(!hostAuthorized(hostById(r.hostId),'desktop'));
await assert.rejects(()=>redeem(code),/INVITE_USED/);await assert.rejects(()=>confirmInviteRedemption(tx),/INVITE_USED/);
currentOrg().role='admin';({i,code}=await create());i.expires=Date.now()-1;await assert.rejects(()=>redeem(code),/INVITE_EXPIRED/);
({i,code}=await create());assert(revokeHostInvite(i));await assert.rejects(()=>redeem(code),/INVITE_REVOKED/);
({i,code}=await create());tx=await redeem(code);await assert.rejects(()=>confirmInviteRedemption(tx,false),/INVITE_FAILED/);assert.equal(i.status,'active');
tx=await redeem(code);r=await confirmInviteRedemption(tx);assert.equal(i.status,'consumed');
({i,code}=await create());const first=await redeem(code),second=await redeem(code);
const membersBefore=chainDemo().memberships.length,grantsBefore=chainDemo().grants.length;
const concurrent=await Promise.allSettled([confirmInviteRedemption(first),confirmInviteRedemption(second)]);
assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1,'concurrent redeemers cannot both win');
assert.equal(chainDemo().memberships.length,membersBefore+1);assert.equal(chainDemo().grants.length,grantsBefore+1);
for(const mutate of [t=>t.sender='other-device',t=>{t.payload.device='other-device';t.sender='other-device';},t=>t.payload.orgId='DEMO-ORG-LABS',t=>t.payload.network='OTHER-NETWORK',t=>t.proof=t.proof.slice(4)+'AAAA']){
 ({i,code}=await create());tx=await redeem(code);mutate(tx);await assert.rejects(()=>confirmInviteRedemption(tx),/INVITE_PROOF/);assert.equal(i.status,'active');
}
({i,code}=await create());tx=await redeem(code);i.scope='expanded workspace';await assert.rejects(()=>confirmInviteRedemption(tx),/INVITE_SCOPE/);assert.equal(i.status,'active');
({i,code}=await create());tx=await redeem(code);revokeHostInvite(i);await assert.rejects(()=>confirmInviteRedemption(tx),/INVITE_REVOKED/);
({i,code}=await create());tx=await redeem(code);i.expires=Date.now()-1;await assert.rejects(()=>confirmInviteRedemption(tx),/INVITE_EXPIRED/);
({i,code}=await create());tx=await redeem(code);chainDemo().rpc=false;await assert.rejects(()=>confirmInviteRedemption(tx),/INVITE_RPC/);assert.equal(tx.status,'pending');
chainDemo().rpc=true;fleet().coordinators.find(c=>c.id==='home').connected=false;r=await confirmInviteRedemption(tx);assert.equal(r.status,'authorized');assert(!connectEnrolledHost(r));assert.equal(i.status,'consumed');
fleet().coordinators.find(c=>c.id==='home').connected=true;assert(connectEnrolledHost(r));assert.equal(i.status,'consumed');
({i,code}=await create({desktop:true}));tx=await redeem(code,{desktop:false});r=await confirmInviteRedemption(tx);assert(!hostAuthorized(hostById(r.hostId),'desktop'),'local device consent limits preauthorization');
({i,code}=await create());const record=JSON.stringify(i);inviteSecrets.clear();state=JSON.parse(JSON.stringify(state));assert.equal(JSON.stringify(inviteById(i.id)),record,'public invite survives reload without secret');
await assert.rejects(()=>redeem('123456'),/INVITE_INVALID/);
})()`, ctx).then(()=>console.log('PASS: invitation secrecy, prior approval, one-time atomic redemption, races, proof/device/org/network binding, permissions, expiry, revocation, failure/retry, offline recovery and reload')).catch(error=>{console.error(error);process.exitCode=1;});

const identityStorage = new Map();
const identityCtx = vm.createContext({
  console, assert, crypto: webcrypto, Date, Blob, URL, URLSearchParams, TextEncoder, atob, btoa,
  location: { search: '' }, setTimeout: () => 0, clearTimeout() {},
  document: { addEventListener() {} },
  localStorage: { getItem: k => identityStorage.get(k) || null, setItem: (k, v) => identityStorage.set(k, v) },
});
vm.runInContext(source, identityCtx);
vm.runInContext(`(async()=>{
state=defaults();fleet();
const original=JSON.stringify([state.goals,state.tasks,state.memories,state.organizationRegistry]);
let m=identityModel();const human=m.id,root=m.currentDevice;
identityModel();assert.equal(m.devices.length,1,'idempotent fixture migration');
assert(identityAllowed('manage'));assert(identityDataReady());
const r=identityRequest('iOS','Review phone');
assert.throws(()=>identityBegin('add',r.id),/配对/);r.status='scanned';
let tx=identityBegin('add',r.id,{operate:false,shareData:true,days:7});
assert(!m.devices.some(d=>d.id===r.deviceId),'no pending grant');
assert(!identitySettle(tx.id,false));assert.equal(m.devices.length,1);
tx=identityBegin('add',r.id,{operate:false,shareData:true,days:7});
chainDemo().rpc=false;assert(!identitySettle(tx.id));assert.equal(tx.status,'pending');
chainDemo().rpc=true;assert(identitySettle(tx.id));assert(!identitySettle(tx.id),'no duplicate grant');
const phone=m.devices.find(d=>d.id===r.deviceId);assert.equal(phone.dataOrgs.length,0);
m.currentDevice=phone.id;assert(!identityAllowed('operate'));assert(!canOperate());assert(identityAllowed('read'));assert(!identityDataReady());
assert.throws(()=>identityBegin('rotate',''),/权限/);
await assert.rejects(()=>prepareHostInvite({coordinator:'home'}),/INVITE_PERMISSION/);
m.currentDevice=root;assert(identitySyncData(phone.id));m.currentDevice=phone.id;assert(identityDataReady());
state.orgId='DEMO-ORG-LABS';assert(!identityAllowed('read'));assert(!identityDataReady());state.orgId='DEMO-ORG-YUBING';
m.currentDevice=root;const added=identityRequest('Ubuntu','Ubuntu');added.status='scanned';added.expires=Date.now()-1;assert.throws(()=>identityBegin('add',added.id),/配对/);
const stale=identityRequest('Android','Android');stale.status='scanned';let pending=identityBegin('add',stale.id,{operate:true});stale.expires=Date.now()-1;assert(!identitySettle(pending.id));
let revoke=identityBegin('revoke',phone.id);assert(identityDeviceActive(phone));assert(identitySettle(revoke.id));assert(!identityDeviceActive(phone));assert.equal(phone.dataOrgs.length,1,'revocation cannot erase acquired keys');
m.currentDevice=phone.id;assert(!identityAllowed('read'));assert(!identityDataReady());m.currentDevice=root;
let code=await identityCreateKit();assert(!JSON.stringify(state).includes(code));assert(!JSON.stringify(state).includes(code.slice('DEMO-RECOVERY-'.length)));
assert(identityKitText().includes(code));m.recovery.saved=true;
await assert.rejects(()=>identityRecover('DEMO-RECOVERY-wrong'),/恢复码/);
chainDemo().rpc=false;await assert.rejects(()=>identityRecover(code),/Sui/);chainDemo().rpc=true;
// Reload retains public recovery metadata, not raw secrets.
state=JSON.parse(JSON.stringify(state));recoverySecrets.clear();assert.equal(identityKitText(),null);m=identityModel();
const next=identityRequest('Windows','Windows');next.status='scanned';pending=identityBegin('add',next.id,{operate:true});
m.lost=true;m.locked=true;assert(!identityAllowed('manage'));assert(!identityDataReady());
const recovered=await identityRecover(code);assert.equal(m.id,human);assert(m.devices.filter(d=>d.id!==recovered.id).every(d=>d.status==='revoked'));
assert.equal(pending.status,'cancelled');assert(!identitySettle(pending.id));assert(identityAllowed('manage'));assert(!identityDataReady());
assert(identityRestoreData());assert(identityDataReady());assert(!identityRestoreData(),'data restore is idempotent');
assert.equal(JSON.stringify([state.goals,state.tasks,state.memories,state.organizationRegistry]),original,'recovery preserves organizations, roles and all work');
await assert.rejects(()=>identityRecover(code),/恢复码/);
assert.equal(m.recovery,null,'recovery consumes the authorization credential');
const old=await identityCreateKit();const replacement=await identityCreateKit();m.recovery.saved=true;await assert.rejects(()=>identityRecover(old),/恢复码/);assert(!JSON.stringify(state).includes(replacement));
m.locked=true;assert(!identityAllowed('operate'));assert(!identityDataReady());m.locked=false;
state=defaults();state.phonePaired=true;delete state.phoneAccess;identityModel();identityModel();assert.equal(identityModel().devices.length,2);assert.equal(identityModel().devices[1].operate,false);
console.log('PASS: identity migration, device grants, pending/failure/retry, read-only and organization scopes, independent data sync, expiry, revocation, recovery secrecy, reload, rotation and preserved work');
})()`, identityCtx).catch(error=>{console.error(error);process.exitCode=1;});

// New installs start without an authenticated Human; profile data stays isolated.
const entryStorage = new Map();
const entryCtx = vm.createContext({
  console, assert, crypto: webcrypto, Date, Blob, URL, URLSearchParams, TextEncoder, atob, btoa,
  location: { search: '' }, setTimeout: () => 0, clearTimeout() {},
  document: { addEventListener() {} },
  localStorage: { getItem: k => entryStorage.get(k) || null, setItem: (k,v) => entryStorage.set(k,v) },
});
vm.runInContext(source, entryCtx);
vm.runInContext(`(async()=>{
assert(state.entry.signedOut);assert(state.entry.fresh);assert.equal(identityModel().id,'');assert(!state.identityDemo);
assert(!identityAllowed('operate'));assert(!identityAllowed('manage'));assert(!identityDataReady());
assert.throws(()=>entryPairStart('iOS','Phone'),/恢复包/);
// Preserve the previously reviewed profile while a different Human is created.
state=defaults();ensureOrganizationModel();identityModel();state.goals[0].description='preserved review';state.entry={signedOut:true};save();
const original=JSON.stringify([state.goals,state.tasks,state.memories,state.organizationRegistry,state.identityDemo]);
let registration=entryCreate('New Human','Ubuntu','system');assert.equal(identityModel().id,'DEMO-HUMAN-YUBING');assert(!identityAllowed('manage'));
chainDemo().rpc=false;assert(!entryConfirmCreation());assert.equal(registration.status,'pending');chainDemo().rpc=true;
assert(!entryConfirmCreation(false));assert.equal(registration.status,'failed');assert(!entryConfirmCreation());
registration=entryCreate('New Human','Ubuntu','system');assert(entryConfirmCreation());assert(!entryConfirmCreation());
const archived=JSON.parse(localStorage.getItem(KEY));
assert.equal(JSON.stringify([archived.goals,archived.tasks,archived.memories,archived.organizationRegistry,archived.identityDemo]),original);
assert.notEqual(profileKey,KEY);assert.equal(identityModel().id,registration.id);assert.equal(state.organizationRegistry.length,0);assert.equal(state.orgId,'');
assert.equal(state.goals.length,0);assert.equal(state.tasks.length,0);assert.equal(state.memories.length,0);assert.equal(fleet().hosts.length,0);assert.equal(fleet().coordinators.length,0);
assert(identityAllowed('manage'));assert(!identityAllowed('operate'));
const kit=await identityCreateKit();identityModel().recovery.saved=true;assert(!JSON.stringify(state).includes(kit));
const org=entryCreateOrganization('New organization');assert(identityAllowed('operate'));assert.equal(state.organizationRegistry.length,1);assert.throws(()=>entryCreateOrganization('Duplicate'),/权限/);
state.entry={signedOut:true};assert(!identityAllowed('read'));assert(!identityDataReady());
let request=entryPairStart('Android','Readonly phone');assert(state.entry.signedOut);assert.equal(identityModel().devices.length,1);
request.expires=Date.now()-1;assert.throws(()=>entryPairApprove(),/过期/);assert(state.entry.signedOut);
request=entryPairStart('Android','Readonly phone');entryPairApprove(false);assert(state.entry.signedOut);assert(!identityAllowed('read'));
const added=identityModel().devices.find(d=>d.id===request.deviceId);assert(!added.manage);assert(!added.operate);assert.deepEqual(added.orgs,[org.id]);assert.equal(added.dataOrgs.length,0);
entryPairFinish();assert(identityDataReady());assert(identityAllowed('read'));assert(!identityAllowed('operate'));assert(!identityAllowed('manage'));
state.entry={signedOut:true};await assert.rejects(()=>identityRecover('DEMO-RECOVERY-wrong'));assert(state.entry.signedOut);
await identityRecover(kit);assert(state.entry.signedOut,'recovery domain does not silently log in the session');state.entry.signedOut=false;
assert(identityAllowed('manage'));assert(!identityDataReady());assert(identityRestoreData());assert(identityDataReady());
assert.equal(state.organizationRegistry[0].id,org.id);assert.equal(identityModel().id,registration.id);
entryLoadDemo();assert(state.entry.signedOut);assert.equal(identityModel().id,'DEMO-HUMAN-YUBING');assert.equal(state.goals[0].description,'preserved review');
console.log('PASS: unauthenticated fresh install, pending/failed registration, isolated new identity and organization, preserved profile, trusted-device pairing, read-only access and signed-out recovery');
})()`,entryCtx).catch(error=>{console.error(error);process.exitCode=1;});

// Importing a discovered runtime must not turn observation into execution authority.
const discoveryCtx = vm.createContext({
  console, assert, crypto: webcrypto, Date, Blob, URL, URLSearchParams, TextEncoder, atob, btoa,
  location: { search: '' }, setTimeout: () => 0, clearTimeout() {},
  document: { addEventListener() {} },localStorage:{getItem:()=>null,setItem(){}},
});
vm.runInContext(source,discoveryCtx);
vm.runInContext(`
state=defaults();fleet();identityModel();
const h=hostById('mini-studio'),g=orgGoals()[0],original=JSON.stringify([state.goals,state.tasks,state.fleet.instances]);
let rows=discoveryScan(h.id);assert.equal(rows.length,3);
currentOrg().role='member';assert.throws(()=>discoveryBegin('import',rows[0].key),/管理设备/);currentOrg().role='admin';
let tx=discoveryBegin('import',rows[0].key);assert.equal(discoveredImports().length,0);assert(!discoverySettle(tx.id,false));assert.equal(discoveredImports().length,0);
tx=discoveryBegin('import',rows[0].key);assert(discoverySettle(tx.id));assert(!discoverySettle(tx.id));
assert.equal(JSON.stringify([state.goals,state.tasks,state.fleet.instances]),original,'observe import does not modify running work');
let r=discoveredImports()[0];assert.equal(r.mode,'observe');assert.throws(()=>discoveryBegin('import',rows[0].key),/已经导入/);
assert.throws(()=>discoveryBegin('import',rows[2].key),/未核实/);
rows[1].observedAt-=6*60000;assert.throws(()=>discoveryBegin('import',rows[1].key),/过期/);
rows=discoveryScan(h.id);tx=discoveryBegin('import',rows[1].key);assert(discoverySettle(tx.id));const observer=discoveredImports()[1];assert.throws(()=>discoveryBegin('manage',observer.id,g.id),/仅支持观察/);
rows=discoveryScan('cloud-sg');tx=discoveryBegin('import',rows[0].key);assert(discoverySettle(tx.id));assert.notEqual(discoveredImports()[2].agentId,r.agentId,'same name on another Host is a separate identity');
identityModel().locked=true;assert.throws(()=>discoveryScan(h.id),/权限/);assert.throws(()=>discoveryBegin('manage',r.id,g.id),/管理设备/);identityModel().locked=false;
tx=discoveryBegin('manage',r.id,g.id);const oldBudget=g.budget;g.budget++;assert(!discoverySettle(tx.id));assert.equal(r.mode,'observe');g.budget=oldBudget;
tx=discoveryBegin('manage',r.id,g.id);assert(discoverySettle(tx.id));assert.equal(g.owner,r.agentId);assert.equal(g.hostId,h.id);assert.equal(g.auto,false);assert(g.manualPause);assert(discoveryManaged(r,g));assert.equal(assignedInstance(g).importId,r.id);
g.budget++;assert(!discoveryManaged(r,g));assert.equal(hostExecutionProblem(g).id,'host-scope');assert(!runHostCommand(h,'restart',r.key,''));
tx=discoveryBegin('manage',r.id,g.id);assert(discoverySettle(tx.id));assert(discoveryManaged(r,g));assert.equal(state.fleet.instances.filter(i=>i.importId===r.id).length,1);
const beforeOffline=discoveryModel().snapshots[h.id].at;h.status='offline';assert.throws(()=>discoveryScan(h.id),/失联/);assert.equal(discoveryModel().snapshots[h.id].at,beforeOffline);assert.equal(discoveryStatus(r),'主机失联 · 状态未知');h.status='online';
state.orgId='DEMO-ORG-LABS';assert.equal(discoveredImports().length,0);assert.equal(discoveryCandidate(r.key),undefined);assert.throws(()=>discoveryBegin('manage',r.id,g.id));
state.orgId=h.orgId;state=JSON.parse(JSON.stringify(state));assert.equal(discoveredImports().length,3);assert.equal(discoveryRecord(r.id).agentId,r.agentId);
assert.equal(discoveryScan(h.id,'empty').length,0);assert.equal(discoveredImports().length,3,'empty scan does not delete confirmed identities');
assert.equal(discoveryStatus(discoveryRecord(r.id)),'观测已失效 · 需要重新发现');assert.equal(hostExecutionProblem(orgGoals()[0]).id,'unknown');
console.log('PASS: discovery permissions, stale/unverified/offline observations, atomic imports, duplicate prevention, name isolation, observation-only adapters, constrained OKR handoff, stale grant blocking, reconfirmation and reload');
`,discoveryCtx);
