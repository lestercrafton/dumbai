'use client';
import {useEffect,useState} from 'react';
/** Shown only on the parallel Cloudflare copy until it becomes the main site. */
export default function HostingNotice(){
 const [show,setShow]=useState(false);
 useEffect(()=>{setShow(location.hostname.endsWith('.workers.dev'));},[]);
 if(!show)return null;
 return <p className="hosting-notice" role="note">New home, still filling in. Picks and results through Oct 19 were restored from the public site; first-seen lines, pick revision history and saved feeds arrive with the full data copy around Oct 24. Live picks are made here by the same runner.</p>;
}
