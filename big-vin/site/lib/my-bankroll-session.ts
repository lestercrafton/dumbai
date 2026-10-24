import {env} from 'cloudflare:workers';
import {db} from '@/lib/db';
import {normalizeEmail,readSessionCookie,verifySession,hashOtp,otpMatches,generateOtp,otpExpiryIso,signSession,sessionCookie,clearSessionCookie,OTP_MAX_ATTEMPTS} from '@/lib/my-bankroll-auth.mjs';
import {sendOtpEmail} from '@/lib/my-bankroll-email.mjs';
import {SUPPORTED_SPORTS} from '@/lib/presentation.mjs';

type AuthEnv={MY_BANKROLL_SESSION_SECRET?:string;RESEND_API_KEY?:string;MY_BANKROLL_FROM_EMAIL?:string;BIG_VIN_ADMIN_TOKEN?:string};

export function authSecret(){
 const e=env as unknown as AuthEnv;
 const s=e.MY_BANKROLL_SESSION_SECRET||e.BIG_VIN_ADMIN_TOKEN;
 if(!s||s.length<16)return null;
 return s;
}
export function resendKey(){return (env as unknown as AuthEnv).RESEND_API_KEY||null;}
export function fromEmail(){return (env as unknown as AuthEnv).MY_BANKROLL_FROM_EMAIL||null;}
export function emailConfigured(){return !!resendKey();}

export async function currentUser(request:Request){
 const secret=authSecret();if(!secret)return null;
 const token=readSessionCookie(request);if(!token)return null;
 const sess=await verifySession(token,secret);if(!sess)return null;
 const row=await db().prepare('SELECT id,email,created_at FROM my_bankroll_users WHERE id=?').bind(sess.userId).first<{id:string;email:string;created_at:string}>();
 if(!row||row.email!==sess.email)return null;
 return {id:row.id,email:row.email,createdAt:row.created_at};
}

export type StartRow={start:number;effectiveFrom:string|null};
export async function loadStarts(userId:string){
 const {results}=await db().prepare('SELECT sport,start,effective_from FROM my_bankroll_starts WHERE user_id=?').bind(userId).all<{sport:string;start:number;effective_from:string|null}>();
 const starts:Record<string,number|null>={};
 const effectiveFrom:Record<string,string|null>={};
 for(const s of SUPPORTED_SPORTS){starts[s]=null;effectiveFrom[s]=null;}
 for(const r of results||[]){
  if(!SUPPORTED_SPORTS.includes(r.sport)||!Number.isFinite(r.start)||r.start<=0)continue;
  starts[r.sport]=r.start;
  effectiveFrom[r.sport]=r.effective_from||null;
 }
 return {starts,effectiveFrom};
}

export async function requestOtp(emailRaw:string){
 const email=normalizeEmail(emailRaw);if(!email)return {ok:false as const,error:'Enter a valid email.',status:400};
 const secret=authSecret();if(!secret)return {ok:false as const,error:'Sign-in is not configured yet.',status:503};
 const database=db();
 if(!database)throw new Error('otp-db: missing D1 binding');
 const code=generateOtp();
 const codeHash=await hashOtp(code,secret);
 const now=new Date().toISOString();
 await database.prepare('INSERT INTO my_bankroll_otps (email,code_hash,expires_at,attempts,created_at) VALUES (?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,created_at=excluded.created_at')
  .bind(email,codeHash,otpExpiryIso(),0,now).run();
 const mail=await sendOtpEmail({to:email,code,from:fromEmail()||undefined,apiKey:resendKey()||undefined});
 if(mail.sent)return {ok:true as const,email,demo:false};
 return {ok:true as const,email,demo:true,demoCode:code};
}

export async function verifyOtp(emailRaw:string,code:string){
 const email=normalizeEmail(emailRaw);if(!email)return {ok:false as const,error:'Enter a valid email.',status:400};
 if(typeof code!=='string'||!/^\d{6}$/.test(code.trim()))return {ok:false as const,error:'Enter the 6-digit code.',status:400};
 const secret=authSecret();if(!secret)return {ok:false as const,error:'Sign-in is not configured yet.',status:503};
 const row=await db().prepare('SELECT code_hash,expires_at,attempts FROM my_bankroll_otps WHERE email=?').bind(email).first<{code_hash:string;expires_at:string;attempts:number}>();
 if(!row)return {ok:false as const,error:'Request a new code.',status:400};
 if(row.attempts>=OTP_MAX_ATTEMPTS)return {ok:false as const,error:'Too many tries. Request a new code.',status:429};
 if(Date.parse(row.expires_at)<Date.now())return {ok:false as const,error:'That code expired. Request a new one.',status:400};
 const match=await otpMatches(code,row.code_hash,secret);
 if(!match){
  await db().prepare('UPDATE my_bankroll_otps SET attempts=attempts+1 WHERE email=?').bind(email).run();
  return {ok:false as const,error:'Wrong code.',status:401};
 }
 await db().prepare('DELETE FROM my_bankroll_otps WHERE email=?').bind(email).run();
 const existing=await db().prepare('SELECT id FROM my_bankroll_users WHERE email=?').bind(email).first<{id:string}>();
 const now=new Date().toISOString();
 let userId=existing?.id;
 if(!userId){
  userId=globalThis.crypto.randomUUID();
  await db().prepare('INSERT INTO my_bankroll_users (id,email,created_at,last_login_at) VALUES (?,?,?,?)').bind(userId,email,now,now).run();
 }else{
  await db().prepare('UPDATE my_bankroll_users SET last_login_at=? WHERE id=?').bind(now,userId).run();
 }
 const token=await signSession({userId,email,secret});
 return {ok:true as const,email,userId,cookie:sessionCookie(token,{secure:true})};
}

export function logoutCookie(){return clearSessionCookie({secure:true});}

export function parseStarts(body:any){
 if(!body||typeof body!=='object'||typeof body.starts!=='object'||!body.starts)return null;
 const out:Record<string,number>={};
 for(const sport of SUPPORTED_SPORTS){
  const v=body.starts[sport];
  if(v===null||v===undefined||v==='')continue;
  const n=typeof v==='number'?v:Number(String(v).replace(/[$,]/g,''));
  if(!Number.isFinite(n)||n<=0||n>1e9)return null;
  out[sport]=Math.round(n*100)/100;
 }
 return out;
}
