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
  console, assert, crypto: webcrypto, Date, Blob, URL, URLSearchParams,
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
