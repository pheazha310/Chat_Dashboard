import { ApplicationsWorkspace } from "@/widgets/applications-workspace";

export default function ApplicationsPage({ onClose }: { onClose: () => void }) {
  return <ApplicationsWorkspace onClose={onClose} />;
}
