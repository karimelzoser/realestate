// PRENEURA shared state facade.
// It provides one stable access API while the legacy in-memory state is migrated domain-by-domain.

(function(){
  const root=window.PRENEURA=window.PRENEURA||{};

  function appRef(){
    try{return typeof app!=='undefined'?app:(window.app||null)}catch(_){return window.app||null}
  }
  function pagesRef(){
    try{return typeof P!=='undefined'?P:(window.P||null)}catch(_){return window.P||null}
  }
  function unitsRef(){
    try{return typeof UNITS!=='undefined'?UNITS:(window.UNITS||[])}catch(_){return window.UNITS||[]}
  }
  function roleConfigRef(){
    try{return typeof RT_ROLE_CONFIG!=='undefined'?RT_ROLE_CONFIG:(window.RT_ROLE_CONFIG||{})}catch(_){return window.RT_ROLE_CONFIG||{}}
  }

  const listeners=new Map();
  function emit(topic,detail){
    const set=listeners.get(topic);
    if(set) for(const fn of [...set]){try{fn(detail)}catch(e){console.error(e)}}
    const all=listeners.get('*');
    if(all) for(const fn of [...all]){try{fn({topic,detail})}catch(e){console.error(e)}}
  }
  function on(topic,fn){
    if(typeof fn!=='function')return function(){};
    if(!listeners.has(topic))listeners.set(topic,new Set());
    listeners.get(topic).add(fn);
    return function(){listeners.get(topic)?.delete(fn)};
  }

  function queue(){
    return appRef()?.fx?.queue||null;
  }
  function queueWaiting(){
    return queue()?.waiting||[];
  }
  function registry(){
    return appRef()?.fx?.rt?.registry||[];
  }
  function buyerSession(){
    return appRef()?.fx?.final6?.buyerSession||null;
  }
  function currentBuyer(){
    const s=buyerSession();
    if(!s?.customerId)return null;
    return registry().find(r=>r.customerId===s.customerId)||null;
  }
  function transaction(){
    return appRef()?.fx?.transaction||null;
  }
  function contract(){
    return appRef()?.fx?.contract||null;
  }
  function properties(){
    return appRef()?.fx?.final6?.buyerProperties||[];
  }
  function installments(){
    return appRef()?.fx?.final6?.installments||[];
  }
  function allocationConfig(){
    const a=appRef();
    const model=root.model?.allocation;
    return {
      physicalSeats:a?.fx?.p59?.physicalSeats ?? model?.defaultCapacity?.salesCenterSeats ?? 10,
      onlineSlots:a?.fx?.p59?.onlineSlots ?? model?.defaultCapacity?.onlineSlots ?? 3,
      callGraceMinutes:a?.fx?.p59?.callGraceMinutes ?? 10
    };
  }
  function page(id){
    return pagesRef()?.[id]||null;
  }
  function roleConfig(id){
    return roleConfigRef()?.[id]||null;
  }
  function unitById(id){
    return unitsRef().find(u=>Number(u.id)===Number(id))||null;
  }
  function snapshot(){
    const a=appRef();
    return {
      role:a?.role||null,
      page:a?.page||null,
      buyer:currentBuyer(),
      queue:queueWaiting().map(q=>({...q})),
      transaction:transaction()?{...transaction()}:null,
      contract:contract()?{...contract()}:null,
      allocation:allocationConfig()
    };
  }

  root.state={
    app:appRef,
    pages:pagesRef,
    page,
    units:unitsRef,
    unitById,
    roleConfig,
    queue,
    queueWaiting,
    registry,
    buyerSession,
    currentBuyer,
    transaction,
    contract,
    properties,
    installments,
    allocationConfig,
    snapshot,
    on,
    emit
  };
})();
