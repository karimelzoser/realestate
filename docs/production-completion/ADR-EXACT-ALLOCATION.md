# Exact apartment allocation implementation

Status: implementation design; E07 is the next active acceptance. Existing schema46 EOI/type-policy evidence and certified assigned queue/allocator, physical hierarchy and pricing foundations satisfy this slice's concrete dependencies. The wider E04/E05/E06 epics remain open for public UX, online capacity and other acceptance.

## Accepted journey

EOI captures apartment type and no inventory. A called buyer's assigned allocator browses active published apartment references through building/floor hierarchy, requests an immutable exact-apartment quote, locks that quote with an idempotency key, and converts the same apartment/price to reservation. The buyer self-service/online session uses the same business authority when its service-capacity flow is implemented; a buyer cannot bypass the called-session boundary.

## Database authority

- Add immutable allocation quotes scoped to tenant/project, queue/buyer/operator, chosen physical apartment and mapped inventory slot. Capture public apartment/building/floor identity, original EOI type, effective pricing version, exact decimal total/currency and component evidence. Quotes expire in five minutes and do not hold inventory.
- Lock only the quoted requested slot. Lock requests validate the original paid/unapplied EOI type, active hierarchy/physical state, owning called allocator session, current quote/version, quote expiry and current availability inside PostgreSQL. A conflicting requested apartment returns conflict; it never picks another slot.
- Store the quote and physical apartment on the lock. The default short hold is 15 minutes; an extension is a separate E08 request/decision workflow.
- Serialize/reconcile a scoped idempotency key. Replays return the original result; a changed request cannot reuse a key. Expired/terminal results cannot be silently reactivated.
- Preserve historical untyped/unmapped records explicitly. Normal production reservation APIs require the new exact quote. Legacy database certification graphs remain historical compatibility tests; existing records are not fabricated into exact customer selections.
- Freeze lock identity and exact reservation evidence. Physical-slot mapping or commercial identity changes cannot rewrite an accepted exact record. Capture labels as immutable snapshots so later catalog naming cannot change the buyer's evidence.
- Reservation uses the accepted lock quote; scheduled price changes during a valid hold cannot silently reprice the buyer. Capture the existing certified three-component base pricing. Per-apartment adjustment publication and immutable adjustment breakdown remains a separate E04.2 acceptance slice.
- Extend reservation/transaction/property/finance/document/commission/export/audit read models with authoritative physical identity and snapshot. Preserve scoped access and agent financial redaction.

## Interfaces and experience

Use the existing allocation module and queue-entry identity rather than creating a second unrelated waiting line. Add eligible apartment listing and quote endpoints under assigned allocation. Require a quote ID and request UUID on the lock endpoint; reject type-only locking for this journey. Update staff allocation to building/floor/apartment detail/quote/select. Localize each new surface using the shared provider/dictionaries and exact-decimal formatting.

Provide honest empty, unavailable, stale-quote and expired-session states. Unmapped slots or apartments lacking a publishable reference are not selectable. Refresh/relocation must load the authoritative current lock/reservation.

## Required evidence

Positive purchase propagation and quote preservation; wrong tenant/type/buyer/operator/session; hidden/withdrawn hierarchy; missing mapping; stale/expired quote; competing requests for one requested apartment; changed idempotency payload; lock expiry/release/conversion races; price movement after hold; immutable identity/snapshots; legacy API rejection; role redaction; Arabic/English desktop/mobile browser journey. Preserve and run affected pricing, finance, document, allocator, concurrency, restore and emitted full-stack gates.

Current design is software work. No provider/server deployment or live-production GO is inferred.
