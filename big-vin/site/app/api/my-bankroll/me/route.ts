import {currentUser,loadStarts,emailConfigured,authSecret} from '@/lib/my-bankroll-session';
import {env} from 'cloudflare:workers';
import {loadKalshiStatus} from '@/lib/my-bankroll-kalshi';
import {normalizeKalshiReferralCode, kalshiJoinUrl} from '@/lib/kalshi-referral.mjs';
export async function GET(request:Request){
 try{
  if(!authSecret())return Response.json({configured:false,emailDelivery:false},{status:200,headers:{'Cache-Control':'no-store'}});
  const user=await currentUser(request);
  if(!user)return Response.json({configured:true,emailDelivery:emailConfigured(),user:null},{headers:{'Cache-Control':'no-store'}});
  const {starts,effectiveFrom}=await loadStarts(user.id);
  const kalshi=await loadKalshiStatus(user.id);
  const referralCode=normalizeKalshiReferralCode((env as any).KALSHI_REFERRAL_CODE);
  const kalshiReferral={configured:!!referralCode,joinUrl:kalshiJoinUrl(referralCode)};
  return Response.json({configured:true,emailDelivery:emailConfigured(),user:{email:user.email,starts,effectiveFrom},kalshi,kalshiReferral},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('my-bankroll me',e);return Response.json({error:'Unavailable.'},{status:503});}
}
