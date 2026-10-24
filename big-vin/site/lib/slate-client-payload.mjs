// Board/My Bankroll clients need the current pickRevision for Kelly, Covering by,
// and Needs X — not the full revision history. That history was ~3MB of a CFB
// slate alone and made phones crawl. Keep a count for the UI summary.
export function slimSlateForClient(slate){
 if(!slate||typeof slate!=='object')return slate;
 const games=Array.isArray(slate.games)?slate.games.map(slimGame):slate.games;
 return games===slate.games?slate:{...slate,games};
}
export function slimGame(game){
 if(!game||typeof game!=='object')return game;
 const revs=Array.isArray(game.pickRevisions)?game.pickRevisions:[];
 const count=typeof game.pickRevisionCount==='number'?game.pickRevisionCount:revs.length;
 if(revs.length===0&&game.pickRevisionCount===count)return game;
 return {...game,pickRevisions:[],pickRevisionCount:count};
}
