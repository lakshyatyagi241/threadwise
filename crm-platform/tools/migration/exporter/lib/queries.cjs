'use strict';
// The fixed read-only queries bin/mongo-eval.cjs can run. No other query can be run through it.
const j = JSON.stringify;

const QUERIES = {
  core: (ws) => ({
    db: 'geta_core',
    expr: `(()=>{const w=db.workspace.findOne({workspace_id:${j(ws)}});if(!w)return "@@CORE@@"+JSON.stringify({error:"no workspace"});
const b=db.business.findOne({id:w.business_id})||{};const sd=b.subscription_data||{};
const tops=db.reseller_credit_logs.find({to_workspace:${j(ws)}}).sort({transaction_datetime:1}).toArray().map(r=>({action:r.action,added:r.credits_added,removed:r.credits_removed,at:r.transaction_datetime}));
const wev=db.reseller_credit_logs.find({$or:[{from_workspace:${j(ws)}},{to_workspace:${j(ws)}}]}).sort({transaction_datetime:1}).toArray().map(r=>{const inn=r.to_workspace===${j(ws)};const prev=inn?r.to_previous_balance:r.from_previous_balance;const upd=inn?r.to_updated_balance:r.from_updated_balance;return {src:'reseller',id:String(r.id||r._id),at:r.transaction_datetime,delta:Math.round((upd-prev)*10000)/10000,prev:prev,reason:r.reason||null};});
return "@@CORE@@"+JSON.stringify({walletEvents:wev,workspace:{id:w.workspace_id,businessId:w.business_id,status:w.status,timezone:w.timezone,primaryLanguage:w.primary_language,provider:w.meta_provider,credits:w.credits},
business:{id:b.id,name:b.name,domain:b.domain,schemaName:b.schema_name},subscription:{id:sd.subscription_id,planCode:sd.plan_code,name:sd.name,status:sd.status,amount:sd.amount,subTotal:sd.sub_total,interval:sd.interval,intervalUnit:sd.interval_unit,activation:sd.activation_date,lastBilling:sd.last_billing_date,nextBilling:sd.next_billing_date,customerId:sd.customer_id,quantity:sd.quantity,discount:sd.discount,config:(sd.config||[]).map(c=>({code:c.code,name:c.name,status:c.status,limit:c.limit,visible:c.is_visible}))},sub:(function(){const s=db.subscriptions.findOne({subscription_id:sd.subscription_id})||{};return {number:s.subscription_number,invoiceId:s.invoice_id,paymentMethod:s.associated_payment_method,paymentTerms:s.payment_terms_label};})(),planCatalogue:(function(){const p=db.plan_permissions.findOne({plan_code:sd.plan_code})||{};return {planCode:p.plan_code,term:p.term,type:p.type,amount:p.amount,isCustom:p.is_custom};})(),topups:tops});})()`,
  }),
  expenses: (ws) => ({
    db: ws,
    expr: `(()=>{const rows=db.getCollection("credits_expenses").find({}).sort({transaction_time:1}).toArray().map(r=>({src:'expense',id:String(r.id||r._id),at:r.transaction_time,type:r.transaction_type,amount:r.total_cost,invoice:r.invoice_id||null}));return "@@EXP@@"+JSON.stringify(rows);})()`,
  }),
  settings: (ws) => ({
    db: ws,
    // the workspace settings the app has a home for: pipelines, lost reasons, consent keywords, task outcomes, and only the newest login time per user (no address, no device)
    expr: '(()=>{const day=x=>x&&x.$date?x.$date:x;const pipes=db.getCollection("deal_pipelines").find({type:"Pipeline"}).sort({created_at:1,_id:1}).toArray().map(p=>({id:p.id,name:p.name,stages:(p.stages||[]).map(s=>({id:s.id,name:s.name,probability:s.win_probability}))}));const lost=db.getCollection("deal_pipelines").find({type:"Lost_Reason"}).toArray().flatMap(d=>(d.lost_reasons||[]).map(r=>({id:r.id,reason:r.lost_reason})));const consent=db.getCollection("workspace_settings").find({type:{$in:["opt-in","opt-out"]}}).toArray().map(d=>({type:d.type,channel:d.channel,status:d.status,keywords:(d.config||{}).keywords||[],response:((d.config||{}).response||{}).value||null,responseType:(d.config||{}).type||null}));const outcomes=db.getCollection("contact_task_config").find({action_name:"task_outcomes"}).sort({_id:1}).toArray().flatMap(d=>(d.options||[]).map((o,i)=>({label:o.label,name:o.name,position:o.position===undefined?null:o.position,visible:o.visible!==false,at:i})));const logins=db.getCollection("auth_logs").aggregate([{$match:{type:"login",user_id:{$ne:null}}},{$group:{_id:"$user_id",at:{$max:"$timestamp"}}}]).toArray().map(r=>({userId:String(r._id),at:day(r.at)}));return "@@SET@@"+JSON.stringify({pipelines:pipes,lostReasons:lost,consent:consent,taskOutcomes:outcomes,lastLogins:logins})})()',
  }),
  wa: (ws) => ({
    db: ws,
    expr:
      '"@@WA@@"+JSON.stringify({botids:db.chathistory.distinct("botid"),docs:db.chatbot_misc_config.find({config_key:"META_WHATSAPP_CONFIG"},' +
      '{_id:0,chatbot_id:1,is_active:1,deleted_time:1,"config_value.phoneID":1,"config_value.display_number":1,"config_value.whatsapp_no":1,"config_value.display_name":1}).toArray()})',
  }),
};

module.exports = { QUERIES };