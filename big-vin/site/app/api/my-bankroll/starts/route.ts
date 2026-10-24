import {sameOrigin,db} from '@/lib/db';
import {currentUser,parseStarts,loadStarts} from '@/lib/my-bankroll-session';
import {SUPPORTED_SPORTS} from '@/lib/presentation.mjs';
export async function PUT(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Invalid origin'},{status:403});
 try{
  const user=await currentUser(request);
  if(!user)return Response.json({error:'Sign in first.'},{status:401});
  const body=await request.json() as any;
  const starts=parseStarts(body);
  if(!starts)return Response.json({error:'Enter positive dollar amounts (or leave blank).'},{status:400});
  const now=new Date().toISOString();
  const stmts=[db().prepare('DELETE FROM my_bankroll_starts WHERE user_id=?').bind(user.id)];
  for(const sport of SUPPORTED_SPORTS){
   if(starts[sport]==null)continue;
   stmts.push(db().prepare('INSERT INTO my_bankroll_starts (user_id,sport,start,updated_at) VALUES (?,?,?,?)').bind(user.id,sport,starts[sport],now));
  }
  await db().batch(stmts);
  return Response.json({ok:true,starts:await loadStarts(user.id)},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('my-bankroll starts',e);return Response.json({error:'Could not save bankrolls.'},{status:500});}
}
