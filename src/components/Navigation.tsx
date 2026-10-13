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
 * Top-level navigation, grouped by where the data comes from.
 *
 * That is the organising idea, and it is worth stating because an earlier
 * grouping used a different one. Tabs were previously gathered by what they
 * were *for* — matching here, reports there — which read sensibly but hid the
 * thing that actually determines whether a screen works: six of them do
 * nothing at all without a live Domo connection and a round of manual
 * matching, and they sat interleaved with the screens that only need an
 * uploaded file. Someone with a spreadsheet and no connection had no way to
 * tell which half of the app was theirs.
 *
 * So everything built on the uploaded rate card comes first, and everything
 * needing the connected datasets is gathered under Supplemental Data. Method
 * stays last and alone: it explains every other tab rather than belonging to
 * one.
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
    id: 'ingest',
    label: 'Ingest Rate Card',
    icon: FileUp,
    members: [{ id: 'ingest', label: 'Ingest Rate Card', icon: FileUp }],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: ClipboardCheck,
    members: [
      { id: 'cardquality', label: 'Card Quality', icon: ShieldCheck },
      { id: 'movement', label: 'Rate Movement', icon: TrendingUp },
      { id: 'concentration', label: 'Concentration', icon: Target },
    ],
  },
  {
    id: 'matching',
    label: 'Matching',
    icon: Link2,
    members: [{ id: 'mappings', label: 'Standard Titles', icon: Tags }],
  },
  // Everything from here needs the connected datasets. Grouped together so the
  // "load actuals" prompt is a property of one area rather than a surprise on
  // five separate screens.
  {
    id: 'supplemental',
    label: 'Supplemental Data',
    icon: Database,
    members: [
      { id: 'clients', label: 'Clients', icon: Link2 },
      { id: 'titles', label: 'Titles', icon: Tags },
      { id: 'coverage', label: 'Card Coverage', icon: ShieldCheck },
      { id: 'compliance', label: 'Card Compliance', icon: Scale },
      { id: 'regional', label: 'Regional', icon: Map },
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
