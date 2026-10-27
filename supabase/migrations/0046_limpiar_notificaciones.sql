-- Limpiar notificaciones: cada persona borra las suyas desde la campanita
-- (una o todas). Como en marcar_notificaciones_leidas(), la tabla sigue sin
-- policies de escritura: solo se borra con esta función y solo lo propio.

create or replace function public.limpiar_notificaciones(p_ids uuid[] default null)
returns void language sql security definer set search_path = public
as $$
  delete from notificaciones
  where destinatario_id = auth.uid()
    and (p_ids is null or id = any(p_ids));
$$;

revoke all on function public.limpiar_notificaciones(uuid[]) from public, anon;
grant execute on function public.limpiar_notificaciones(uuid[]) to authenticated;
