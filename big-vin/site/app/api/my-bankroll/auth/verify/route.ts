import {sameOrigin} from '@/lib/db';
import {verifyOtp} from '@/lib/my-bankroll-session';
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Invalid origin'},{status:403});
 try{
  const body=await request.json() as any;
  const r=await verifyOtp(body?.email,body?.code);
  if(!r.ok)return Response.json({error:r.error},{status:r.status});
  return Response.json({ok:true,email:r.email},{headers:{'Set-Cookie':r.cookie,'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Could not verify code.'},{status:500});}
}
