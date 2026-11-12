export type AccessRole = 'captain' | 'crew' | 'nasa'

export type CrewProfile = {
  id: string
  name: string
  shortName: string
  role: string
  agency: string
  initials: string
  photo?: string
  access: AccessRole
  accent: string
}

export const profiles: CrewProfile[] = [
  { id: 'bresnik', name: 'Randy Bresnik', shortName: 'Randy', role: 'Commander', agency: 'NASA', initials: 'RB', photo: '/crew/randy-bresnik.jpg', access: 'captain', accent: '#58e6bd' },
  { id: 'parmitano', name: 'Luca Parmitano', shortName: 'Luca', role: 'Pilot', agency: 'ESA', initials: 'LP', photo: '/crew/luca-parmitano.jpg', access: 'crew', accent: '#58bfff' },
  { id: 'douglas', name: 'Andre Douglas', shortName: 'Andre', role: 'Mission Specialist', agency: 'NASA', initials: 'AD', photo: '/crew/andre-douglas.jpg', access: 'crew', accent: '#ffb45f' },
  { id: 'rubio', name: 'Frank Rubio', shortName: 'Frank', role: 'Mission Specialist', agency: 'NASA', initials: 'FR', photo: '/crew/frank-rubio.jpg', access: 'crew', accent: '#a98dff' },
  { id: 'nasa', name: 'NASA', shortName: 'NASA', role: 'System Administration', agency: 'Mission Systems', initials: 'N', access: 'nasa', accent: '#eef5fa' },
]

