import { FolderOpen } from "lucide-react";

import { EmptyState } from "../components/ui";

export default function Projects() {
  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Your projects</h1>
        <p className="page__lede">Everything you have made and published.</p>
      </header>

      <EmptyState
        icon={<FolderOpen size={26} />}
        title="Nothing published yet"
        text="Agents and apps you build will collect here, each with its public link."
      />
    </div>
  );
}
