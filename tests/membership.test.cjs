const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const base = path.resolve(__dirname,"../mini-program");
const tick = () => new Promise(r=>setImmediate(r));
function setup() {
  const storage = new Map();
  const requests=[];
  const app={globalData:{openid:"owner",sessionToken:"token",nativeAdUnits:{home:"adunit-home123"}},ensureLogin:async()=>true,appConfigReady:Promise.resolve()};
  const wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),requestVirtualPayment(){},getAppBaseInfo:()=>({version:"8.0.68"}),getDeviceInfo:()=>({platform:"ios"})};
  const api={request:(route)=>new Promise((resolve,reject)=>requests.push({route,resolve,reject})),unwrap:r=>{if(r.code!==200)throw Error("query failed");return r.data;}};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(base,"utils/membership.js"),"utf8"),{module,wx,require:()=>api,Set});
  return {m:module.exports,app,wx,storage,requests};
}
function resolve(request,data) { request.resolve({code:200,data:{isLifetimeMember:false,adFree:false,unlimitedSaves:false,priceFen:990,purchaseEnabled:true,iosEnabled:true,...data}}); }
test('旧部署明确未开放会员时，不请求会员接口，不授予权益，也不自动登录', async () => {
 const e=setup();let logins=0;
 e.app.globalData.membershipEnabled=false;e.app.ensureLogin=async()=>{logins++;};
 const state=await e.m.refresh(e.app);
 assert.equal(state.available,false);assert.equal(state.known,false);assert.equal(state.isLifetimeMember,false);
 assert.equal(e.requests.length,0);assert.equal(logins,0);assert.equal(e.m.canShowAds(),false);
});
test('会员能力等待配置返回，未开放也不能略过已有订单的恢复查询', async () => {
 const e=setup();let ready;
 e.app.appConfigReady=new Promise(r=>{ready=r;});e.app.globalData.membershipEnabled=false;
 e.m.setPending('owner','M123');
 const result=e.m.refresh(e.app);await tick();assert.equal(e.requests.length,0);
 ready();await tick();assert.equal(e.requests[0].route,'/api/member/orders/M123');
 resolve(e.requests[0],{orderStatus:'PENDING'});await result;
 assert.equal(e.m.current().available,true);assert.equal(e.m.canShowAds(),false);
 assert.equal(e.m.getPending('owner'),'M123');
});
for(const member of [true,false]) test(`冷启动权益确认前无广告，确认后${member?"会员仍无":"普通用户允许"}广告`,async()=>{
 const e=setup();assert.equal(e.m.canShowAds(),false);
 const p=e.m.refresh(e.app);await tick();assert.equal(e.requests.length,1);assert.equal(e.m.canShowAds(),false);
 resolve(e.requests[0],{isLifetimeMember:member,adFree:member});await p;
 assert.equal(e.m.canShowAds(),!member);
});
test("未知状态、离线、旧接口缺少会员字段均不得展示广告",async()=>{
 const e=setup();let p=e.m.refresh(e.app);await tick();e.requests[0].reject(Error("offline"));await assert.rejects(p);assert.equal(e.m.canShowAds(),false);
 p=e.m.refresh(e.app);await tick();e.requests[1].resolve({code:200,data:{}});await assert.rejects(p);assert.equal(e.m.canShowAds(),false);
});
test("并发预检只发一次请求，失效后旧非会员响应不能恢复广告",async()=>{
 const e=setup();const a=e.m.refresh(e.app),b=e.m.refresh(e.app);assert.equal(a,b);await tick();
 e.m.invalidate();resolve(e.requests[0],{});await assert.rejects(a,/状态已变化/);assert.equal(e.m.canShowAds(),false);
});
test("账号切换时旧会员响应不会给新账号授予权益",async()=>{
 const e=setup();const p=e.m.refresh(e.app);await tick();e.app.globalData.openid="other";resolve(e.requests[0],{isLifetimeMember:true,adFree:true});await assert.rejects(p);assert.equal(e.m.current().known,false);
});
test("付款待确认抑制广告；恢复购买只查服务端订单，不信任本地会员标记",async()=>{
 const e=setup();e.m.setPending("owner","M123");const p=e.m.refresh(e.app);await tick();assert.equal(e.requests[0].route,"/api/member/orders/M123");resolve(e.requests[0],{orderStatus:"PENDING"});await p;assert.equal(e.m.canShowAds(),false);assert.equal(e.m.current().isLifetimeMember,false);
 const q=e.m.refresh(e.app,true);await tick();resolve(e.requests[1],{orderStatus:"ACTIVE",isLifetimeMember:true,adFree:true});await q;assert.equal(e.m.getPending("owner"),"");assert.equal(e.m.canShowAds(),false);
});
test("退款确认清除恢复线索，回到普通用户权益",async()=>{
 const e=setup();e.m.setPending("owner","M123");const p=e.m.refresh(e.app);await tick();resolve(e.requests[0],{orderStatus:"REFUNDED"});await p;assert.equal(e.m.getPending("owner"),"");assert.equal(e.m.canShowAds(),true);
});
test("iOS 要求 8.0.68、IAP 开通，已购权益无需支付能力",()=>{
 const e=setup();assert.equal(e.m.paymentSupport({iosEnabled:true}),"");assert.match(e.m.paymentSupport({iosEnabled:false}),/暂不支持/);
 e.wx.getAppBaseInfo=()=>({version:"8.0.67"});assert.match(e.m.paymentSupport({iosEnabled:true}),/暂不支持/);
 e.wx.getAppBaseInfo=()=>({version:"8.0.69"});assert.equal(e.m.paymentSupport({iosEnabled:true}),"");
});
function component(e) {
 let def;
 vm.runInNewContext(fs.readFileSync(path.join(base,"components/member-ad/index.js"),"utf8"),{Component:d=>def=d,getApp:()=>e.app,require:n=>n.endsWith("membership")?e.m:require("../mini-program/utils/rewarded-video")});
 const c={...def.methods,data:{...def.data,placement:"home"},setData(v,cb){Object.assign(this.data,v);this.renders.push({...this.data});if(cb)cb();},renders:[]};def.lifetimes.attached.call(c);return {c,def};
}
test("真实广告组件会员预检后从未挂载广告；刷新返回会员也无中途闪现",async()=>{
 const e=setup();const {c,def}=component(e);await tick();resolve(e.requests[0],{isLifetimeMember:true,adFree:true});await tick();assert.equal(c.renders.some(d=>d.allowed),false);
 def.pageLifetimes.show.call(c);await tick();assert.equal(c.data.allowed,false);resolve(e.requests[1],{isLifetimeMember:true,adFree:true});await tick();assert.equal(c.renders.some(d=>d.allowed),false);def.lifetimes.detached.call(c);
});
test("普通用户仅在确认后挂载组件，隐藏页面与权益失效立即关闭，卸载不再写状态",async()=>{
 const e=setup();const {c,def}=component(e);await tick();assert.equal(c.data.allowed,false);resolve(e.requests[0],{});await tick();assert.equal(c.data.allowed,true);def.pageLifetimes.hide.call(c);assert.equal(c.data.allowed,false);e.m.invalidate();assert.equal(c.data.allowed,false);def.lifetimes.detached.call(c);const count=c.renders.length;e.m.invalidate();assert.equal(c.renders.length,count);
});
test("会员点击额度不足后的保存路径不创建视频实例或请求广告位",async()=>{
 let def,played=0,adIds=0;
 const e=setup();const member={refresh:async()=>({isLifetimeMember:true}),canShowAds:()=>false};
 const app={globalData:{openid:"owner"},getRewardedVideoAdUnitId:()=>{adIds++;}};
 vm.runInNewContext(fs.readFileSync(path.join(base,"pages/export/export.js"),"utf8"),{Page:d=>def=d,getApp:()=>app,require:n=>n.endsWith("membership")?member:{},wx:{}});
 const page={...def,_videoPlayer:{play:()=>played++}};
 assert.equal(await page.watchAdForSave("owner"),true);assert.equal(played,0);assert.equal(adIds,0);
});

