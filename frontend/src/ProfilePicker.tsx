import type { CrewProfile } from './profiles'

export default function ProfilePicker({ profiles, onSelect }: { profiles: CrewProfile[]; onSelect: (profile: CrewProfile) => void }) {
  return <main className="profile-gate">
    <div className="gate-stars"/><div className="gate-orbit orbit-a"/><div className="gate-orbit orbit-b"/>
    <header className="gate-brand"><div className="mark">S</div><div><b>STELLAR</b><span>ARTEMIS III · CREW HEALTH</span></div></header>
    <section className="profile-picker">
      <span>ONBOARD PROFILE ACCESS</span><h1>¿Quién está ingresando?</h1><p>Selecciona un perfil local. No se requieren cuentas ni contraseñas en este prototipo.</p>
      <div className="profile-cards">
        {profiles.map((profile, index) => <button key={profile.id} className={`profile-card profile-${profile.access}`} onClick={() => onSelect(profile)} style={{'--profile-accent': profile.accent} as React.CSSProperties}>
          <div className="profile-portrait">{profile.photo ? <img src={profile.photo} alt={`Retrato oficial de ${profile.name}`} /> : <><div className="portrait-head"><i/><b>{profile.initials}</b></div><div className="portrait-suit"><i>S</i><span/></div></>}{profile.access === 'captain' && <em>COMMAND</em>}{profile.access === 'nasa' && <em>TECH</em>}</div>
          <strong>{profile.name}</strong><span>{profile.role}</span><small>{profile.agency}</small>
          <i className="profile-number">0{index + 1}</i>
        </button>)}
      </div>
      <div className="gate-note"><i/> Los perfiles funcionan únicamente dentro de la nave y no representan autenticación de seguridad.</div>
    </section>
  </main>
}

