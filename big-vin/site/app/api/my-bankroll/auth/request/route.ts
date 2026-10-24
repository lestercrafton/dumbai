import {sameOrigin} from '@/lib/db';
import {requestOtp} from '@/lib/my-bankroll-session';
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Invalid origin'},{status:403});
 try{
  const body=await request.json() as any;
  const r=await requestOtp(body?.email);
  if(!r.ok)return Response.json({error:r.error},{status:r.status});
  return Response.json({ok:true,email:r.email,demo:r.demo,...(r.demo?{demoCode:r.demoCode}:{})});
 }catch(e){console.error('my-bankroll auth request',e instanceof Error?e.stack||e.message:e);return Response.json({error:'Could not start sign-in.',detail:e instanceof Error?e.message:String(e)},{status:500});}
}