function purchasePage({ confirmed = false, cancel = false }={}) {
 let def, pending="", payments=0, creates=0;
 const state={known:true,isLifetimeMember:false,adFree:false,priceFen:990,purchaseEnabled:true,iosEnabled:false};
 const app={globalData:{openid:"owner"}};
 const membership={refresh:async()=>({...state,isLifetimeMember:confirmed && payments>0}),paymentSupport:()=>"",getPending:()=>pending,setPending:(_owner,id)=>{pending=id;}};
 vm.runInNewContext(fs.readFileSync(path.join(base,"pages/member/member.js"),"utf8"),{
   Page:d=>def=d,getApp:()=>app,wx:{},setTimeout:fn=>fn(),
   require:n=>n.endsWith("membership")?membership:n.endsWith("/api")?{request:async()=>{creates++;return {code:200,data:{outTradeNo:"M123",payData:{mode:"short_series_goods"}}};},unwrap:r=>r.data}:{call:async(method)=>{if(method==="login")return {code:"code"};payments++;if(cancel)throw {errCode:-2};return {};}}
 });
 const page={...def,data:{...def.data,checking:false,statusKnown:true,purchaseEnabled:true,agreed:true},setData(v){Object.assign(this.data,v);}};
 return {page,counts:()=>({pending,payments,creates})};
}
test("支付 success 但服务端未确认时不授予会员，保留恢复单号且禁止重复付款",async()=>{
 const {page,counts}=purchasePage();const buying=page.buy();await page.buy();await buying;await tick();
 assert.equal(page.data.isMember,false);assert.equal(page.data.pendingOrder,true);assert.equal(counts().creates,1);assert.equal(counts().payments,1);assert.equal(counts().pending,"M123");
 await page.buy();assert.equal(counts().creates,1);
});
test("只有服务端确认后显示已开通，明确取消会保留提示并允许重新购买",async()=>{
 const good=purchasePage({confirmed:true});await good.page.buy();await tick();assert.equal(good.page.data.isMember,true);
 const cancelled=purchasePage({cancel:true});await cancelled.page.buy();await tick();assert.equal(cancelled.page.data.isMember,false);assert.equal(cancelled.counts().pending,"");assert.match(cancelled.page.data.error,/取消/);
});

