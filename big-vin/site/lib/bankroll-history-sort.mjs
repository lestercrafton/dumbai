/** Sort keys for the sport bankroll History table. Default = chronological (`t` asc). */
export const HISTORY_SORT_COLUMNS = [
  {key:'t', label:'Date'},
  {key:'game', label:'Game'},
  {key:'pick', label:'Pick'},
  {key:'edge', label:'Edge'},
  {key:'winChance', label:'Win chance'},
  {key:'stake', label:'Kelly'},
  {key:'amount', label:'Bet'},
  {key:'outcome', label:'Result'},
  {key:'pl', label:'P/L'},
  {key:'after', label:'Bankroll'},
];

const OUTCOME_RANK = {loss:0, push:1, void:1, win:2};

function value(bet, key){
  if(key==='t') return Date.parse(bet.t)||0;
  if(key==='game'||key==='pick') return String(bet[key]??'').toLowerCase();
  if(key==='outcome') return OUTCOME_RANK[bet.outcome]??1;
  const n = bet[key];
  return typeof n==='number'&&Number.isFinite(n) ? n : null;
}

/** Compare two bets for a column. Null numeric values sort last in both directions. */
export function compareBets(a, b, key, dir='asc'){
  const av=value(a,key), bv=value(b,key);
  const mul = dir==='desc' ? -1 : 1;
  if(typeof av==='string'||typeof bv==='string'){
    const as=String(av??''), bs=String(bv??'');
    if(as<bs) return -1*mul;
    if(as>bs) return 1*mul;
  }else{
    const aNull=av==null, bNull=bv==null;
    if(aNull&&bNull){/* tie */}
    else if(aNull) return 1;
    else if(bNull) return -1;
    else if(av<bv) return -1*mul;
    else if(av>bv) return 1*mul;
  }
  // Stable tie-break: chronological, then pick text
  const ta=Date.parse(a.t)||0, tb=Date.parse(b.t)||0;
  if(ta!==tb) return ta-tb;
  return String(a.pick??'').localeCompare(String(b.pick??''));
}

export function sortHistoryBets(bets, key='t', dir='asc'){
  return [...(bets||[])].sort((a,b)=>compareBets(a,b,key,dir));
}

/** Next sort state after clicking a column header. */
export function nextHistorySort(current, key){
  if(current?.key===key) return {key, dir: current.dir==='asc'?'desc':'asc'};
  // Date defaults to asc (time order); most numeric columns start desc (biggest first)
  if(key==='t'||key==='game'||key==='pick') return {key, dir:'asc'};
  return {key, dir:'desc'};
}
