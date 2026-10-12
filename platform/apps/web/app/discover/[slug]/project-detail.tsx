'use client';
import {useEffect,useState} from 'react';
import type {PublicProject} from '@preneura/contracts/discovery';
import {useLocale} from '../../locale-provider';
import {DiscoveryHeader} from '../discovery-client';
import {ActionButton,ActionLink,Badge,Card,EmptyState,LoadingCards} from '../../ui/primitives';
import {discoveryMessages} from '../../../lib/discovery-messages';
import styles from '../discover.module.css';
const base=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4100';
export default function ProjectDetail({slug}:{slug:string}) {
  const {locale}=useLocale();const c=discoveryMessages[locale];const [project,setProject]=useState<PublicProject|null>(null);
  const [status,setStatus]=useState<'loading'|'ready'|'missing'|'error'>('loading');const [retry,setRetry]=useState(0);
  useEffect(()=>{const controller=new AbortController();setStatus('loading');setProject(null);
    void fetch(`${base}/v1/public/projects/${encodeURIComponent(slug)}`,{signal:controller.signal}).then(async r=>{
      if(controller.signal.aborted)return;
      if(r.status===404){setStatus('missing');return;}if(!r.ok)throw Error('Unavailable');const row=await r.json() as PublicProject;
      if(row.slug!==slug||![row.title,row.description,row.location].every(p=>p&&typeof p.en==='string'&&typeof p.ar==='string'))throw Error('Invalid project');
      if(controller.signal.aborted)return;setProject(row);setStatus('ready');
    }).catch(()=>{if(!controller.signal.aborted)setStatus('error');});return()=>controller.abort();
  },[slug,retry]);
  return <main className={styles.page}><DiscoveryHeader/><div className={`${styles.shell} ${styles.detail}`}><ActionLink secondary href="/discover">{c.back}</ActionLink>
    {status==='loading'?<LoadingCards label={c.loading}/>:status==='missing'?<EmptyState title={c.unavailable} body={c.unavailableBody}/>:status==='error'?<EmptyState title={c.error} body={c.errorBody}><ActionButton onClick={()=>setRetry(x=>x+1)}>{c.retry}</ActionButton></EmptyState>:project?<><Badge>{project.location[locale]}</Badge><h1>{project.title[locale]}</h1><p>{project.description[locale]}</p><Card><h2>{c.next}</h2><p>{c.nextBody}</p><ActionLink href="/login">{c.signIn}</ActionLink></Card></>:null}</div></main>;
}
