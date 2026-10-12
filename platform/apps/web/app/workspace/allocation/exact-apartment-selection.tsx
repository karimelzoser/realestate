'use client';

import { useCallback,useEffect,useRef,useState } from 'react';
import type { AllocationSessionSnapshot,AssignedAllocationLockSnapshot,EligibleApartmentPage,EligibleApartmentSnapshot,EligibleApartmentStructure,ExactApartmentQuoteSnapshot } from '@preneura/contracts/allocation';
import { apiFetch } from '../../lib/api';
import { useLocale } from '../../locale-provider';
import { allocationMessages } from '../../../lib/allocation-messages';
import styles from './allocation.module.css';

export default function ExactApartmentSelection({tenantId,projectId,session,onChanged}:{
  tenantId:string;projectId:string;session:AllocationSessionSnapshot;onChanged:()=>Promise<void>;
}) {
  const {locale,formatAmount,formatDateTime,formatNumber}=useLocale();
  const copy=allocationMessages[locale];
  const [structure,setStructure]=useState<EligibleApartmentStructure>({buildings:[]});
  const [buildingId,setBuildingId]=useState(''),[floorId,setFloorId]=useState('');
  const [apartments,setApartments]=useState<EligibleApartmentSnapshot[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [quote,setQuote]=useState<ExactApartmentQuoteSnapshot|null>(null),[acknowledged,setAcknowledged]=useState(false);
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [serverNow,setServerNow]=useState(()=>Date.parse(session.serverTime));
  const keys=useRef(new Map<string,string>());
  const generation=useRef(0);
  const base=`/v1/tenants/${tenantId}/projects/${projectId}/allocation`;
  const held=Boolean(session.allocationLockId);
  const quoteExpired=Boolean(quote&&Date.parse(quote.validUntil)<=serverNow);
  const floors=structure.buildings.find(item=>item.buildingId===buildingId)?.floors??[];
  useEffect(()=>{
    const observed=performance.now(),server=Date.parse(session.serverTime);
    const update=()=>setServerNow(server+performance.now()-observed);
    update();const timer=window.setInterval(update,1000);return()=>window.clearInterval(timer);
  },[session.serverTime]);

  const loadStructure=useCallback(async()=>{
    const value=await apiFetch<EligibleApartmentStructure>(`${base}/hierarchy`);
    setStructure(value);
  },[base]);
  useEffect(()=>{
    let cancelled=false;
    setError('');
    if(session.lockQuoteId) {
      void apiFetch<ExactApartmentQuoteSnapshot>(`${base}/quotes/${session.lockQuoteId}`)
        .then(value=>{if(!cancelled)setQuote(value);}).catch(()=>{if(!cancelled)setError(copy.failed);});
    } else if(session.status==='CALLED') {
      void loadStructure().catch(()=>{if(!cancelled)setError(copy.failed);});
    }
    return()=>{cancelled=true;};
  },[base,session.lockQuoteId,session.status,loadStructure,copy.failed]);

  const loadApartments=useCallback(async(after?:string)=>{
    const current=++generation.current;
    const params=new URLSearchParams({buildingId,floorId,limit:'24'});
    if(after)params.set('after',after);
    const page=await apiFetch<EligibleApartmentPage>(`${base}/apartments?${params}`);
    if(current!==generation.current)return;
    setApartments(previous=>after?[...previous,...page.items]:page.items);setCursor(page.nextCursor);
  },[base,buildingId,floorId]);
  useEffect(()=>{
    setApartments([]);setCursor(null);
    if(!buildingId||!floorId||held)return;
    let cancelled=false;
    setBusy('browse');
    void loadApartments().catch(()=>{if(!cancelled)setError(copy.failed);}).finally(()=>{if(!cancelled)setBusy('');});
    return()=>{cancelled=true;generation.current++;};
  },[buildingId,floorId,held,loadApartments,copy.failed]);

  async function review(apartment:EligibleApartmentSnapshot) {
    const current=++generation.current;
    setBusy(apartment.physicalUnitId);setError('');setNotice('');setAcknowledged(false);
    try {
      const value=await apiFetch<ExactApartmentQuoteSnapshot>(`${base}/quotes`,{method:'POST',body:JSON.stringify({queueEntryId:session.queueEntryId,physicalUnitId:apartment.physicalUnitId})});
      if(current===generation.current)setQuote(value);
    } catch {if(current===generation.current){setQuote(null);setError(copy.changed);await loadApartments().catch(()=>undefined);}}
    finally {if(current===generation.current)setBusy('');}
  }

  async function hold() {
    if(!quote||!acknowledged||held||quoteExpired)return;
    let key=keys.current.get(quote.quoteId);
    if(!key) {
      try {key=window.sessionStorage.getItem(`preneura:hold:${quote.quoteId}`)??undefined;}catch{}
      key??=crypto.randomUUID();keys.current.set(quote.quoteId,key);
      try {window.sessionStorage.setItem(`preneura:hold:${quote.quoteId}`,key);}catch{}
    }
    setBusy('hold');setError('');
    try {
      const lock=await apiFetch<AssignedAllocationLockSnapshot>(`${base}/locks`,{method:'POST',body:JSON.stringify({quoteId:quote.quoteId,idempotencyKey:key,ttlSeconds:900})});
      if(lock.physicalUnitId!==quote.apartment.physicalUnitId||lock.status!=='ACTIVE') {setError(copy.changed);}
      else setNotice(copy.held);
      await onChanged();
    } catch {setError(copy.changed);setAcknowledged(false);await onChanged().catch(()=>undefined);}
    finally {setBusy('');}
  }

  return <section className={styles.panel} aria-label={copy.selection}>
    <div className={styles.panelHead}><div><p className={styles.sectionLabel}>{copy.type}</p><h2>{session.eoiUnitTypeName??copy.legacy}</h2><p>{copy.selection}</p></div>
      {!held?<button type="button" disabled={Boolean(busy)} onClick={()=>void loadStructure().then(()=>buildingId&&floorId?loadApartments():undefined).catch(()=>setError(copy.failed))}>{copy.refresh}</button>:null}
    </div>
    {error?<p className={styles.error} role="alert">{error}</p>:null}{notice?<p className={styles.success} role="status">{notice}</p>:null}
    {!held&&session.eoiUnitTypeId?<>
      <div className={styles.locationFilters}>
        <label>{copy.building}<select value={buildingId} disabled={Boolean(busy)} onChange={event=>{generation.current++;setBuildingId(event.target.value);setFloorId('');setQuote(null);setAcknowledged(false);}}>
          <option value="">{copy.chooseBuilding}</option>{structure.buildings.map(item=><option value={item.buildingId} key={item.buildingId}>{item.buildingName} · {item.buildingCode}</option>)}
        </select></label>
        <label>{copy.floor}<select value={floorId} disabled={!buildingId||Boolean(busy)} onChange={event=>{generation.current++;setFloorId(event.target.value);setQuote(null);setAcknowledged(false);}}>
          <option value="">{copy.chooseFloor}</option>{floors.map(item=><option value={item.floorId} key={item.floorId}>{item.floorName} · {formatNumber(item.availableApartments)} {copy.available}</option>)}
        </select></label>
      </div>
      <div className={styles.cards}>{apartments.map(item=><article className={`${styles.unitCard} ${quote?.apartment.physicalUnitId===item.physicalUnitId?styles.selected:''}`} key={item.physicalUnitId}>
        <div><small>{copy.apartment}</small><h3><bdi>{item.apartmentReference}</bdi></h3><p>{item.buildingName} · {item.floorName}</p></div>
        <dl><div><dt>{copy.indoor}</dt><dd><bdi>{item.indoorAreaSqm}</bdi> {copy.sqm}</dd></div><div><dt>{copy.garden}</dt><dd><bdi>{item.gardenAreaSqm}</bdi> {copy.sqm}</dd></div><div><dt>{copy.roof}</dt><dd><bdi>{item.roofAreaSqm}</bdi> {copy.sqm}</dd></div></dl>
        {item.viewCode?<p>{copy.view}: <bdi>{item.viewCode}</bdi></p>:null}
        <strong className={styles.price}>{item.currentTotalPrice?formatAmount(item.currentTotalPrice,item.currency):copy.noPrice}</strong>
        <button type="button" disabled={Boolean(busy)||!item.currentTotalPrice} onClick={()=>void review(item)}>{busy===item.physicalUnitId?copy.reviewing:copy.review}</button>
      </article>)}</div>
      {floorId&&apartments.length===0&&busy!=='browse'?<p className={styles.empty}>{copy.noApartments}</p>:null}
      {cursor?<button type="button" disabled={Boolean(busy)} onClick={()=>{setBusy('browse');void loadApartments(cursor).catch(()=>setError(copy.failed)).finally(()=>setBusy(''));}}>{copy.more}</button>:null}
    </>:null}
    {quote?<section className={styles.quoteReview} aria-label={copy.quote}>
      <h3>{copy.quote} · <bdi>{quote.apartment.apartmentReference}</bdi></h3>
      <p>{quote.apartment.buildingName} · {quote.apartment.floorName} · {quote.apartment.unitTypeName}</p>
      <strong className={styles.price}>{formatAmount(quote.quotedTotal,quote.currency)}</strong>
      <dl>{quote.components.map(item=><div key={item.component}><dt>{item.component==='INDOOR'?copy.indoor:item.component==='ROOF'?copy.roof:copy.garden}</dt><dd><bdi>{item.areaSqm}</bdi> {copy.sqm} × {formatAmount(item.ratePerSqm,quote.currency)} = {formatAmount(item.amount,quote.currency)}</dd></div>)}</dl>
      {!held?<><p>{copy.validUntil}: {formatDateTime(quote.validUntil)}</p><p>{copy.quoteHint}</p>
        {quoteExpired?<p className={styles.error} role="status">{copy.expired}</p>:null}
        <label className={styles.quoteAcknowledgment}><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)}/>{copy.acknowledge}</label>
        <button className={styles.primary} type="button" disabled={!acknowledged||quoteExpired||Boolean(busy)} onClick={()=>void hold()}>{busy==='hold'?copy.holding:copy.hold}</button>
      </>:<p>{copy.held}</p>}
    </section>:null}
  </section>;
}
