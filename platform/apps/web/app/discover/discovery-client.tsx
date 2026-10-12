'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PublicProject, PublicProjectPage } from '@preneura/contracts/discovery';
import { useLocale } from '../locale-provider';
import { ActionButton, ActionLink, Badge, Card, EmptyState, LoadingCards } from '../ui/primitives';
import { discoveryMessages } from '../../lib/discovery-messages';
import styles from './discover.module.css';

const base=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4100';
function isProject(value:unknown):value is PublicProject {
  if(!value||typeof value!=='object')return false;
  const row=value as PublicProject;
  return typeof row.slug==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug)
    &&[row.title,row.description,row.location].every(pair=>pair&&typeof pair.en==='string'&&typeof pair.ar==='string');
}
export function DiscoveryHeader() {
  const {locale}=useLocale();const c=discoveryMessages[locale];
  return <header className={`${styles.shell} ${styles.header}`}><Link href="/discover" className={styles.brand}>PRENEURA</Link>
    <nav className={styles.nav} aria-label={locale==='en'?'Main navigation':'القائمة الرئيسية'}><Link href="/workspace">{c.workspace}</Link><Link href="/login">{c.signIn}</Link></nav></header>;
}
export default function DiscoveryClient() {
  const {locale}=useLocale();const c=discoveryMessages[locale];
  const [draft,setDraft]=useState('');const [query,setQuery]=useState('');const [retry,setRetry]=useState(0);
  const [items,setItems]=useState<PublicProject[]>([]);const [cursor,setCursor]=useState<string|null>(null);
  const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');const [moreBusy,setMoreBusy]=useState(false);const [moreError,setMoreError]=useState(false);
  const requestId=useRef(0);const moreAbort=useRef<AbortController|null>(null);
  useEffect(()=>{
    const controller=new AbortController();const id=++requestId.current;
    moreAbort.current?.abort();setItems([]);setCursor(null);setMoreBusy(false);setMoreError(false);setStatus('loading');
    void load(query,null,controller.signal).then(result=>{if(requestId.current!==id)return;setItems(result.items);setCursor(result.nextCursor);setStatus('ready');})
      .catch(()=>{if(!controller.signal.aborted&&requestId.current===id)setStatus('error');});
    return()=>{controller.abort();moreAbort.current?.abort();};
  },[query,retry]);
  async function load(q:string,after:string|null,signal:AbortSignal):Promise<PublicProjectPage> {
    const params=new URLSearchParams({q,limit:'12'});if(after)params.set('after',after);
    const response=await fetch(`${base}/v1/public/projects?${params}`,{signal});
    if(!response.ok)throw new Error('Catalog unavailable');
    const value=await response.json() as PublicProjectPage;
    if(!Array.isArray(value.items)||value.items.length>12||!value.items.every(isProject)||!(value.nextCursor===null||typeof value.nextCursor==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.nextCursor)))throw new Error('Invalid catalog');
    return value;
  }
  async function more() {
    if(!cursor||moreBusy)return;const id=requestId.current;const controller=new AbortController();moreAbort.current=controller;setMoreBusy(true);setMoreError(false);
    try {const result=await load(query,cursor,controller.signal);if(requestId.current!==id)return;
      setItems(previous=>{const seen=new Set(previous.map(p=>p.slug));return [...previous,...result.items.filter(p=>!seen.has(p.slug))];});setCursor(result.nextCursor);
    } catch {if(!controller.signal.aborted&&requestId.current===id)setMoreError(true);}
    finally {if(requestId.current===id)setMoreBusy(false);}
  }
  function search(event:FormEvent) {event.preventDefault();setQuery(draft.trim());setRetry(value=>value+1);}
  return <main className={styles.page}><DiscoveryHeader/><section className={`${styles.shell} ${styles.hero}`}>
    <div><span className={styles.eyebrow}>{c.eyebrow}</span><h1>{c.title}</h1><p className={styles.intro}>{c.intro}</p><ActionLink href="#projects">{c.browse}</ActionLink></div>
    <div className={styles.art}><svg viewBox="0 0 520 470" aria-hidden="true"><rect width="520" height="470" fill="#dfece5"/><circle cx="382" cy="88" r="48" fill="#eff6db"/><path d="M0 347L520 297V470H0Z" fill="#cad9cf"/><path d="M64 156L294 94L456 186L224 257Z" fill="#f6f0e3"/><path d="M64 156V357L224 442V257Z" fill="#b4c8bc"/><path d="M224 257V442L456 366V186Z" fill="#f8f7ef"/><path d="M82 188L204 253V282L82 217ZM82 241L204 306V335L82 270ZM82 294L204 359V388L82 323Z" fill="#466a61"/><path d="M247 277L432 220V249L247 306ZM247 328L432 271V300L247 357ZM247 379L432 322V351L247 408Z" fill="#466a61"/><path d="M130 126L291 83L408 145L246 191Z" fill="#e7eadc"/><path d="M319 177L344 169V190L319 198Z" fill="#7aa291"/></svg><span className={styles.artLabel}>{c.architecture}</span></div>
  </section><section id="projects" className={`${styles.shell} ${styles.section}`} aria-labelledby="project-heading">
    <div className={styles.sectionHeading}><h2 id="project-heading">{c.section}</h2><form onSubmit={search} className={styles.search}><div><label htmlFor="project-search">{c.search}</label><input id="project-search" value={draft} maxLength={100} onChange={e=>setDraft(e.target.value)} placeholder={c.searchPlaceholder}/></div><ActionButton type="submit">{c.searchButton}</ActionButton></form></div>
    {status==='loading'?<LoadingCards label={c.loading}/>:status==='error'?<EmptyState title={c.error} body={c.errorBody}><ActionButton onClick={()=>setRetry(x=>x+1)}>{c.retry}</ActionButton></EmptyState>:items.length===0?<EmptyState title={query?c.noResults:c.empty} body={query?c.noResultsBody:c.emptyBody}/>:<><div className={styles.grid}>{items.map(p=><div className={styles.project} key={p.slug}><Card><Badge>{p.location[locale]}</Badge><h3>{p.title[locale]}</h3><p>{p.description[locale]}</p><Link href={`/discover/${p.slug}`}>{c.detail} <span aria-hidden="true">↗</span></Link></Card></div>)}</div>{moreError?<p role="alert">{c.errorBody}</p>:null}{cursor?<div className={styles.more}><ActionButton secondary disabled={moreBusy} onClick={()=>void more()}>{moreBusy?c.loading:c.more}</ActionButton></div>:null}</>}
  </section><section className={`${styles.shell} ${styles.section}`} aria-labelledby="process-heading"><h2 id="process-heading">{c.process}</h2><div className={styles.steps}>{[[c.step1,c.body1],[c.step2,c.body2],[c.step3,c.body3]].map(([title,body],i)=><div key={i}><span className={styles.stepNumber}>{String(i+1).padStart(2,'0')}</span><h3>{title}</h3><p>{body}</p></div>)}</div></section><footer className={`${styles.shell} ${styles.footer}`}>{c.footer}</footer></main>;
}
