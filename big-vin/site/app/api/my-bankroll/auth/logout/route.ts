import {sameOrigin} from '@/lib/db';
import {logoutCookie} from '@/lib/my-bankroll-session';
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Invalid origin'},{status:403});
 return Response.json({ok:true},{headers:{'Set-Cookie':logoutCookie(),'Cache-Control':'no-store'}});
}
