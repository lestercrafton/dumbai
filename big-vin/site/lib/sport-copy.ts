export const gameStart=(sport:string)=>({mlb:'first pitch',nfl:'kickoff',cfb:'kickoff',nba:'tipoff',wnba:'tipoff',cbb:'tipoff',nhl:'puck drop'}[sport]||'game start');
export const scoreUnit=(sport:string)=>sport==='mlb'?'runs':sport==='nhl'?'goals':'points';
export const shortScoreUnit=(sport:string)=>sport==='mlb'?'runs':sport==='nhl'?'goals':'pts';
