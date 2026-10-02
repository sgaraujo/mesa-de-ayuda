import { useNavigate } from 'react-router-dom'
import { TicketForm } from '../components/TicketForm'

export function NewTicketPage() {
  const navigate = useNavigate()

  return (
    <div className="page-form">
      <h1>Nueva solicitud</h1>
      <p className="page-form__subtitulo">
        En cuatro pasos: elige el área, cuéntanos qué necesitas, marca la urgencia y, si quieres,
        adjunta un archivo. Después puedes seguirla en Mis solicitudes.
      </p>
      <TicketForm elegirArea onCreado={() => navigate('/mis-solicitudes')} />
    </div>
  )
}
