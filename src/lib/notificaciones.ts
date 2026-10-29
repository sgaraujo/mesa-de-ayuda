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

// La misma función envía el correo de rechazo según el estado de la tarea.
export async function notificarRechazo(ticketId: string) {
  const { error } = await supabase.functions.invoke('notify-finalizacion', {
    body: { ticketId },
  })

  if (error) console.error('No se pudo enviar la notificación de rechazo:', error.message)
}

// Correo a quien creó la tarea y a sus responsables cuando el líder la
// elimina con motivo (migración 0054). La campanita ya la dejó la base.
export async function notificarEliminacion(eliminadoId: string) {
  const { error } = await supabase.functions.invoke('notify-eliminacion', {
    body: { eliminadoId },
  })

  if (error) console.error('No se pudo enviar el aviso de eliminación:', error.message)
}

export interface ResultadoMenciones {
  ok: boolean
  enviados: number
  detalle?: string
}

// A diferencia de los otros avisos, el resultado se muestra a quien comentó
// para que sepa si el correo salió.
export async function notificarMenciones(comentarioId: string): Promise<ResultadoMenciones> {
  const { data, error } = await supabase.functions.invoke('notify-mention', {
    body: { comentarioId },
  })

  if (error) {
    // En respuestas no 2xx el cuerpo con el motivo viene en error.context.
    let detalle = error.message
    try {
      const cuerpo = await (error as { context?: Response }).context?.json()
      detalle = cuerpo?.detalle ?? cuerpo?.message ?? detalle
    } catch {
      // Sin cuerpo JSON: queda el mensaje genérico.
    }
    console.error('No se pudo enviar la notificación de mención:', detalle)
    return { ok: false, enviados: (data as { enviados?: number } | null)?.enviados ?? 0, detalle }
  }

  return { ok: true, enviados: (data as { enviados?: number } | null)?.enviados ?? 0 }
}
