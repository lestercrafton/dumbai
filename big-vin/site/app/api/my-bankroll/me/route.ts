import {currentUser,loadStarts,emailConfigured,authSecret} from '@/lib/my-bankroll-session';
import {loadKalshiStatus} from '@/lib/my-bankroll-kalshi';
export async function GET(request:Request){
 try{
  if(!authSecret())return Response.json({configured:false,emailDelivery:false},{status:200,headers:{'Cache-Control':'no-store'}});
  const user=await currentUser(request);
  if(!user)return Response.json({configured:true,emailDelivery:emailConfigured(),user:null},{headers:{'Cache-Control':'no-store'}});
  const {starts,effectiveFrom}=await loadStarts(user.id);
  const kalshi=await loadKalshiStatus(user.id);
  return Response.json({configured:true,emailDelivery:emailConfigured(),user:{email:user.email,starts,effectiveFrom},kalshi},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('my-bankroll me',e);return Response.json({error:'Unavailable.'},{status:503});}
}
