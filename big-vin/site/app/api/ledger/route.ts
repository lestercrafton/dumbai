import {sportsDay} from '@/lib/time';
import {db,sameOrigin} from '@/lib/db';
import {americanToDecimal,settleBet} from '@/lib/legacy.mjs';
import {scoreboard} from '@/lib/feeds/service';
import {SPORT_PATHS,normalizeScoreboard} from '@/lib/feeds/adapter.mjs';
const number=(x:unknown)=>typeof x==='number'&&Number.isFinite(x);
export async function GET(){try{const rows=await db().prepare('SELECT * FROM plays ORDER BY created_at DESC LIMIT 1000').all();return Response.json({plays:rows.results});}catch{return Response.json({error:'Saved plays are temporarily unavailable.'},{status:503});}}
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Invalid origin'},{status:403});
 try{
 const v=await request.json() as any;
 if(!Object.hasOwn(SPORT_PATHS,v.sport)||!['spread','moneyline','total'].includes(v.market)||!(v.market==='total'?['over','under']:['home','away']).includes(v.selection)||!number(v.odds)||americanToDecimal(v.odds)===null||!number(v.risk)||v.risk<=0||v.risk>100000||(v.market!=='moneyline'&&(!number(v.line)||Math.abs(v.line)>1000)))return Response.json({error:'Check the selection, line, American odds and units risked.'},{status:400});
 if(!v.startTime||!Number.isFinite(Date.parse(v.startTime))||Date.parse(v.startTime)<=Date.now())return Response.json({error:'Only games that have not started can be recorded.'},{status:400});
 if(!['gameId','home','away','provider'].every(k=>typeof v[k]==='string'&&v[k].length>0&&v[k].length<200))return Response.json({error:'Missing game details.'},{status:400});
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await db().prepare('INSERT INTO plays (id,created_at,sport,game_id,start_time,home,away,market,selection,line,odds,risk,model_margin,model_as_of,snapshot_at,provider,rank) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,now,v.sport,v.gameId,v.startTime,v.home,v.away,v.market,v.selection,v.market==='moneyline'?null:v.line,v.odds,v.risk,number(v.modelMargin)?v.modelMargin:null,typeof v.modelAsOf==='string'?v.modelAsOf:null,typeof v.snapshotAt==='string'?v.snapshotAt:now,v.provider,number(v.rank)?v.rank:null).run();
 return Response.json({id});
 }catch{return Response.json({error:'Could not save this play.'},{status:500});}
}
export async function PATCH(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Invalid origin'},{status:403});
 try{const v=await request.json() as any;
 if(v.action==='refresh'){
  const {results}=await db().prepare("SELECT * FROM plays WHERE outcome='pending' ORDER BY start_time LIMIT 200").all<any>();
  const eligible=results.filter(p=>Date.parse(p.start_time)<Date.now());const groups=[...new Set(eligible.map(p=>`${p.sport}:${sportsDay(p.start_time)}`))].slice(0,12);let graded=0;
  for(const key of groups){const sport=key.split(':')[0],date=key.split(':')[1];let board;try{const snap=Array.isArray(v.snapshots)?v.snapshots.find((x:any)=>x.sport===sport&&x.date===date&&Array.isArray(x.payload?.events)&&x.payload.events.length<=1000):null;board=snap?normalizeScoreboard(snap.payload,sport):await scoreboard(sport,date);}catch{continue;}
   for(const p of eligible.filter(p=>p.sport===sport&&sportsDay(p.start_time)===date)){const game=board.games.find((g:any)=>g.id===p.game_id);if(!game||!['completed','cancelled'].includes(game.status))continue;
    const result=settleBet({status:game.status==='completed'?'final':'cancelled',market:p.market,selection:p.selection,homeScore:game.homeScore,awayScore:game.awayScore,line:p.line,odds:p.odds,risk:p.risk});if(result.outcome==='pending')continue;
    await db().prepare('UPDATE plays SET outcome=?,pnl=?,graded_at=?,grade_source=?,home_score=?,away_score=? WHERE id=? AND outcome=?').bind(result.outcome,result.pnl,new Date().toISOString(),'ESPN final score',game.homeScore,game.awayScore,p.id,'pending').run();graded++;
   }
  }return Response.json({graded});
 }
 if(!['win','learn','push','void'].includes(v.outcome)||typeof v.id!=='string')return Response.json({error:'Choose a valid result.'},{status:400});
 const p=await db().prepare('SELECT * FROM plays WHERE id=?').bind(v.id).first<any>();if(!p)return Response.json({error:'Play not found.'},{status:404});
 const pnl=v.outcome==='win'?p.risk*((americanToDecimal(p.odds) as number)-1):v.outcome==='learn'?-p.risk:0;
 await db().prepare('UPDATE plays SET outcome=?,pnl=?,graded_at=?,grade_source=? WHERE id=?').bind(v.outcome,pnl,new Date().toISOString(),'Manual grade',v.id).run();return Response.json({id:v.id,outcome:v.outcome,pnl});
 }catch{return Response.json({error:'Could not update results.'},{status:500});}
}
