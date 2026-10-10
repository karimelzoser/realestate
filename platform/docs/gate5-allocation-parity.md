# Gate 5 Receptionist / Allocator parity

This slice certifies the operational handoff from reception queue dispatch to allocator-controlled unit-type reservation.

- Receptionist owns paid-EOI check-in and deterministic call-next.
- Allocator must claim exactly one called buyer before locking inventory.
- An allocator cannot lock inventory for an arbitrary buyer in the project.
- The active lock must be bound to the allocator's assigned queue entry before reservation conversion.
- Competing allocators cannot claim the same called buyer.
- Browser controls are convenience only; PostgreSQL and API authorization remain authoritative.
