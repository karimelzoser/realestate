// PRENEURA core product contract.
// This is the canonical metadata/policy layer used by extracted features.
// Runtime operational truth still lives in the existing app state until each domain is migrated.

(function(){
  const root = window.PRENEURA = window.PRENEURA || {};

  const roles = {
    buyer: {
      id:'buyer',
      label:'Buyer',
      purpose:'Explore, qualify, join allocation, choose the exact unit, complete purchase and manage owned properties.',
      defaultPage:'b-browse',
      assistance:'self-service'
    },
    registrar: {
      id:'registrar',
      label:'Queue Receptionist',
      purpose:'Find/register the buyer, verify allocation-day check-in and issue/load the authoritative queue token.',
      defaultPage:'r-checkin',
      assistance:'sales-center-entry'
    },
    operator: {
      id:'operator',
      label:'Allocator',
      purpose:'Human allocation specialist for offline buyers. Helps the assigned buyer choose the exact physical unit and complete the unit-lock handoff.',
      defaultPage:'a-desk',
      assistance:'human-offline'
    },
    finance: {
      id:'finance',
      label:'Transaction Operator',
      purpose:'Own payment evidence, documents, finance-provider flow and contract readiness after the exact unit is locked.',
      defaultPage:'t-inbox',
      assistance:'transaction'
    },
    broker: {
      id:'broker',
      label:'Broker',
      purpose:'Register and assist attributed buyers while using the same EOI, queue, inventory and transaction truth.',
      defaultPage:'br-dashboard',
      assistance:'partner'
    },
    manager: {
      id:'manager',
      label:'Manager',
      purpose:'Govern rules, pricing, capacity, permissions, monitoring, integrations and exceptions without changing queue truth manually.',
      defaultPage:'m-home',
      assistance:'governance'
    }
  };

  const flow = {
    stages: [
      {
        id:'entry',
        title:'Entry Channels',
        routes:[
          {id:'buyer-direct',label:'Buyer Direct',role:'buyer',mode:'ROLE',page:'b-browse'},
          {id:'broker',label:'Broker',role:'broker',mode:'ROLE',page:'br-dashboard'},
          {id:'sales-center',label:'Sales Center / Reception',role:'registrar',mode:'ROLE',page:'r-checkin'}
        ]
      },
      {id:'record',title:'One Buyer Record + EOI',role:'buyer',mode:'OPEN',page:'b-eoi'},
      {id:'eligibility',title:'Ready for Allocation?',role:'buyer',mode:'OPEN',page:'b-eoi'},
      {id:'attendance',title:'Attendance',role:'buyer',mode:'OPEN',page:'b-allocation-day'},
      {
        id:'attendance-paths',
        title:'Online / Sales Center',
        routes:[
          {id:'online',label:'Online Attendance',role:'buyer',mode:'OPEN',page:'b-allocation-day'},
          {id:'offline',label:'Sales Center Attendance',role:'registrar',mode:'OPEN',page:'r-checkin'}
        ]
      },
      {id:'queue',title:'One Shared Queue',role:'manager',mode:'OPEN',page:'m-allocation-live'},
      {id:'capacity',title:'Parallel Allocation',role:'manager',mode:'OPEN',page:'m-allocation-live'},
      {
        id:'assistance',
        title:'Allocation Assistance',
        routes:[
          {id:'online-ai',label:'AI Allocation Advisor',role:'buyer',mode:'OPEN',page:'b-site'},
          {id:'offline-human',label:'Human Allocator',role:'operator',mode:'ROLE',page:'a-desk'}
        ]
      },
      {
        id:'exact-unit',
        title:'Exact Unit Selection',
        role:'buyer',
        mode:'OPEN',
        page:'b-site',
        subroutes:[
          {label:'Master Plan',page:'b-site'},
          {label:'Building',page:'b-building'},
          {label:'Floor',page:'b-floor'},
          {label:'Exact Unit',page:'b-unit'}
        ]
      },
      {id:'unit-lock',title:'Unit Lock',role:'operator',mode:'OPEN',page:'a-handoff'},
      {id:'transaction',title:'Transaction Operator',role:'finance',mode:'ROLE',page:'t-inbox'},
      {id:'contract',title:'Contract & Sign',role:'buyer',mode:'OPEN',page:'b-contract'},
      {id:'property',title:'My Property',role:'buyer',mode:'OPEN',page:'b-properties'}
    ]
  };

  const allocation = {
    queuePolicy:'ONE_SHARED_QUEUE',
    priorityPolicy:'SAME_PRIORITY_ENGINE',
    attendanceDoesNotChangePriority:true,
    demoBuyers:[
      {token:233,name:'Mona Adel',attendanceMode:'SALES_CENTER',roleHelp:'Human Allocator'},
      {token:234,name:'Youssef Nabil',attendanceMode:'ONLINE',roleHelp:'AI Allocation Advisor'}
    ],
    defaultCapacity:{salesCenterSeats:10,onlineSlots:3},
    assistance:{
      ONLINE:'AI Allocation Advisor',
      SALES_CENTER:'Human Allocator'
    }
  };

  const permissions = {
    preview:{
      name:'OPEN',
      bypassDemoNavigationPrerequisites:true,
      description:'Direct page preview from How It Works for product/demo inspection.'
    },
    role:{
      name:'ROLE',
      bypassDemoNavigationPrerequisites:false,
      description:'Real role workflow. Login, role permissions, eligibility, queue and transaction restrictions remain active.'
    },
    irreversible:{
      unitLock:'USER_CONFIRMATION_REQUIRED',
      paymentConfirmation:'AUTHORITATIVE_PAYMENT_FLOW_REQUIRED',
      finalContractSignature:'USER_SIGNATURE_REQUIRED',
      priceOverride:'AUTHORIZED_ROLE_ONLY',
      queuePriorityOverride:'DENY_BY_DEFAULT'
    }
  };

  const aiAdvisor = {
    languages:['en','ar-EG'],
    arabicDialect:'Egyptian Arabic',
    channel:'ONLINE_ALLOCATION',
    allowed:[
      'explain-current-state',
      'compare-units',
      'recommend-by-buyer-preferences',
      'navigate',
      'highlight-controls',
      'safe-reversible-actions'
    ],
    requiresBuyerConfirmation:[
      'exact-unit-lock',
      'legal-signature'
    ]
  };

  function findStage(id){
    return flow.stages.find(s=>s.id===id) || null;
  }
  function findRoute(id){
    for(const stage of flow.stages){
      if(stage.id===id && stage.page) return stage;
      for(const r of stage.routes||[]) if(r.id===id) return r;
      for(const r of stage.subroutes||[]) if(r.id===id || r.label===id) return r;
    }
    return null;
  }
  function role(id){ return roles[id] || null; }
  function rolePage(id){
    const configured = window.RT_ROLE_CONFIG && RT_ROLE_CONFIG[id] && Array.isArray(RT_ROLE_CONFIG[id].steps)
      ? RT_ROLE_CONFIG[id].steps[0]?.[0]
      : null;
    return configured || roles[id]?.defaultPage || null;
  }
  function applyRoleLabels(){
    if(typeof window.labels!=='undefined'){
      Object.keys(roles).forEach(id=>{ labels[id]=roles[id].label; });
    }
    if(window.RT_ROLE_CONFIG){
      Object.keys(roles).forEach(id=>{
        if(RT_ROLE_CONFIG[id]) RT_ROLE_CONFIG[id].label=roles[id].label;
      });
    }
  }

  root.model = Object.freeze({
    roles,
    flow,
    allocation,
    permissions,
    aiAdvisor
  });
  root.getRole = role;
  root.getRolePage = rolePage;
  root.findFlowStage = findStage;
  root.findFlowRoute = findRoute;
  root.applyRoleLabels = applyRoleLabels;

  applyRoleLabels();
})();
