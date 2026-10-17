'use client';
import {useCallback,useEffect,useState} from 'react';
import {createRefreshResource} from '@/lib/refresh-resource.mjs';

type Snapshot<T>={key:string|null;data:T|null;error:string;busy:boolean};
export function useRefreshingResource<T>(key:string,read:()=>Promise<T>){
 const [snapshot,setSnapshot]=useState<Snapshot<T>>({key:null,data:null,error:'',busy:false});
 const [resource]=useState(()=>createRefreshResource(setSnapshot));
 const load=useCallback(()=>resource.read(key,read),[resource,key,read]);
 useEffect(()=>{void load();return()=>resource.cancel();},[resource,load]);
 const current=snapshot.key===key?snapshot:null;
 return {data:current?.data??null,error:current?.error??'',busy:current?.busy??true,load};
}
