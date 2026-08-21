import { supabase } from './supabase'

export async function notificarAsignacion(ticketId: string, agentesIds: string[]) {
  const destinatarios = [...new Set(agentesIds.filter(Boolean))]
  if (destinatarios.length === 0) return

  const { error } = await supabase.functions.invoke('notify-assignment', {
    body: { ticketId, agentesIds: destinatarios },
  })

  if (error) console.error('No se pudo enviar la notificación de asignación:', error.message)
}

export async function notificarNuevaTarea(ticketId: string) {
  const { error } = await supabase.functions.invoke('notify-assignment', {
    body: { ticketId, tipo: 'nueva' },
  })

  if (error) console.error('No se pudo enviar la notificación de nueva tarea:', error.message)
}

export async function notificarFinalizacion(ticketId: string) {
  const { error } = await supabase.functions.invoke('notify-finalizacion', {
    body: { ticketId },
  })

  if (error) console.error('No se pudo enviar la notificación de finalización:', error.message)
}
