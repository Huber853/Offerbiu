import { db } from './db.mjs';
import * as profiles from './candidate-profile.mjs';
import * as evaluations from './job-evaluation.mjs';
import * as materials from './application-materials.mjs';
import * as submissions from './application-submissions.mjs';
import * as privateJobs from './private-jobs.mjs';
import { resolveJob, targetId } from './job-targets.mjs';

export async function workflowRoute({userId,pathname,method,query,body,signal}) {
  const reply=(data,status=200)=>({data,status});
  if(pathname==='/api/private-jobs/preview'&&method==='POST') return reply(await privateJobs.previewPrivateJob(userId,body,{signal}));
  if(pathname==='/api/private-jobs/duplicates'&&method==='POST') return reply({items:privateJobs.duplicateJobs(userId,body,body.id||'')});
  if(pathname==='/api/private-jobs') {
    if(method==='GET') return reply(privateJobs.listPrivateJobs(userId,query));
    if(method==='POST') return reply(privateJobs.savePrivateJob(userId,body),201);
  }
  const privateMatch=pathname.match(/^\/api\/private-jobs\/([^/]+)(?:\/(history|archive))?$/);
  if(privateMatch) {
    const key=decodeURIComponent(privateMatch[1]);
    if(privateMatch[2]==='history'&&method==='GET') return reply(privateJobs.privateJobHistory(userId,key));
    if(privateMatch[2]==='archive'&&method==='POST') return reply(privateJobs.archivePrivateJob(userId,key,body));
    if(!privateMatch[2]&&method==='GET') return reply(resolveJob(userId,key));
    if(!privateMatch[2]&&method==='PUT') return reply(privateJobs.savePrivateJob(userId,body,key));
  }
  const targetMatch=pathname.match(/^\/api\/job-targets\/([^/]+)$/);
  if(targetMatch&&method==='GET') return reply(resolveJob(userId,decodeURIComponent(targetMatch[1])));
  if(pathname==='/api/candidate-profile') {
    if(method==='GET') return reply(profiles.getProfile(userId));
    if(method==='PUT') return reply(profiles.saveProfile(userId,body),Number(body.revision)===0?201:200);
    if(method==='DELETE') return reply(profiles.deleteProfile(userId));
  }
  if(pathname==='/api/candidate-profile/import'&&method==='POST') return reply(profiles.importProfile(userId,body));
  if(pathname==='/api/job-evaluations') {
    if(method==='GET') return reply(evaluations.listEvaluations(userId,query));
    if(method==='POST') {
      const result=await evaluations.evaluateJob(userId,body,{signal});
      return reply(result,result.cached?200:201);
    }
  }
  let match=pathname.match(/^\/api\/job-evaluations\/([^/]+)$/);
  if(match) {
    if(method==='GET') return reply(evaluations.getEvaluation(userId,match[1]));
    if(method==='DELETE') return reply(evaluations.deleteEvaluation(userId,match[1]));
  }
  match=pathname.match(/^\/api\/applications\/([^/]+)\/materials$/);
  if(match) {
    if(method==='GET') return reply(materials.listMaterials(userId,match[1],query));
    if(method==='POST') {
      const result=await materials.generateMaterials(userId,match[1],body,{signal});
      return reply(result,result.replayed?200:201);
    }
  }
  match=pathname.match(/^\/api\/materials\/([^/]+)(?:\/(review|create-resume))?$/);
  if(match) {
    if(!match[2]&&method==='GET') return reply(materials.getMaterial(userId,match[1]));
    if(!match[2]&&method==='PUT') return reply(materials.updateMaterial(userId,match[1],body));
    if(!match[2]&&method==='DELETE') return reply(materials.deleteMaterial(userId,match[1]));
    if(match[2]==='review'&&method==='POST') return reply(await materials.reviewMaterial(userId,match[1],body,{signal}));
    if(match[2]==='create-resume'&&method==='POST') return reply(materials.createMaterialResume(userId,match[1],body));
  }
  match=pathname.match(/^\/api\/applications\/([^/]+)\/submission-preview$/);
  if(match&&method==='GET') return reply(submissions.getSubmissionJobPreview(userId,match[1]));
  match=pathname.match(/^\/api\/applications\/([^/]+)\/submissions$/);
  if(match) {
    if(method==='GET') return reply(submissions.listSubmissions(userId,match[1],query));
    if(method==='POST') {
      const result=submissions.createSubmission(userId,match[1],body);
      return reply(result,result.replayed?200:201);
    }
  }
  match=pathname.match(/^\/api\/submissions\/([^/]+)$/);
  if(match) {
    if(method==='GET') return reply(submissions.getSubmission(userId,match[1]));
    if(method==='DELETE') return reply(submissions.deleteSubmission(userId,match[1]));
  }
  return null;
}
function unpackJson(row) {
  return Object.fromEntries(Object.entries(row).map(([key,value])=>key.endsWith('_json')
    ?[key.slice(0,-5),value===null?null:JSON.parse(value)]
    :[key,value]));
}
export function exportWorkflow(userId) {
  const profile=db.prepare('SELECT * FROM candidate_profiles WHERE user_id=?').get(userId);
  const owned=table=>db.prepare('SELECT * FROM '+table+' WHERE user_id=?').all(userId).map(unpackJson);
  return {candidate_profile:profile?unpackJson(profile):null,
    job_evaluations:owned('job_evaluations').map(row=>({...row,job_id:targetId(row)})),
    private_jobs:db.prepare('SELECT * FROM private_jobs WHERE user_id=?').all(userId).map(row=>({...row,payload:JSON.parse(row.payload)})),
    private_job_revisions:db.prepare('SELECT * FROM private_job_revisions WHERE user_id=?').all(userId).map(row=>({...row,payload:JSON.parse(row.payload)})),
    materials:owned('application_materials'),
    submissions:owned('application_submissions')};
}
