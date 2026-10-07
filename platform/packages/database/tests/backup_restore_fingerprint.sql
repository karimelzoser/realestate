\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

WITH evidence AS (
  SELECT jsonb_build_object(
    'runtime', (
      SELECT jsonb_build_object(
        'schemaVersion', schema_version,
        'minimumRuntimeVersion', minimum_runtime_version,
        'migrationMarker', migration_marker
      )
      FROM platform_runtime_contract
      WHERE singleton_key='production'
    ),
    'migrations', (
      SELECT jsonb_build_object(
        'count', count(*),
        'latest', max(version),
        'checksums', string_agg(version::text || ':' || checksum_sha256, ',' ORDER BY version)
      )
      FROM platform_schema_migrations
    ),
    'reservation', (
      SELECT jsonb_build_object(
        'id', r.id,
        'quotedTotal', r.quoted_total,
        'currency', r.currency,
        'pricingVersionId', r.pricing_version_id,
        'components', (
          SELECT jsonb_agg(
            jsonb_build_object(
              'component', component,
              'area', area_sqm,
              'rate', rate_per_sqm,
              'amount', amount
            ) ORDER BY component
          )
          FROM reservation_price_components rpc
          WHERE rpc.reservation_id=r.id
        )
      )
      FROM reservations r
      WHERE r.id='00000000-0000-0000-0000-000000012000'
    ),
    'contract', (
      SELECT jsonb_build_object(
        'documentId', d.id,
        'status', d.status,
        'objectKey', d.storage_object_key,
        'sha256', d.sha256_hex,
        'objectTrustStatus', sot.status,
        'objectTrustSha256', sot.sha256_hex,
        'signatureCount', (SELECT count(*) FROM document_signatures s WHERE s.document_id=d.id),
        'execution', (
          SELECT jsonb_build_object(
            'manifestSha256', ces.manifest_sha256_hex,
            'quotedTotal', ces.quoted_total,
            'priceComponentCount', jsonb_array_length(ces.price_components),
            'signatureCount', jsonb_array_length(ces.signatures),
            'executedAt', ces.executed_at,
            'executedBy', ces.executed_by
          )
          FROM contract_execution_snapshots ces
          WHERE ces.document_id=d.id
        )
      )
      FROM transaction_documents d
      LEFT JOIN storage_object_trust sot ON sot.id=d.object_trust_id
      WHERE d.id='00000000-0000-0000-0000-000000014004'
    ),
    'finance', (
      SELECT jsonb_build_object(
        'eventCount', (SELECT count(*) FROM finance_payment_events WHERE transaction_id='00000000-0000-0000-0000-000000013000'),
        'ledgerCount', (SELECT count(*) FROM finance_ledger_entries WHERE transaction_id='00000000-0000-0000-0000-000000013000'),
        'ledgerBalance', (SELECT coalesce(sum(signed_amount),0) FROM finance_ledger_entries WHERE transaction_id='00000000-0000-0000-0000-000000013000'),
        'allocatedAmount', (
          SELECT coalesce(sum(a.amount),0)
          FROM finance_payment_allocations a
          JOIN finance_payment_events e ON e.id=a.payment_event_id
          WHERE e.transaction_id='00000000-0000-0000-0000-000000013000'
        ),
        'downPaid', (SELECT paid_amount FROM payment_schedule_items WHERE id='00000000-0000-0000-0000-000000015001'),
        'installmentPaid', (SELECT paid_amount FROM payment_schedule_items WHERE id='00000000-0000-0000-0000-000000015002')
      )
    ),
    'cheques', (
      SELECT jsonb_build_object(
        'instrumentCount', count(*),
        'maxGeneration', max(generation),
        'currentStatuses', jsonb_agg(jsonb_build_object('generation',generation,'status',status,'amount',amount) ORDER BY generation),
        'eventCount', (
          SELECT count(*)
          FROM finance_cheque_events fce
          JOIN transaction_cheques ec ON ec.id=fce.cheque_id
          WHERE ec.root_cheque_id='00000000-0000-0000-0000-000000015003'
        )
      )
      FROM transaction_cheques
      WHERE root_cheque_id='00000000-0000-0000-0000-000000015003'
    ),
    'commission', (
      SELECT jsonb_build_object(
        'status', status,
        'basisAmount', basis_amount,
        'ratePercent', rate_percent,
        'commissionAmount', commission_amount,
        'eligibleAt', eligible_at,
        'dueAt', due_at
      )
      FROM broker_commission_cases
      WHERE id='00000000-0000-0000-0000-000000015005'
    )
  ) AS payload
)
SELECT encode(digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')
FROM evidence;
