// One row in the left nav. Purely presentational — the active flag and the
// click handler come from App, which owns the current view.

import Icon, { type IconName } from '../Icon'

interface Props {
  icon: IconName
  label: string
  active: boolean
  onClick: () => void
}

export default function SidebarItem({ icon, label, active, onClick }: Props) {
  return (
    <div className={`sidebar-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="sidebar-icon"><Icon name={icon} size={16} /></span>
      <span>{label}</span>
    </div>
  )
}
