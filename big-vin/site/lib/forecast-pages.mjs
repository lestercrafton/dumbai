/** Read every saved forecast using a stable unique ID cursor. A fixed total
 * LIMIT would silently drop older seasons as the ledger grows.
 * @param {(afterId:string|null,limit:number)=>Promise<any[]>} loadPage
 * @param {number} [pageSize]
 */
export async function readForecastPages(loadPage,pageSize=1000){
 const records=[];let afterId=null;
 while(true){
  const page=await loadPage(afterId,pageSize);
  if(!page.length)break;
  for(const row of page){
   if(typeof row.id!=='string'||afterId!==null&&row.id<=afterId)throw new Error('Forecast pagination did not advance');
   records.push(row);afterId=row.id;
  }
  if(page.length<pageSize)break;
 }
 return records;
}
