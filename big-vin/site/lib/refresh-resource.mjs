/** Keep the last successful response visible during a same-scope refresh.
 * A changed scope or cancelled request cannot publish an older response. */
export function createRefreshResource(publish){
 let active=null;
 let snapshot={key:null,data:null,error:'',busy:false};
 const emit=value=>{snapshot=value;publish(value);};
 return {
  read(key,fetcher){
   if(active?.key===key)return active.promise;
   const request={key,promise:null};active=request;
   emit({key,data:snapshot.key===key?snapshot.data:null,error:'',busy:true});
   request.promise=Promise.resolve().then(fetcher).then(data=>{
    if(active===request)emit({key,data,error:'',busy:false});
   }).catch(error=>{
    if(active===request)emit({...snapshot,error:error instanceof Error?error.message:'Refresh unavailable',busy:false});
   }).finally(()=>{if(active===request)active=null;});
   return request.promise;
  },
  cancel(){active=null;}
 };
}
