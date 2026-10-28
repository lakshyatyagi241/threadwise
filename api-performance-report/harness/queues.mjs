import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.ceil(p/100*s.length)-1)]};
const st=(a)=>({n:a.length,min:+Math.min(...a).toFixed(3),p50:+pct(a,50).toFixed(3),p95:+pct(a,95).toFixed(3),p99:+pct(a,99).toFixed(3),max:+Math.max(...a).toFixed(3),mean:+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(3)});
const out={};
const c=new IORedis('redis://localhost:6379',{maxRetriesPerRequest:null});
// 1. raw redis round trips (ms)
async function rt(name,fn,N=2000){const a=[];for(let i=0;i<300;i++)await fn(i);for(let i=0;i<N;i++){const t=performance.now();await fn(i);a.push(performance.now()-t)}out['redis '+name]=st(a)}
await rt('PING',()=>c.ping());
await rt('SET 100B',(i)=>c.set('perf:k'+(i%100),'x'.repeat(100)));
await rt('GET 100B',(i)=>c.get('perf:k'+(i%100)));
await c.set('perf:big','x'.repeat(100*1024));
await rt('GET 100KB',()=>c.get('perf:big'),1000);
await rt('EVAL (lua incr)',()=>c.eval("return redis.call('incr',KEYS[1])",1,'perf:ctr'),1000);
await rt('pipeline 50 SET',async(i)=>{const p=c.pipeline();for(let j=0;j<50;j++)p.set('perf:p'+j,'v');await p.exec()},500);
await c.del('perf:big','perf:ctr');
out.redisInfo={}; const info=await c.info(); for(const k of['redis_version','used_memory_human','connected_clients','maxmemory_policy','instantaneous_ops_per_sec','total_commands_processed','keyspace_hits','keyspace_misses'])out.redisInfo[k]=(info.match(new RegExp(k+':(.*)'))||[])[1]?.trim();
// 2. BullMQ probe
async function probe(label,work,N,conc){
  const q=new Queue('perf-probe-'+label,{connection:c.duplicate()});
  const addMs=[];const done=new Map();let resolve;const all=new Promise(r=>resolve=r);let cnt=0;
  const w=new Worker('perf-probe-'+label,async()=>{if(work)await new Promise(r=>setTimeout(r,work))},{connection:c.duplicate(),concurrency:conc});
  w.on('completed',(job)=>{done.set(job.id,job);if(++cnt===N)resolve()});
  await w.waitUntilReady();
  const t0=performance.now();
  for(let i=0;i<N;i++){const t=performance.now();await q.add('j',{i},{removeOnComplete:false});addMs.push(performance.now()-t)}
  await all;const total=performance.now()-t0;
  const jobs=[...done.values()];
  const wait=jobs.map(j=>j.processedOn-j.timestamp),proc=jobs.map(j=>j.finishedOn-j.processedOn),e2e=jobs.map(j=>j.finishedOn-j.timestamp);
  out['bullmq '+label]={jobs:N,concurrency:conc,simulatedWorkMs:work,enqueueMs:st(addMs),queueWaitMs:st(wait),processingMs:st(proc),endToEndMs:st(e2e),totalSec:+(total/1000).toFixed(2),jobsPerSec:+(N/(total/1000)).toFixed(1)};
  // bulk
  const t1=performance.now();await q.addBulk(Array.from({length:500},(_,i)=>({name:'b',data:{i}})));out['bullmq '+label].addBulk500Ms=+(performance.now()-t1).toFixed(1);
  await new Promise(r=>setTimeout(r,2000));
  await w.close();await q.obliterate({force:true});await q.close();
}
await probe('noop',0,1000,8);
await probe('20ms-work',20,1000,8);
await probe('20ms-work-c1',20,200,1);
// 3. real queues
const keys=await c.keys('bull:*:meta');const real=[];
for(const k of keys){const name=k.split(':')[1];if(name.startsWith('perf-probe'))continue;
  const q=new Queue(name,{connection:c.duplicate()});const cn=await q.getJobCounts('wait','active','delayed','completed','failed','paused');
  let wait=[],proc=[];const js=await q.getJobs(['completed'],0,300);
  for(const j of js){if(j.processedOn&&j.timestamp){wait.push(j.processedOn-j.timestamp);proc.push(j.finishedOn-j.processedOn)}}
  const rep=(await q.getRepeatableJobs?.().catch(()=>[]))||[];
  real.push({name,counts:cn,sampled:wait.length,waitMs:wait.length?st(wait):null,procMs:proc.length?st(proc):null,repeatables:rep.length});await q.close()}
out.realQueues=real;
fs.writeFileSync('../../../queues.json',JSON.stringify(out,null,1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).filter(([k])=>k.startsWith('redis ')||k.startsWith('bullmq'))),null,0).slice(0,3500));
console.log('real queues',real.length, JSON.stringify(real.filter(r=>r.sampled).map(r=>[r.name,r.sampled,r.waitMs.p50,r.procMs.p50])));
process.exit(0);
