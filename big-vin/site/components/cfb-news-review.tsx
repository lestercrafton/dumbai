import review from '@/lib/cfb-news-review.json';
export function cfbNews(gameId:string,sport:string){return sport==='cfb'?review.records.find(r=>r.gameId===gameId):null;}
export function CfbNewsFlag({gameId,sport}:{gameId:string,sport:string}){
 const item=cfbNews(gameId,sport);
 return item?<span className="subline news-flag">{item.status==='flag'?'News flag':'News to verify'}</span>:null;
}
export default function CfbNewsReview({gameId,sport}:{gameId:string,sport:string}){
 const item=cfbNews(gameId,sport);
 if(!item)return null;
 return <section className="news-review"><h4>Top-ten news check</h4><p>{item.summary}</p><p className="fine">Checked {new Date(review.checkedAt).toLocaleString()}. Saved line unchanged.</p><ul>{item.sources.map(s=><li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a><span className="subline">{s.publishedDate}</span></li>)}</ul></section>;
}
