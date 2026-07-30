begin;

create or replace function public.claim_notification_delivery(
  claim_sender_uid uuid,
  claim_recipient_uid uuid,
  claim_notification_type text,
  claim_event_key text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rate_state public.notification_rate_limits%rowtype;
  claim_time timestamptz := clock_timestamp();
  cooldown interval;
  hourly_limit integer;
begin
  if claim_notification_type not in ('invite', 'turn', 'lovenote', 'nudge') then
    return false;
  end if;
  if char_length(claim_event_key) not between 1 and 160 then
    return false;
  end if;

  cooldown := case claim_notification_type
    when 'invite' then interval '5 seconds'
    when 'nudge' then interval '1 hour'
    else interval '1 second'
  end;
  hourly_limit := case claim_notification_type
    when 'invite' then 10
    when 'nudge' then 2
    when 'turn' then 30
    else 30
  end;

  perform pg_advisory_xact_lock(
    hashtextextended(
      claim_sender_uid::text || ':' || claim_recipient_uid::text || ':' ||
      claim_notification_type,
      0
    )
  );

  if claim_notification_type <> 'nudge' and exists (
    select 1
    from public.notification_delivery_events
    where sender_uid = claim_sender_uid
      and recipient_uid = claim_recipient_uid
      and notification_type = claim_notification_type
      and event_key = claim_event_key
  ) then
    return false;
  end if;

  select *
  into rate_state
  from public.notification_rate_limits
  where sender_uid = claim_sender_uid
    and recipient_uid = claim_recipient_uid
    and notification_type = claim_notification_type
  for update;

  if not found then
    insert into public.notification_rate_limits (
      sender_uid,
      recipient_uid,
      notification_type,
      window_started,
      last_delivered_at,
      deliveries
    )
    values (
      claim_sender_uid,
      claim_recipient_uid,
      claim_notification_type,
      claim_time,
      claim_time,
      1
    );
  else
    if rate_state.last_delivered_at > claim_time - cooldown then
      return false;
    end if;
    if rate_state.window_started <= claim_time - interval '1 hour' then
      update public.notification_rate_limits
      set window_started = claim_time, last_delivered_at = claim_time, deliveries = 1
      where sender_uid = claim_sender_uid
        and recipient_uid = claim_recipient_uid
        and notification_type = claim_notification_type;
    elsif rate_state.deliveries >= hourly_limit then
      return false;
    else
      update public.notification_rate_limits
      set last_delivered_at = claim_time, deliveries = deliveries + 1
      where sender_uid = claim_sender_uid
        and recipient_uid = claim_recipient_uid
        and notification_type = claim_notification_type;
    end if;
  end if;

  if claim_notification_type <> 'nudge' then
    insert into public.notification_delivery_events (
      sender_uid, recipient_uid, notification_type, event_key, delivered_at
    )
    values (
      claim_sender_uid, claim_recipient_uid, claim_notification_type, claim_event_key, claim_time
    );
  end if;
  return true;
end;
$$;

revoke execute on function public.claim_notification_delivery(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_notification_delivery(uuid, uuid, text, text)
  to service_role;

commit;
