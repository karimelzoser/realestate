\set ON_ERROR_STOP on

-- Compile every production export projection against the migrated schema without
-- requiring business fixtures. WHERE false ensures zero-row execution while
-- PostgreSQL still resolves every referenced table/column/expression.

SELECT bp.id AS buyer_id,u.display_name AS buyer_name,bp.source,bp.status,bc.name AS broker_company,agent.display_name AS broker_agent,bp.created_at
FROM buyer_profiles bp JOIN users u ON u.id=bp.user_id LEFT JOIN broker_companies bc ON bc.id=bp.broker_company_id LEFT JOIN users agent ON agent.id=bp.broker_agent_user_id WHERE false;

SELECT e.id AS eoi_id,u.display_name AS buyer_name,e.amount,e.currency,e.status,p.name AS refund_policy,e.paid_at,e.applied_at,e.refund_requested_at,e.refunded_at,e.created_at
FROM buyer_eois e JOIN buyer_profiles bp ON bp.id=e.buyer_profile_id JOIN users u ON u.id=bp.user_id JOIN eoi_refund_policies p ON p.id=e.refund_policy_id WHERE false;

SELECT q.id AS queue_id,u.display_name AS buyer_name,q.channel,q.priority_group,q.priority_score,q.status,q.checked_in_at,q.called_at,q.completed_at
FROM queue_entries q JOIN buyer_profiles bp ON bp.id=q.buyer_profile_id JOIN users u ON u.id=bp.user_id WHERE false;

SELECT ut.code AS unit_type_code,ut.name AS unit_type,ut.bedroom_count,ut.indoor_area_sqm,ut.roof_area_sqm,ut.garden_area_sqm,
 count(*) FILTER (WHERE s.state='AVAILABLE') AS available,count(*) FILTER (WHERE s.state='RESERVED') AS reserved,count(*) FILTER (WHERE s.state='SOLD') AS sold,count(*) FILTER (WHERE s.state='WITHDRAWN') AS withdrawn
FROM catalog_unit_types ut LEFT JOIN inventory_slots s ON s.unit_type_id=ut.id WHERE false GROUP BY ut.id;

SELECT pv.version_number,pv.label,pv.status,pv.effective_at,ut.code AS unit_type_code,ut.name AS unit_type,pr.component,pr.rate_per_sqm
FROM pricing_versions pv JOIN pricing_rates pr ON pr.pricing_version_id=pv.id JOIN catalog_unit_types ut ON ut.id=pr.unit_type_id WHERE false;

SELECT t.id AS transaction_id,u.display_name AS buyer_name,t.status,ut.code AS unit_type_code,ut.name AS unit_type,r.quoted_total,r.currency,t.opened_at,t.completed_at,t.cancelled_at
FROM transactions t JOIN buyer_profiles bp ON bp.id=t.buyer_profile_id JOIN users u ON u.id=bp.user_id JOIN reservations r ON r.id=t.reservation_id JOIN catalog_unit_types ut ON ut.id=r.unit_type_id WHERE false;

SELECT t.id AS transaction_id,u.display_name AS buyer_name,psi.sequence_number,psi.item_type,psi.amount,psi.due_at,psi.status,COALESCE(sum(a.amount),0) AS net_allocated,(psi.amount-COALESCE(sum(a.amount),0)) AS remaining_amount
FROM payment_schedule_items psi JOIN payment_schedules ps ON ps.id=psi.payment_schedule_id JOIN transactions t ON t.id=ps.transaction_id JOIN buyer_profiles bp ON bp.id=t.buyer_profile_id JOIN users u ON u.id=bp.user_id LEFT JOIN finance_payment_allocations a ON a.payment_schedule_item_id=psi.id WHERE false GROUP BY t.id,u.display_name,psi.id;

SELECT t.id AS transaction_id,u.display_name AS buyer_name,c.sequence_number,c.generation,c.amount,c.due_at,c.cheque_number,c.bank_name,c.status,c.received_at
FROM transaction_cheques c JOIN transactions t ON t.id=c.transaction_id JOIN buyer_profiles bp ON bp.id=t.buyer_profile_id JOIN users u ON u.id=bp.user_id WHERE false;

SELECT t.id AS transaction_id,u.display_name AS buyer_name,d.category,d.revision_number,d.status,d.original_filename,d.mime_type,d.byte_size,d.uploaded_at,d.verified_at
FROM transaction_documents d JOIN transactions t ON t.id=d.transaction_id JOIN buyer_profiles bp ON bp.id=t.buyer_profile_id JOIN users u ON u.id=bp.user_id WHERE false;

SELECT r.id AS refund_request_id,u.display_name AS buyer_name,r.stage,r.original_eoi_amount,r.refund_percent,r.processing_fee,r.requested_amount,r.currency,r.status,r.requested_at,r.reviewed_at,r.paid_at,r.decision_note
FROM eoi_refund_requests r JOIN buyer_profiles bp ON bp.id=r.buyer_profile_id JOIN users u ON u.id=bp.user_id WHERE false;

SELECT c.id AS commission_case_id,c.transaction_id,bc.name AS broker_company,agent.display_name AS broker_agent,c.status,c.completion_percent_snapshot,c.eligible_at,c.due_at,c.invoiced_at,c.paid_at,c.basis_amount,c.commission_amount,c.rate_percent
FROM broker_commission_cases c JOIN broker_companies bc ON bc.id=c.broker_company_id LEFT JOIN users agent ON agent.id=c.broker_agent_user_id WHERE false;

SELECT n.id AS notification_id,u.display_name AS recipient,n.audience,n.channel,n.template_code,n.status,n.scheduled_for,n.sent_at,inbox.read_at,n.attempts,n.provider_message_id
FROM notification_jobs n JOIN users u ON u.id=n.recipient_user_id LEFT JOIN user_notifications inbox ON inbox.notification_job_id=n.id WHERE false;

SELECT e.id AS event_id,e.transaction_id,actor.display_name AS actor,e.event_type,e.created_at
FROM transaction_events e JOIN transactions t ON t.id=e.transaction_id LEFT JOIN users actor ON actor.id=e.actor_user_id WHERE false;

SELECT u.id AS user_id,u.display_name,u.status AS user_status,a.role_code,a.scope_type,bc.name AS broker_company,a.status AS assignment_status,a.granted_at,a.revoked_at
FROM access_role_assignments a JOIN users u ON u.id=a.user_id LEFT JOIN broker_companies bc ON bc.id=a.broker_company_id WHERE false;

SELECT code,name,category,version_number,status,requires_signature,activated_at,created_at
FROM document_templates WHERE false;

SELECT 'Gate 4/5 export projection certification passed.' AS result;