test('会员查询失败不展示默认价格或未开放状态，重试不创建支付订单', async () => {
  let definition, answer = Error('登录失败，请重试'), requests = 0, orders = 0;
  const state = { isLifetimeMember: false, priceFen: 990, purchaseEnabled: false };
  const m = { refresh: async () => { requests++; if (answer instanceof Error) throw answer; return answer; }, getPending: () => '', paymentSupport: () => '' };
  vm.runInNewContext(fs.readFileSync(path.join(base, 'pages/member/member.js'), 'utf8'), {
    Page: d => definition = d, getApp: () => ({ globalData: {} }),
    require: name => name.endsWith('/membership') ? m : name.endsWith('/api') ? { request() { orders++; } } : {},
  });
  const page = { ...definition, data: { ...definition.data }, setData(value, done) { Object.assign(this.data, value); done?.(); } };
  await page.reload();
  assert.equal(page.data.statusKnown, false);
  assert.equal(page.data.price, '');
  assert.equal(page.data.checking, false);
  assert.match(page.data.error, /登录失败/);
  answer = state;
  await page.primaryAction();
  assert.equal(requests, 2);
  assert.equal(page.data.statusKnown, true);
  assert.equal(page.data.price, '9.90');
  assert.equal(page.data.purchaseEnabled, false);
  assert.equal(page.data.error, '');
  await page.primaryAction();
  assert.equal(orders, 0);
  answer = Error('offline');
  await page.reload();
  assert.equal(page.data.statusKnown, false);
  assert.equal(page.data.purchaseEnabled, false);
  answer = { ...state, priceFen: undefined };
  await page.primaryAction();
  assert.equal(page.data.statusKnown, false);
  assert.match(page.data.error, /会员信息/);
});

test('未同意协议不能下单，协议详情可展开且不会隐式勾选', async () => {
  const { page, counts } = purchasePage();
  page.data.agreed = false;
  await page.primaryAction();
  assert.equal(counts().creates, 0);
  assert.match(page.data.error, /勾选/);
  page.setData = function(value, done) { Object.assign(this.data, value); done?.(); };
  page.showTerms();
  assert.equal(page.data.termsExpanded, true);
  assert.equal(page.data.termsAnchor, 'member-terms');
  assert.equal(page.data.agreed, false);
  page.toggleAgreement();
  assert.equal(page.data.agreed, true);
});

test('未开放会员显示独立状态；重新查询失败不能残留未开放或购买按钮', async () => {
 let definition, home=0, answer={available:false};
 const m={refresh:async()=>{if(answer instanceof Error)throw answer;return answer;}};
 vm.runInNewContext(fs.readFileSync(path.join(base,'pages/member/member.js'),'utf8'),{
  Page:d=>definition=d,getApp:()=>({globalData:{}}),wx:{switchTab:()=>home++},require:n=>n.endsWith('/membership')?m:{}
 });
 const page={...definition,data:{...definition.data},setData(v){Object.assign(this.data,v);}};
 await page.reload();assert.equal(page.data.unavailable,true);assert.equal(page.data.price,'');assert.equal(page.data.error,'');
 page.primaryAction();assert.equal(home,1);
 answer=Error('offline');await page.reload();assert.equal(page.data.unavailable,false);
 assert.equal(page.data.statusKnown,false);assert.equal(page.data.purchaseEnabled,false);assert.match(page.data.error,/offline/);
});

for(const [completed,pending] of [[true,false],[false,false],[true,true]]) test(`未开放会员时奖励保存仍要求完整观看及服务端记录 completed=${completed} pending=${pending}`,async()=>{
 let definition,plays=0,records=0;
 const app={globalData:{openid:'owner',membershipEnabled:false},getRewardedVideoAdUnitId:async()=> 'adunit-valid123'};
 const m={refresh:async()=>({available:false,isLifetimeMember:false}),canShowAds:()=>false,getPending:()=>pending?'M123':''};
 const api={request:async(route)=>{assert.equal(route,'/api/user/recordAd');records++;return {code:200};},unwrap:r=>r};
 vm.runInNewContext(fs.readFileSync(path.join(base,'pages/export/export.js'),'utf8'),{
  Page:d=>definition=d,getApp:()=>app,wx:{},require:n=>n.endsWith('/membership')?m:n.endsWith('/api')?api:{}
 });
 const page={...definition,data:{...definition.data},setData(v){Object.assign(this.data,v);},showAdDialog:async()=>true,_videoPlayer:{play:async()=>{plays++;return completed;}}};
 if(pending){await assert.rejects(page.watchAdForSave('owner'),/付款状态/);assert.equal(plays,0);assert.equal(records,0);}
 else {assert.equal(await page.watchAdForSave('owner'),completed);assert.equal(plays,1);assert.equal(records,completed?1:0);}
});
