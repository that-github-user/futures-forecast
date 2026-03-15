/**
 * SidebarTabs — 3-button toggle for the middle sidebar section.
 */

export type SidebarTab = "signal" | "distribution" | "scenarios";

interface Props {
  activeTab: SidebarTab;
  onChange: (tab: SidebarTab) => void;
}

const tabs: { value: SidebarTab; label: string }[] = [
  { value: "signal", label: "Signal" },
  { value: "distribution", label: "Distribution" },
  { value: "scenarios", label: "Scenarios" },
];

export function SidebarTabs({ activeTab, onChange }: Props) {
  return (
    <div className="sidebar-tabs">
      {tabs.map((t) => (
        <button
          key={t.value}
          className={activeTab === t.value ? "active" : ""}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
