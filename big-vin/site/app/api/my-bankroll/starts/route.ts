import {sameOrigin,db} from '@/lib/db';
import {currentUser,parseStarts,loadStarts} from '@/lib/my-bankroll-session';
import {SUPPORTED_SPORTS} from '@/lib/presentation.mjs';
import {ctDate} from '@/lib/today-plays.mjs';

/** Chicago calendar day as YYYY-MM-DD for effective_from cutovers. */
function ctDay(d=new Date()){
 return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}

export async function PUT(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Invalid origin'},{status:403});
 try{
  const user=await currentUser(request);
  if(!user)return Response.json({error:'Sign in first.'},{status:401});
  const body=await request.json() as any;
  const starts=parseStarts(body);
  if(!starts)return Response.json({error:'Enter positive dollar amounts (or leave blank).'},{status:400});
  const prev=await loadStarts(user.id);
  const now=new Date().toISOString();
  const today=ctDay();
  const arrived=user.createdAt?ctDate(user.createdAt):today;
  const stmts=[db().prepare('DELETE FROM my_bankroll_starts WHERE user_id=?').bind(user.id)];
  for(const sport of SUPPORTED_SPORTS){
   if(starts[sport]==null)continue;
   const amount=starts[sport] as number;
   const prevStart=prev.starts[sport];
   // First-time start: Vin plays from the day they arrived (account created_at).
   // Override to a different balance: book from today so old picks aren't re-applied onto the new figure.
   // Unchanged amount keeps its prior effective_from.
   let effective:string|null=prev.effectiveFrom[sport];
   if(prevStart==null)effective=arrived;
   else if(Math.abs(prevStart-amount)>0.009)effective=today;
   stmts.push(db().prepare('INSERT INTO my_bankroll_starts (user_id,sport,start,effective_from,updated_at) VALUES (?,?,?,?,?)')
    .bind(user.id,sport,amount,effective,now));
  }
  await db().batch(stmts);
  const loaded=await loadStarts(user.id);
  return Response.json({ok:true,starts:loaded.starts,effectiveFrom:loaded.effectiveFrom,arrivedFrom:arrived},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('my-bankroll starts',e);return Response.json({error:'Could not save bankrolls.'},{status:500});}
}
