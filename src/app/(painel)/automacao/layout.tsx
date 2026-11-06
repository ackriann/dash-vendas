import AutoTabs from "@/components/automacao/AutoTabs";

export default function AutomacaoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="overflow-x-auto -mx-1 px-1"><AutoTabs /></div>
      {children}
    </div>
  );
}
