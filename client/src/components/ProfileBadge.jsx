import { User, Edit3 } from 'lucide-react';

export default function ProfileBadge({ name, onEdit, compact = false }) {
  const initial = name ? name[0].toUpperCase() : '?';

  return (
    <button
      className="profile-badge-btn"
      onClick={onEdit}
      title="Click to edit display name"
      type="button"
    >
      <div className="profile-badge-avatar">
        {name ? initial : <User size={12} />}
      </div>
      <span className="profile-badge-name">
        {name || 'Set Name'}
      </span>
      <Edit3 size={12} className="profile-badge-icon" />
    </button>
  );
}
