'use client';
import {useState,type ReactNode} from 'react';

/** Mount children only after the disclosure opens once — keeps heavy fetches off first paint. */
export function LazyDetails({summary,children,className}:{summary:ReactNode;children:ReactNode;className?:string}){
 const [opened,setOpened]=useState(false);
 return <details className={className} onToggle={event=>{if((event.currentTarget as HTMLDetailsElement).open)setOpened(true);}}>
  <summary>{summary}</summary>
  {opened?children:null}
 </details>;
}
