import { useNavigate } from 'react-router-dom'
import { TicketForm } from '../components/TicketForm'

export function NewTicketPage() {
  const navigate = useNavigate()

  return (
    <div className="page-form">
      <h1>Nueva solicitud</h1>
      <p className="page-form__subtitulo">
        Cuéntanos qué necesitas — puedes asignarla a alguien específico o dejarla en la
        bandeja general del equipo.
      </p>
      <TicketForm onCreado={() => navigate('/tablero')} />
    </div>
  )
}
