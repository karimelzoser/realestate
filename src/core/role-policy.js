// PRENEURA role-scope policy.
// This layer controls which application surfaces a real role may navigate to.
// Direct How It Works previews intentionally bypass this policy; real ROLE entry never does.

(function(){
  const root=window.PRENEURA=window.PRENEURA||{};

  const capabilities={
    buyer:[
      'profile.self','eoi.self','queue.self','inventory.read','unit.select.self',
      'payment.self','documents.self','contract.sign.self','property.read.self'
    ],
    registrar:[
      'buyer.search','buyer.register','allocation.checkin','queue.issue','queue.reprint','hardware.read'
    ],
    operator:[
      'queue.read','assignment.read','buyer.read','inventory.read','unit.select.assisted',
      'unit.lock','transaction.handoff'
    ],
    finance:[
      'transaction.read','payment.evidence','payment.verify','documents.upload','documents.verify',
      'finance.provider','contract.readiness'
    ],
    broker:[
      'buyer.register.delegated','buyer.read.delegated','buyer.profile.delegated',
      'eoi.assist','commission.read'
    ],
    manager:[
      'governance.rules','governance.pricing','governance.capacity','governance.permissions',
      'governance.integrations','governance.monitoring','governance.audit','users.manage','projects.manage'
    ]
  };

  function configuredPages(role){
    if(window.RT_ROLE_CONFIG&&RT_ROLE_CONFIG[role]&&Array.isArray(RT_ROLE_CONFIG[role].steps)){
      return RT_ROLE_CONFIG[role].steps.map(x=>x[0]);
    }
    if(window.rolePages&&Array.isArray(rolePages[role])) return rolePages[role].slice();
    return [];
  }

  function isDelegatedBrokerBuyerPage(page){
    if(!/^b-/.test(page)) return false;
    const delegated=window.app&&app.fx&&app.fx.final6&&app.fx.final6.delegatedBuyer;
    if(!delegated) return false;
    return [
      'b-account','b-recommend','b-eoi','b-site','b-building','b-floor','b-unit'
    ].includes(page);
  }

  function canOpen(role,page,opts){
    opts=opts||{};
    if(opts.preview===true || (window.app&&app.__flowDirectPreview)) return true;
    if(!role||!page) return false;

    const pages=configuredPages(role);
    if(pages.includes(page)) return true;

    // Explicitly supported shared/advanced surfaces.
    if(role==='manager' && (page==='r-hardware' || /^m-/.test(page))) return true;
    if(role==='buyer' && /^b-/.test(page)) return true;
    if(role==='registrar' && /^r-/.test(page)) return true;
    if(role==='operator' && /^a-/.test(page)) return true;
    if(role==='finance' && (page==='f-providers' || /^t-/.test(page))) return true;
    if(role==='broker' && (/^br-/.test(page) || page==='cp-commission' || isDelegatedBrokerBuyerPage(page))) return true;

    return false;
  }

  function has(role,capability){
    return (capabilities[role]||[]).includes(capability) || role==='manager';
  }

  function deny(role,page){
    const roleLabel=(root.getRole&&root.getRole(role)?.label)||role||'Role';
    if(typeof window.toast==='function') toast(roleLabel+' cannot open this page in the real role workflow.');
    console.warn('[PRENEURA role policy] blocked',role,'->',page);
    return false;
  }

  function install(){
    if(window.__PRENEURA_ROLE_POLICY_INSTALLED)return;
    window.__PRENEURA_ROLE_POLICY_INSTALLED=true;

    const baseGo=window.go;
    if(typeof baseGo==='function'){
      window.go=function(page){
        const role=window.app&&app.role;
        if(!canOpen(role,page,{preview:false})) return deny(role,page);
        return baseGo.apply(this,arguments);
      };
      try{go=window.go}catch(_){}
    }

    const baseEnter=window.rtEnterRole;
    if(typeof baseEnter==='function'){
      window.rtEnterRole=function(role){
        if(!root.model?.roles?.[role]) return deny(role,'ROLE_ENTRY');
        return baseEnter.apply(this,arguments);
      };
      try{rtEnterRole=window.rtEnterRole}catch(_){}
    }
  }

  root.rolePolicy={
    capabilities,
    configuredPages,
    canOpen,
    has,
    install
  };

  install();
})();
