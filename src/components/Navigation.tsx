import React, { useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  FileUp,
  Database,
  Link2,
  ShieldCheck,
  Tags,
  Scale,
  Map,
  BookOpen,
  TableProperties,
  Layers,
  ClipboardCheck,
  TrendingUp,
  Target,
  LucideIcon,
} from 'lucide-react';
import { useRateCard } from '../context/RateCardContext';
import { TabId } from '../types/navigation';

interface TabDef {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

interface TabGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  members: TabDef[];
}

/**
 * Top-level navigation: Command Center, Reports, Data, Method.
 *
 * The two areas people read from come first. Everything that gets data in or
 * lines it up — the upload, the standard-title mapping, the client and title
 * matching, and the coverage and compliance checks against Domo — sits under
 * one Data tab, so the setup work is in one place. Method stays last and
 * alone: it explains every other tab rather than belonging to one.
 *
 * `activeTab` stays a flat id rather than becoming a group plus a member. The
 * grouping is presentation, every existing route still resolves, and a group is
 * active when any of its members is.
 */
export const TAB_GROUPS: TabGroup[] = [
  {
    id: 'dashboard',
    label: 'Command Center',
    icon: LayoutDashboard,
    members: [
      { id: 'dashboard', label: 'Rate Card', icon: TableProperties },
      { id: 'collection', label: 'Records', icon: Layers },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: ClipboardCheck,
    members: [
      { id: 'cardquality', label: 'Card Quality', icon: ShieldCheck },
      { id: 'movement', label: 'Rate Movement', icon: TrendingUp },
      { id: 'concentration', label: 'Concentration', icon: Target },
      { id: 'regional', label: 'Regional', icon: Map },
    ],
  },
  // Getting data in and lined up: the upload, the matching that the reports
  // read through, then coverage and compliance, which check how well the cards
  // line up against the Domo actuals. Ordered as the work is done.
  {
    id: 'data',
    label: 'Data',
    icon: Database,
    members: [
      { id: 'ingest', label: 'Ingest Rate Card', icon: FileUp },
      { id: 'mappings', label: 'Standard Titles', icon: Tags },
      { id: 'clients', label: 'Clients', icon: Link2 },
      { id: 'titles', label: 'Titles', icon: Tags },
      { id: 'coverage', label: 'Card Coverage', icon: ShieldCheck },
      { id: 'compliance', label: 'Card Compliance', icon: Scale },
    ],
  },
  {
    id: 'method',
    label: 'Method',
    icon: BookOpen,
    members: [{ id: 'method', label: 'Method', icon: BookOpen }],
  },
];

const groupFor = (tab: string): TabGroup =>
  TAB_GROUPS.find((g) => g.members.some((m) => m.id === tab)) ?? TAB_GROUPS[0];

export const Navigation: React.FC = () => {
  const { activeTab, setActiveTab } = useRateCard();

  /**
   * The member last open in each group, so returning to a group lands where it
   * was left rather than resetting to the first entry. Held in a ref because
   * nothing renders from it directly — reading it during a click is enough.
   */
  const lastVisited = useRef<Record<string, TabId>>({});
  useEffect(() => {
    lastVisited.current[groupFor(activeTab).id] = activeTab;
  }, [activeTab]);

  const current = groupFor(activeTab);

  return (
    <>
      <nav className="navigation-tabs">
        {TAB_GROUPS.map((group) => {
          const Icon = group.icon;
          return (
            <button
              key={group.id}
              className={`nav-tab-button ${current.id === group.id ? 'active' : ''}`}
              onClick={() => {
                if (current.id === group.id) return;
                setActiveTab(lastVisited.current[group.id] ?? group.members[0].id);
              }}
            >
              <Icon size={18} />
              <span>{group.label}</span>
            </button>
          );
        })}
      </nav>

      {current.members.length > 1 && (
        <SubNavigation group={current} activeTab={activeTab} onSelect={setActiveTab} />
      )}
    </>
  );
};

/**
 * The second row, shown only for a group that has somewhere to go.
 *
 * Reuses the tab classes at a narrower width, the same way the collection
 * viewer already renders its own sub-tabs — a second control idiom would make
 * the nesting harder to read, not easier.
 */
const SubNavigation: React.FC<{
  group: TabGroup;
  activeTab: string;
  onSelect: (tab: TabId) => void;
}> = ({ group, activeTab, onSelect }) => (
  <div
    className="navigation-tabs"
    style={{
      marginTop: '-8px',
      marginBottom: '20px',
      maxWidth: `${group.members.length * 200}px`,
      background: 'var(--surface-container-lowest)',
    }}
  >
    {group.members.map((member) => {
      const Icon = member.icon;
      return (
        <button
          key={member.id}
          className={`nav-tab-button ${activeTab === member.id ? 'active' : ''}`}
          style={{ fontSize: '0.85rem', padding: '8px 14px' }}
          onClick={() => onSelect(member.id)}
        >
          <Icon size={15} />
          <span>{member.label}</span>
        </button>
      );
    })}
  </div>
);
