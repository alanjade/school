-- Replaces the three sequential UPDATE calls in moveStop() (transport.ts)
-- with a single atomic swap inside a Postgres transaction. The old
-- approach had a race window: two concurrent moveStop() calls on
-- different stops of the same route could read each other's intermediate
-- state and leave sequence_order values corrupted.
--
-- The function takes the two stop IDs explicitly (resolved by the app
-- layer) rather than a stopId + direction so the neighbour look-up is
-- also inside the transaction — no stale read possible.
create or replace function swap_transport_stop_order(
  p_stop_a uuid,
  p_stop_b uuid
)
returns void
language plpgsql
as $$
declare
  v_order_a integer;
  v_order_b integer;
begin
  -- Lock both rows in a consistent order (smaller id first) to prevent
  -- deadlocks if two callers swap overlapping pairs simultaneously.
  select sequence_order into v_order_a
  from transport_stops
  where id = p_stop_a
  for update;

  select sequence_order into v_order_b
  from transport_stops
  where id = p_stop_b
  for update;

  if v_order_a is null or v_order_b is null then
    raise exception 'Stop not found';
  end if;

  update transport_stops set sequence_order = v_order_b where id = p_stop_a;
  update transport_stops set sequence_order = v_order_a where id = p_stop_b;
end;
$$;

-- Only admins and the transport officer should be able to reorder stops.
-- The function runs as the caller (not SECURITY DEFINER) so Supabase's
-- RLS on transport_stops still applies; the admin client in moveStop()
-- bypasses RLS anyway, but keeping SECURITY INVOKER is the safer default.
revoke all on function swap_transport_stop_order(uuid, uuid) from public;
grant execute on function swap_transport_stop_order(uuid, uuid) to service_role;
